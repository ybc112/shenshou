const assert = require("node:assert/strict");
const { ethers } = require("hardhat");

describe("Ruyi Beast Launchpad", function () {
  const supply = ethers.parseEther("1000000");
  const threshold = ethers.parseEther("10");

  async function deployFixture() {
    const [owner, creator, treasury, pair, alice, bob] = await ethers.getSigners();

    const Launchpad = await ethers.getContractFactory("RuyiBeastLaunchpad");
    const launchpad = await Launchpad.deploy(treasury.address, 0);
    await launchpad.waitForDeployment();

    await launchpad.connect(creator).createBeast({
      beastName: "Golden Qilin",
      tokenName: "Golden Qilin",
      tokenSymbol: "GQLN",
      metadataURI: "ipfs://golden-qilin",
      initialSupply: supply,
      auraThreshold: threshold,
      beastType: 0
    });

    const project = await launchpad.getProject(0);
    const token = await ethers.getContractAt("RuyiBeastToken", project.token);
    const vault = await ethers.getContractAt("RuyiBeastVault", await launchpad.vault());

    return { owner, creator, treasury, pair, alice, bob, launchpad, token, vault };
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
    assert.equal(await token.aura(), ethers.parseEther("15"));

    let pools = await vault.poolBalances(tokenAddress);
    assert.equal(pools.evolution, ethers.parseEther("15"));
    assert.equal(pools.fortune, ethers.parseEther("5"));
    assert.equal(pools.risk, ethers.parseEther("5"));
    assert.equal(pools.reward, ethers.parseEther("5"));

    await token.connect(alice).transfer(pair.address, ethers.parseEther("100"));

    assert.equal(await token.balanceOf(pair.address), ethers.parseEther("99095"));
    assert.equal(await token.aura(), ethers.parseEther("17"));

    pools = await vault.poolBalances(tokenAddress);
    assert.equal(pools.evolution, ethers.parseEther("17"));
    assert.equal(pools.fortune, ethers.parseEther("6"));
    assert.equal(pools.risk, ethers.parseEther("6"));
    assert.equal(pools.reward, ethers.parseEther("5.5"));
    assert.equal(pools.treasury, ethers.parseEther("0.5"));
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
    assert.equal(await token.aura(), ethers.parseEther("5"));
    assert.equal(await token.auraThreshold(), ethers.parseEther("15"));

    const pools = await vault.poolBalances(tokenAddress);
    assert.equal(pools.evolution, ethers.parseEther("7.5"));
    assert.equal(pools.reward, ethers.parseEther("2.5"));
    assert.equal(pools.burned, ethers.parseEther("7.5"));
    assert.equal(pools.dividendReserve, ethers.parseEther("2.5"));
    assert.equal(await token.totalSupply(), supply - ethers.parseEther("7.5"));

    const withdrawable = await token.withdrawableDividendOf(alice.address);
    assert.ok(withdrawable > 0n);

    const before = await token.balanceOf(alice.address);
    await token.connect(alice).claimDividends();
    const after = await token.balanceOf(alice.address);

    assert.equal(after - before, withdrawable);

    const poolsAfterClaim = await vault.poolBalances(tokenAddress);
    assert.equal(poolsAfterClaim.dividendsPaid, withdrawable);
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
