const assert = require("node:assert/strict");
const { ethers } = require("hardhat");

describe("Ruyi Beast Launchpad", function () {
  const supply = ethers.parseEther("1000000");
  const threshold = ethers.parseEther("10");

  async function deployLaunchpad() {
    const [owner, creator, treasury, pair, alice, bob] = await ethers.getSigners();

    const TokenDeployer = await ethers.getContractFactory("RuyiBeastTokenDeployer");
    const tokenDeployer = await TokenDeployer.deploy();
    await tokenDeployer.waitForDeployment();

    const SaleVaultDeployer = await ethers.getContractFactory("RuyiBeastSaleVaultDeployer");
    const saleVaultDeployer = await SaleVaultDeployer.deploy();
    await saleVaultDeployer.waitForDeployment();

    const Launchpad = await ethers.getContractFactory("RuyiBeastLaunchpad");
    const launchpad = await Launchpad.deploy(
      treasury.address,
      0,
      await tokenDeployer.getAddress(),
      await saleVaultDeployer.getAddress()
    );
    await launchpad.waitForDeployment();

    return { owner, creator, treasury, pair, alice, bob, launchpad, tokenDeployer, saleVaultDeployer };
  }

  function directParams(overrides = {}) {
    return {
      beastName: "Golden Qilin",
      tokenName: "Golden Qilin",
      tokenSymbol: "GQLN",
      metadataURI: "data:application/json;base64,eyJuYW1lIjoiR29sZGVuIFFpbGluIn0=",
      initialSupply: supply,
      auraThreshold: threshold,
      beastType: 0,
      saleSupply: 0,
      mintPrice: 0,
      maxMintPerWallet: 0,
      saleDeadline: 0,
      fundsReceiver: ethers.ZeroAddress,
      ...overrides
    };
  }

  async function deployFixture() {
    const fixture = await deployLaunchpad();
    const { creator, launchpad } = fixture;

    await launchpad.connect(creator).createBeast(directParams());

    const project = await launchpad.getProject(0);
    const token = await ethers.getContractAt("RuyiBeastToken", project.token);
    const vault = await ethers.getContractAt("RuyiBeastVault", await launchpad.vault());

    return { ...fixture, token, vault };
  }

  it("creates a beast token and registers it in the vault", async function () {
    const { creator, launchpad, token, vault } = await deployFixture();

    assert.equal(await launchpad.projectCount(), 1n);
    assert.equal(await token.projectId(), 0n);
    assert.equal(await token.owner(), creator.address);
    assert.equal(await token.balanceOf(creator.address), supply);
    assert.equal(await vault.registeredTokens(await token.getAddress()), true);
  });

  it("takes buy and sell fees into vault pools and accumulates aura", async function () {
    const { creator, pair, alice, token, vault } = await deployFixture();
    const tokenAddress = await token.getAddress();

    await token.connect(creator).setAutomatedMarketMakerPair(pair.address, true);
    await token.connect(creator).transfer(pair.address, ethers.parseEther("100000"));
    await token.connect(creator).enableTrading();

    await token.connect(pair).transfer(alice.address, ethers.parseEther("1000"));

    assert.equal(await token.balanceOf(alice.address), ethers.parseEther("970"));
    assert.equal(await token.balanceOf(await vault.getAddress()), ethers.parseEther("30"));
    assert.equal(await token.PLATFORM_TAX_SHARE_BPS(), 2000n);
    assert.equal(await token.aura(), ethers.parseEther("12"));

    let pools = await vault.poolBalances(tokenAddress);
    assert.equal(pools.evolution, ethers.parseEther("12"));
    assert.equal(pools.fortune, ethers.parseEther("4"));
    assert.equal(pools.risk, ethers.parseEther("4"));
    assert.equal(pools.reward, ethers.parseEther("4"));
    assert.equal(pools.treasury, ethers.parseEther("6"));

    await token.connect(alice).transfer(pair.address, ethers.parseEther("100"));

    assert.equal(await token.balanceOf(pair.address), ethers.parseEther("99095"));
    assert.equal(await token.aura(), ethers.parseEther("13.6"));

    pools = await vault.poolBalances(tokenAddress);
    assert.equal(pools.evolution, ethers.parseEther("13.6"));
    assert.equal(pools.fortune, ethers.parseEther("4.8"));
    assert.equal(pools.risk, ethers.parseEther("4.8"));
    assert.equal(pools.reward, ethers.parseEther("4.4"));
    assert.equal(pools.treasury, ethers.parseEther("7.4"));
  });

  it("evolves, burns evolution pool tokens, and releases holder dividends", async function () {
    const { creator, pair, alice, token, vault } = await deployFixture();
    const tokenAddress = await token.getAddress();

    await token.connect(creator).setAutomatedMarketMakerPair(pair.address, true);
    await token.connect(creator).transfer(pair.address, ethers.parseEther("100000"));
    await token.connect(creator).enableTrading();
    await token.connect(pair).transfer(alice.address, ethers.parseEther("1000"));

    await token.connect(alice).triggerEvolution();

    assert.equal(await token.stage(), 1n);
    assert.equal(await token.aura(), ethers.parseEther("2"));
    assert.equal(await token.auraThreshold(), ethers.parseEther("15"));

    const pools = await vault.poolBalances(tokenAddress);
    assert.equal(pools.evolution, ethers.parseEther("6"));
    assert.equal(pools.reward, ethers.parseEther("2"));
    assert.equal(pools.burned, ethers.parseEther("6"));
    assert.equal(pools.dividendReserve, ethers.parseEther("2"));
    assert.equal(await token.totalSupply(), supply - ethers.parseEther("6"));

    const withdrawable = await token.withdrawableDividendOf(alice.address);
    assert.ok(withdrawable > 0n);

    const before = await token.balanceOf(alice.address);
    await token.connect(alice).claimDividends();
    const after = await token.balanceOf(alice.address);

    assert.equal(after - before, withdrawable);

    const poolsAfterClaim = await vault.poolBalances(tokenAddress);
    assert.equal(poolsAfterClaim.dividendsPaid, withdrawable);
  });

  it("locks trading controls after launch opens", async function () {
    const { creator, pair, alice, bob, token } = await deployFixture();

    await token.connect(creator).transfer(alice.address, ethers.parseEther("100"));
    await assert.rejects(
      token.connect(alice).transfer(bob.address, ethers.parseEther("1")),
      /trading disabled/
    );

    await token.connect(creator).setAutomatedMarketMakerPair(pair.address, true);
    await token.connect(creator).enableTrading();

    assert.equal(await token.controlsLocked(), true);
    await assert.rejects(
      token.connect(creator).setFees([100, 0, 0, 0, 0, 0], [100, 0, 0, 0, 0, 0]),
      /controls locked/
    );
  });

  it("supports a public sale vault and finalizes trading", async function () {
    const { creator, treasury, pair, alice, bob, launchpad } = await deployLaunchpad();
    const latest = await ethers.provider.getBlock("latest");
    const saleSupply = ethers.parseEther("1000");
    const initialSupply = ethers.parseEther("10000");

    await launchpad.connect(creator).createBeast(directParams({
      initialSupply,
      auraThreshold: ethers.parseEther("100"),
      saleSupply,
      mintPrice: ethers.parseEther("0.001"),
      maxMintPerWallet: ethers.parseEther("600"),
      saleDeadline: latest.timestamp + 3600,
      fundsReceiver: treasury.address
    }));

    const project = await launchpad.getProject(0);
    const token = await ethers.getContractAt("RuyiBeastToken", project.token);
    const saleVaultAddress = await launchpad.projectSaleVault(0);
    const saleVault = await ethers.getContractAt("RuyiBeastSaleVault", saleVaultAddress);

    assert.equal(await token.owner(), saleVaultAddress);
    assert.equal(await token.balanceOf(creator.address), initialSupply - saleSupply);
    assert.equal(await token.balanceOf(saleVaultAddress), saleSupply);

    await saleVault.connect(alice).buy(ethers.parseEther("400"), { value: ethers.parseEther("0.4") });
    await saleVault.connect(bob).buy(ethers.parseEther("600"), { value: ethers.parseEther("0.6") });

    assert.equal(await token.balanceOf(alice.address), ethers.parseEther("400"));
    assert.equal(await saleVault.remainingSaleSupply(), 0n);

    const treasuryBefore = await ethers.provider.getBalance(treasury.address);
    await saleVault.connect(creator).finalize(pair.address);
    const treasuryAfter = await ethers.provider.getBalance(treasury.address);

    assert.equal(treasuryAfter - treasuryBefore, ethers.parseEther("1"));
    assert.equal(await token.owner(), creator.address);
    assert.equal(await token.tradingEnabled(), true);
    assert.equal(await token.controlsLocked(), true);
    assert.equal(await token.automatedMarketMakerPairs(pair.address), true);
  });

  it("allows cancelled launch refunds after deadline", async function () {
    const { creator, pair, alice, launchpad } = await deployLaunchpad();
    const latest = await ethers.provider.getBlock("latest");

    await launchpad.connect(creator).createBeast(directParams({
      initialSupply: ethers.parseEther("10000"),
      auraThreshold: ethers.parseEther("100"),
      saleSupply: ethers.parseEther("1000"),
      mintPrice: ethers.parseEther("0.001"),
      maxMintPerWallet: ethers.parseEther("1000"),
      saleDeadline: latest.timestamp + 10,
      fundsReceiver: creator.address
    }));

    const project = await launchpad.getProject(0);
    const token = await ethers.getContractAt("RuyiBeastToken", project.token);
    const saleVaultAddress = await launchpad.projectSaleVault(0);
    const saleVault = await ethers.getContractAt("RuyiBeastSaleVault", saleVaultAddress);

    const bought = ethers.parseEther("100");
    await saleVault.connect(alice).buy(bought, { value: ethers.parseEther("0.1") });

    await ethers.provider.send("evm_increaseTime", [11]);
    await ethers.provider.send("evm_mine", []);

    await saleVault.connect(creator).cancel();
    await token.connect(alice).approve(saleVaultAddress, bought);
    await saleVault.connect(alice).claimRefund();

    assert.equal(await saleVault.purchased(alice.address), 0n);
    assert.equal(await saleVault.nativeRaised(), 0n);
    assert.equal(await token.balanceOf(alice.address), 0n);

    await saleVault.connect(creator).withdrawCancelledTokens(creator.address);
    assert.equal(await token.owner(), creator.address);
    await assert.rejects(
      saleVault.connect(creator).finalize(pair.address),
      /cancelled/
    );
  });

  it("caps fee configuration", async function () {
    const { creator, token } = await deployFixture();

    const badBuyFees = [600, 0, 0, 0, 0, 0];
    const sellFees = [200, 100, 100, 50, 50, 0];

    await assert.rejects(
      token.connect(creator).setFees(badBuyFees, sellFees),
      /buy tax too high/
    );
  });
});
