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
    await launchpad.setRequiredTokenSuffix(0);

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
      mintCount: 0,
      tokensPerMint: 0,
      mintPrice: 0,
      maxMintPerWallet: 0,
      whitelistMintLimit: 0,
      whitelistEnabled: false,
      saleDeadline: 0,
      fundsReceiver: ethers.ZeroAddress,
      buyFees: feeRates(),
      sellFees: feeRates(),
      customFees: false,
      autoOpenTrading: true,
      salt: ethers.ZeroHash,
      ...overrides
    };
  }

  function feeRates(evolution = 0, fortune = 0, risk = 0, reward = 0, treasury = 0, burn = 0) {
    return { evolution, fortune, risk, reward, treasury, burn };
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

  it("applies custom launch taxes during creation", async function () {
    const { creator, launchpad } = await deployLaunchpad();

    await launchpad.connect(creator).createBeast(directParams({
      buyFees: feeRates(100, 50, 0, 0, 0, 0),
      sellFees: feeRates(200, 100, 100, 50, 50, 0),
      customFees: true
    }));

    const project = await launchpad.getProject(0);
    const token = await ethers.getContractAt("RuyiBeastToken", project.token);

    assert.equal(await token.owner(), creator.address);
    assert.equal(await token.totalFeeBps(false), 150n);
    assert.equal(await token.totalFeeBps(true), 500n);
    assert.equal(await token.balanceOf(creator.address), supply);
  });

  it("takes buy and sell fees into vault pools and accumulates aura", async function () {
    const { creator, pair, alice, token, vault } = await deployFixture();
    const tokenAddress = await token.getAddress();

    await token.connect(creator).setAutomatedMarketMakerPair(pair.address, true);
    await token.connect(creator).transfer(pair.address, ethers.parseEther("100000"));
    await token.connect(creator).enableTrading();

    await token.connect(pair).transfer(alice.address, ethers.parseEther("1000"));

    assert.equal(await token.airdropNumbs(), 3n);
    assert.equal(await token.balanceOf(alice.address), ethers.parseEther("970") - 3n);
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

    assert.equal(await token.balanceOf(pair.address), ethers.parseEther("99095") - 3n);
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
    assert.equal(await token.totalSupply(), supply);
    assert.equal(await token.balanceOf("0x000000000000000000000000000000000000dEaD"), ethers.parseEther("6"));

    const withdrawable = await token.withdrawableDividendOf(alice.address);
    assert.ok(withdrawable > 0n);

    const before = await token.balanceOf(alice.address);
    await token.connect(alice).claimDividends();
    const after = await token.balanceOf(alice.address);

    assert.equal(after - before, withdrawable);

    const poolsAfterClaim = await vault.poolBalances(tokenAddress);
    assert.equal(poolsAfterClaim.dividendsPaid, withdrawable);
  });

  it("pays talisman and lucky number rewards from on-chain pools", async function () {
    const { owner, creator, pair, alice, token, vault, launchpad } = await deployFixture();
    const tokenAddress = await token.getAddress();

    await token.connect(creator).setAutomatedMarketMakerPair(pair.address, true);
    await token.connect(creator).transfer(pair.address, ethers.parseEther("100000"));
    await token.connect(creator).enableTrading();
    await token.connect(pair).transfer(alice.address, ethers.parseEther("1000"));

    await launchpad.connect(creator).setRewardConfig(
      tokenAddress,
      10000,
      5000,
      5000,
      1,
      1,
      true
    );

    await launchpad.connect(alice).assignLuckyNumber(tokenAddress);
    assert.equal(await vault.hasLuckyNumber(tokenAddress, alice.address), true);
    assert.equal(await vault.luckyNumbers(tokenAddress, alice.address), 0n);

    await token.connect(alice).triggerEvolution();
    assert.equal(await vault.talismanRound(tokenAddress), 1n);
    assert.equal(await vault.luckyRound(tokenAddress), 1n);
    assert.equal(await vault.luckyWinningNumbers(tokenAddress, 1), 0n);

    const beforeTalisman = await token.balanceOf(alice.address);
    await launchpad.connect(alice).claimTalismanReward(tokenAddress);
    const afterTalisman = await token.balanceOf(alice.address);
    assert.equal(afterTalisman - beforeTalisman, ethers.parseEther("2"));

    await assert.rejects(
      launchpad.connect(alice).claimTalismanReward(tokenAddress),
      /talisman claimed/
    );

    const beforeLucky = await token.balanceOf(alice.address);
    await launchpad.connect(alice).claimLuckyNumberReward(tokenAddress, 1);
    const afterLucky = await token.balanceOf(alice.address);
    assert.equal(afterLucky - beforeLucky, ethers.parseEther("2"));

    await assert.rejects(
      launchpad.connect(alice).claimLuckyNumberReward(tokenAddress, 1),
      /lucky claimed/
    );

    const pools = await vault.poolBalances(tokenAddress);
    assert.equal(pools.fortune, ethers.parseEther("2"));
    assert.equal(pools.risk, ethers.parseEther("2"));
  });

  it("lets the project creator manage project mechanisms", async function () {
    const { owner, creator, pair, alice, token, vault, launchpad } = await deployFixture();
    const tokenAddress = await token.getAddress();
    const dead = "0x000000000000000000000000000000000000dEaD";

    assert.equal(await launchpad.isProjectOperator(tokenAddress, creator.address), true);
    assert.equal(await launchpad.isProjectOperator(tokenAddress, owner.address), false);
    assert.equal(await launchpad.isProjectOperator(tokenAddress, alice.address), false);

    await launchpad.connect(creator).setEvolutionPayoutConfig(tokenAddress, 2500, 7500);
    const evolution = await vault.evolutionPayoutConfigs(tokenAddress);
    assert.equal(evolution.burnBps, 2500n);
    assert.equal(evolution.rewardDividendBps, 7500n);

    assert.equal(await token.airdropNumbs(), 3n);
    await launchpad.connect(creator).setAirdropNumbs(tokenAddress, 1);
    assert.equal(await token.airdropNumbs(), 1n);
    await assert.rejects(
      launchpad.connect(creator).setAirdropNumbs(tokenAddress, 4)
    );

    await launchpad.connect(creator).setRewardConfig(
      tokenAddress,
      2000,
      1500,
      1200,
      8888,
      ethers.parseEther("10"),
      true
    );
    const reward = await vault.rewardConfigs(tokenAddress);
    assert.equal(reward.talismanChanceBps, 2000n);
    assert.equal(reward.talismanPrizeBps, 1500n);
    assert.equal(reward.luckyPrizeBps, 1200n);
    assert.equal(reward.luckyModulo, 8888n);
    assert.equal(reward.minHoldAmount, ethers.parseEther("10"));
    assert.equal(reward.enabled, true);

    const round = await launchpad.connect(creator).openRewardRound.staticCall(tokenAddress);
    await launchpad.connect(creator).openRewardRound(tokenAddress);
    assert.equal(round, 1n);
    assert.equal(await vault.talismanRound(tokenAddress), 1n);

    const MockDexRouter = await ethers.getContractFactory("MockDexRouter");
    const router = await MockDexRouter.deploy(ethers.Wallet.createRandom().address);
    await router.waitForDeployment();
    const routerAddress = await router.getAddress();

    await launchpad.connect(creator).setDexConfig(
      tokenAddress,
      routerAddress,
      ethers.ZeroAddress,
      pair.address,
      dead,
      ethers.ZeroAddress,
      true,
      true,
      true
    );
    await launchpad.connect(creator).setDexAutomationConfig(
      tokenAddress,
      6000,
      4000,
      ethers.parseEther("1"),
      ethers.parseEther("3")
    );
    const dex = await vault.dexConfigs(tokenAddress);
    assert.equal(dex.router, routerAddress);
    assert.equal(dex.pair, pair.address);
    assert.equal(dex.liquidityReceiver, dead);
    assert.equal(dex.buybackRecipient, dead);
    assert.equal(dex.autoBuybackBps, 6000n);
    assert.equal(dex.autoLiquidityBps, 4000n);

    await launchpad.connect(creator).processAutoDex(tokenAddress);

    await assert.rejects(
      launchpad.connect(alice).setEvolutionPayoutConfig(tokenAddress, 5000, 5000),
      /not project operator/
    );
    await assert.rejects(
      launchpad.connect(alice).setAirdropNumbs(tokenAddress, 0),
      /not project operator/
    );

    await assert.rejects(
      launchpad.connect(owner).setEvolutionPayoutConfig(tokenAddress, 5000, 5000),
      /not project operator/
    );
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

  it("supports mint-based launch with automatic liquidity", async function () {
    const { creator, treasury, pair, alice, bob, launchpad } = await deployLaunchpad();
    const latest = await ethers.provider.getBlock("latest");
    const initialSupply = ethers.parseEther("10000");
    const tokensPerMint = ethers.parseEther("100");
    const mintCount = 10n;
    const saleSupply = tokensPerMint * mintCount * 2n;
    const dead = "0x000000000000000000000000000000000000dEaD";

    const MockDexRouter = await ethers.getContractFactory("MockDexRouter");
    const router = await MockDexRouter.deploy(ethers.Wallet.createRandom().address);
    await router.waitForDeployment();
    const routerAddress = await router.getAddress();
    await launchpad.setDefaultMintLiquidityRouter(routerAddress);

    await launchpad.connect(creator).createBeast(directParams({
      initialSupply,
      auraThreshold: ethers.parseEther("100"),
      mintCount,
      tokensPerMint,
      mintPrice: ethers.parseEther("0.001"),
      maxMintPerWallet: 6,
      whitelistMintLimit: 0,
      whitelistEnabled: false,
      saleDeadline: latest.timestamp + 3600,
      fundsReceiver: ethers.ZeroAddress
    }));

    const project = await launchpad.getProject(0);
    const token = await ethers.getContractAt("RuyiBeastToken", project.token);
    const saleVaultAddress = await launchpad.projectSaleVault(0);
    const saleVault = await ethers.getContractAt("RuyiBeastSaleVault", saleVaultAddress);

    assert.equal(await token.owner(), saleVaultAddress);
    assert.equal(await token.balanceOf(creator.address), initialSupply - saleSupply);
    assert.equal(await token.balanceOf(saleVaultAddress), saleSupply);
    assert.equal(await saleVault.liquidityRouter(), routerAddress);
    assert.equal(await saleVault.liquidityReceiver(), dead);
    assert.equal(await saleVault.mintLiquidityEnabled(), true);
    assert.equal(await saleVault.mintCount(), mintCount);
    assert.equal(await saleVault.tokensPerMint(), tokensPerMint);

    await saleVault.connect(alice).mint(4, { value: ethers.parseEther("0.004") });
    await saleVault.connect(bob).mint(6, { value: ethers.parseEther("0.006") });
    const launchPair = await router.getPair(project.token, await router.WETH());

    assert.equal(await token.balanceOf(alice.address), ethers.parseEther("400"));
    assert.equal(await token.balanceOf(bob.address), ethers.parseEther("600"));
    assert.equal(await token.balanceOf(routerAddress), ethers.parseEther("1000"));
    assert.equal(await ethers.provider.getBalance(routerAddress), ethers.parseEther("0.01"));
    assert.equal(await router.liquidityNonce(), 2n);
    assert.equal(await saleVault.mintedCount(), 10n);
    assert.equal(await saleVault.remainingMintCount(), 0n);
    assert.equal(await saleVault.remainingSaleSupply(), 0n);
    assert.equal(await saleVault.finalized(), true);
    assert.equal(await token.owner(), creator.address);
    assert.equal(await token.tradingEnabled(), true);
    assert.equal(await token.controlsLocked(), true);
    assert.notEqual(launchPair, ethers.ZeroAddress);
    assert.equal(await token.automatedMarketMakerPairs(launchPair), true);
  });

  it("keeps sold-out launches manual when auto open is disabled", async function () {
    const { creator, pair, alice, launchpad } = await deployLaunchpad();
    const latest = await ethers.provider.getBlock("latest");

    const MockDexRouter = await ethers.getContractFactory("MockDexRouter");
    const router = await MockDexRouter.deploy(ethers.Wallet.createRandom().address);
    await router.waitForDeployment();
    await launchpad.setDefaultMintLiquidityRouter(await router.getAddress());

    await launchpad.connect(creator).createBeast(directParams({
      initialSupply: ethers.parseEther("10000"),
      auraThreshold: ethers.parseEther("100"),
      mintCount: 2,
      tokensPerMint: ethers.parseEther("100"),
      mintPrice: ethers.parseEther("0.001"),
      maxMintPerWallet: 2,
      whitelistMintLimit: 0,
      whitelistEnabled: false,
      saleDeadline: latest.timestamp + 3600,
      fundsReceiver: ethers.ZeroAddress,
      autoOpenTrading: false
    }));

    const project = await launchpad.getProject(0);
    const token = await ethers.getContractAt("RuyiBeastToken", project.token);
    const saleVaultAddress = await launchpad.projectSaleVault(0);
    const saleVault = await ethers.getContractAt("RuyiBeastSaleVault", saleVaultAddress);

    await saleVault.connect(alice).mint(2, { value: ethers.parseEther("0.002") });

    assert.equal(await saleVault.finalized(), false);
    assert.equal(await token.tradingEnabled(), false);

    await saleVault.connect(creator).finalize(pair.address);

    assert.equal(await saleVault.finalized(), true);
    assert.equal(await token.tradingEnabled(), true);
    assert.equal(await token.automatedMarketMakerPairs(pair.address), true);
  });

  it("allows direct BNB transfer to the token contract to mint shares", async function () {
    const { creator, alice, launchpad } = await deployLaunchpad();
    const latest = await ethers.provider.getBlock("latest");

    const MockDexRouter = await ethers.getContractFactory("MockDexRouter");
    const router = await MockDexRouter.deploy(ethers.Wallet.createRandom().address);
    await router.waitForDeployment();
    await launchpad.setDefaultMintLiquidityRouter(await router.getAddress());

    await launchpad.connect(creator).createBeast(directParams({
      initialSupply: ethers.parseEther("10000"),
      auraThreshold: ethers.parseEther("100"),
      mintCount: 10,
      tokensPerMint: ethers.parseEther("100"),
      mintPrice: ethers.parseEther("0.001"),
      maxMintPerWallet: 5,
      whitelistMintLimit: 0,
      whitelistEnabled: false,
      saleDeadline: latest.timestamp + 3600,
      fundsReceiver: ethers.ZeroAddress
    }));

    const project = await launchpad.getProject(0);
    const token = await ethers.getContractAt("RuyiBeastToken", project.token);
    const saleVaultAddress = await launchpad.projectSaleVault(0);
    const saleVault = await ethers.getContractAt("RuyiBeastSaleVault", saleVaultAddress);

    await alice.sendTransaction({ to: project.token, value: ethers.parseEther("0.002") });

    assert.equal(await token.balanceOf(alice.address), ethers.parseEther("200"));
    assert.equal(await saleVault.purchased(alice.address), 2n);
    assert.equal(await saleVault.tokensPurchased(alice.address), ethers.parseEther("200"));
  });

  it("gates mint launch through whitelist quota before public mint", async function () {
    const { creator, alice, bob, launchpad } = await deployLaunchpad();
    const latest = await ethers.provider.getBlock("latest");

    const MockDexRouter = await ethers.getContractFactory("MockDexRouter");
    const router = await MockDexRouter.deploy(ethers.Wallet.createRandom().address);
    await router.waitForDeployment();
    await launchpad.setDefaultMintLiquidityRouter(await router.getAddress());

    await launchpad.connect(creator).createBeast(directParams({
      initialSupply: ethers.parseEther("10000"),
      auraThreshold: ethers.parseEther("100"),
      mintCount: 20,
      tokensPerMint: ethers.parseEther("100"),
      mintPrice: ethers.parseEther("0.001"),
      maxMintPerWallet: 10,
      whitelistMintLimit: 3,
      whitelistEnabled: true,
      saleDeadline: latest.timestamp + 3600,
      fundsReceiver: ethers.ZeroAddress
    }));

    const saleVaultAddress = await launchpad.projectSaleVault(0);
    const saleVault = await ethers.getContractAt("RuyiBeastSaleVault", saleVaultAddress);

    await assert.rejects(
      saleVault.connect(bob).mint(1, { value: ethers.parseEther("0.001") }),
      /not whitelisted/
    );

    await saleVault.connect(creator).setWhitelistAccount(alice.address, true);
    assert.equal(await saleVault.whitelistList(alice.address), true);
    assert.equal(await saleVault.whitelistRemaining(alice.address), 3n);

    await saleVault.connect(alice).mint(3, { value: ethers.parseEther("0.003") });
    assert.equal(await saleVault.whitelistMinted(), 3n);
    assert.equal(await saleVault.whitelistMintedByWallet(alice.address), 3n);

    await saleVault.connect(bob).mint(1, { value: ethers.parseEther("0.001") });
    assert.equal(await saleVault.publicMinted(), 1n);
  });

  it("allows cancellation only before any mint starts", async function () {
    const { creator, pair, alice, launchpad } = await deployLaunchpad();
    const latest = await ethers.provider.getBlock("latest");

    const MockDexRouter = await ethers.getContractFactory("MockDexRouter");
    const router = await MockDexRouter.deploy(ethers.Wallet.createRandom().address);
    await router.waitForDeployment();
    await launchpad.setDefaultMintLiquidityRouter(await router.getAddress());

    await launchpad.connect(creator).createBeast(directParams({
      initialSupply: ethers.parseEther("10000"),
      auraThreshold: ethers.parseEther("100"),
      mintCount: 10,
      tokensPerMint: ethers.parseEther("100"),
      mintPrice: ethers.parseEther("0.001"),
      maxMintPerWallet: 10,
      whitelistMintLimit: 0,
      whitelistEnabled: false,
      saleDeadline: latest.timestamp + 10,
      fundsReceiver: creator.address
    }));

    const project = await launchpad.getProject(0);
    const token = await ethers.getContractAt("RuyiBeastToken", project.token);
    const saleVaultAddress = await launchpad.projectSaleVault(0);
    const saleVault = await ethers.getContractAt("RuyiBeastSaleVault", saleVaultAddress);

    await ethers.provider.send("evm_increaseTime", [11]);
    await ethers.provider.send("evm_mine", []);

    await saleVault.connect(creator).cancel();

    assert.equal(await saleVault.nativeRaised(), 0n);
    await assert.rejects(
      saleVault.connect(alice).claimRefund(),
      /auto-liquidity mint has no refunds/
    );

    await saleVault.connect(creator).withdrawCancelledTokens(creator.address);
    assert.equal(await token.owner(), creator.address);
    await assert.rejects(
      saleVault.connect(creator).finalize(pair.address),
      /cancelled/
    );
  });

  it("does not allow cancellation/refunds after mint liquidity starts", async function () {
    const { creator, alice, launchpad } = await deployLaunchpad();
    const latest = await ethers.provider.getBlock("latest");

    const MockDexRouter = await ethers.getContractFactory("MockDexRouter");
    const router = await MockDexRouter.deploy(ethers.Wallet.createRandom().address);
    await router.waitForDeployment();
    await launchpad.setDefaultMintLiquidityRouter(await router.getAddress());

    await launchpad.connect(creator).createBeast(directParams({
      initialSupply: ethers.parseEther("10000"),
      auraThreshold: ethers.parseEther("100"),
      mintCount: 10,
      tokensPerMint: ethers.parseEther("100"),
      mintPrice: ethers.parseEther("0.001"),
      maxMintPerWallet: 10,
      whitelistMintLimit: 0,
      whitelistEnabled: false,
      saleDeadline: latest.timestamp + 10,
      fundsReceiver: creator.address
    }));

    const saleVaultAddress = await launchpad.projectSaleVault(0);
    const saleVault = await ethers.getContractAt("RuyiBeastSaleVault", saleVaultAddress);

    await saleVault.connect(alice).mint(1, { value: ethers.parseEther("0.001") });

    await ethers.provider.send("evm_increaseTime", [11]);
    await ethers.provider.send("evm_mine", []);

    await assert.rejects(
      saleVault.connect(creator).cancel(),
      /mint already started/
    );
    await assert.rejects(
      saleVault.connect(alice).claimRefund(),
      /auto-liquidity mint has no refunds/
    );
  });

  it("executes configured native buyback and liquidity add through the vault", async function () {
    const { owner, creator, pair, alice, token, vault, launchpad } = await deployFixture();
    const tokenAddress = await token.getAddress();
    const latest = await ethers.provider.getBlock("latest");

    await token.connect(creator).setAutomatedMarketMakerPair(pair.address, true);
    await token.connect(creator).transfer(pair.address, ethers.parseEther("100000"));
    await token.connect(creator).enableTrading();
    await token.connect(pair).transfer(alice.address, ethers.parseEther("1000"));

    const MockDexRouter = await ethers.getContractFactory("MockDexRouter");
    const router = await MockDexRouter.deploy(ethers.Wallet.createRandom().address);
    await router.waitForDeployment();
    const routerAddress = await router.getAddress();

    await token.connect(creator).transfer(routerAddress, ethers.parseEther("10"));
    await launchpad.connect(creator).setDexConfig(
      tokenAddress,
      routerAddress,
      ethers.ZeroAddress,
      pair.address,
      alice.address,
      ethers.ZeroAddress,
      true,
      true,
      true
    );

    await assert.rejects(
      launchpad.connect(owner).executeNativeBuyback(
        tokenAddress,
        ethers.parseEther("1"),
        latest.timestamp + 3600,
        { value: ethers.parseEther("0.1") }
      ),
      /not project operator/
    );

    await launchpad.connect(creator).executeNativeBuyback(
      tokenAddress,
      ethers.parseEther("1"),
      latest.timestamp + 3600,
      { value: ethers.parseEther("0.1") }
    );
    assert.equal(await token.balanceOf("0x000000000000000000000000000000000000dEaD"), ethers.parseEther("1"));

    const poolsBefore = await vault.poolBalances(tokenAddress);
    await launchpad.connect(creator).executeAddLiquidityNative(
      tokenAddress,
      ethers.parseEther("1"),
      0,
      0,
      latest.timestamp + 3600,
      { value: ethers.parseEther("0.2") }
    );
    const poolsAfter = await vault.poolBalances(tokenAddress);

    assert.equal(poolsBefore.treasury - poolsAfter.treasury, ethers.parseEther("1"));
    assert.equal(await token.balanceOf(routerAddress), ethers.parseEther("10"));
  });

  it("automatically processes treasury tokens into buyback and liquidity on sells", async function () {
    const { owner, creator, pair, alice, token, vault, launchpad } = await deployFixture();
    const tokenAddress = await token.getAddress();
    const dead = "0x000000000000000000000000000000000000dEaD";

    await token.connect(creator).setAutomatedMarketMakerPair(pair.address, true);
    await token.connect(creator).transfer(pair.address, ethers.parseEther("100000"));

    const MockDexRouter = await ethers.getContractFactory("MockDexRouter");
    const router = await MockDexRouter.deploy(ethers.Wallet.createRandom().address);
    await router.waitForDeployment();
    const routerAddress = await router.getAddress();

    await token.connect(creator).transfer(routerAddress, ethers.parseEther("100"));
    await owner.sendTransaction({ to: routerAddress, value: ethers.parseEther("100") });

    await launchpad.connect(creator).setDexConfig(
      tokenAddress,
      routerAddress,
      ethers.ZeroAddress,
      pair.address,
      alice.address,
      ethers.ZeroAddress,
      true,
      true,
      true
    );
    await launchpad.connect(creator).setDexAutomationConfig(
      tokenAddress,
      5000,
      5000,
      ethers.parseEther("1"),
      ethers.parseEther("4")
    );

    await token.connect(creator).enableTrading();
    await token.connect(pair).transfer(alice.address, ethers.parseEther("1000"));

    const poolsBeforeSell = await vault.poolBalances(tokenAddress);
    assert.equal(poolsBeforeSell.treasury, ethers.parseEther("6"));

    await token.connect(alice).transfer(pair.address, ethers.parseEther("100"));
    const poolsAfterSell = await vault.poolBalances(tokenAddress);

    assert.equal(poolsAfterSell.treasury, ethers.parseEther("3.4"));
    assert.equal(await token.balanceOf(dead), ethers.parseEther("2"));
    assert.equal(await router.liquidityNonce(), 1n);
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
