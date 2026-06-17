const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("hardhat");

const beasts = [
  ["金曜麒麟", "Golden Qilin", "GQLN", 0, "100"],
  ["赤羽凤凰", "Phoenix Rise", "PHX", 1, "200"],
  ["苍曜青龙", "Azure Dragon", "AZD", 4, "300"],
  ["银甲白虎", "White Tiger", "WHT", 5, "400"]
];

function metadataURI(beastName, tokenName, tokenSymbol, beastType) {
  const payload = {
    name: beastName,
    tokenName,
    symbol: tokenSymbol,
    beastType,
    image: "",
    storage: "local-seed-data-uri"
  };
  return `data:application/json;base64,${Buffer.from(JSON.stringify(payload)).toString("base64")}`;
}

function feeRates(evolution = 0, fortune = 0, risk = 0, reward = 0, treasury = 0, burn = 0) {
  return { evolution, fortune, risk, reward, treasury, burn };
}

async function main() {
  const deploymentPath = path.join(__dirname, "..", "web", "deployments", "latest.json");
  if (!fs.existsSync(deploymentPath)) {
    throw new Error("Missing web/deployments/latest.json. Run npm run deploy:local first.");
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const [deployer, creator, pair, alice, bob] = await ethers.getSigners();
  const launchpad = await ethers.getContractAt("RuyiBeastLaunchpad", deployment.launchpadAddress);

  const countBefore = Number(await launchpad.projectCount());
  if (countBefore > 0) {
    console.log(`Seed skipped: ${countBefore} projects already exist.`);
    return;
  }

  for (const [beastName, tokenName, tokenSymbol, beastType, threshold] of beasts) {
    const tx = await launchpad.connect(creator).createBeast({
      beastName,
      tokenName,
      tokenSymbol,
      metadataURI: metadataURI(beastName, tokenName, tokenSymbol, beastType),
      initialSupply: ethers.parseEther("1000000"),
      auraThreshold: ethers.parseEther(threshold),
      beastType,
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
      salt: ethers.ZeroHash
    });
    await tx.wait();
  }

  const count = Number(await launchpad.projectCount());
  for (let i = 0; i < count; i++) {
    const project = await launchpad.getProject(i);
    const token = await ethers.getContractAt("RuyiBeastToken", project.token);

    await (await token.connect(creator).setAutomatedMarketMakerPair(pair.address, true)).wait();
    await (await token.connect(creator).transfer(pair.address, ethers.parseEther("100000"))).wait();
    await (await token.connect(creator).enableTrading()).wait();

    const buyAmount = ethers.parseEther(String(7000 + i * 1500));
    await (await token.connect(pair).transfer(alice.address, buyAmount)).wait();
    await (await token.connect(pair).transfer(bob.address, buyAmount / 2n)).wait();

    if (i === 0) {
      await (await token.connect(alice).triggerEvolution()).wait();
    }
  }

  console.log(`Seeded ${count} real on-chain beast projects.`);
  console.log(`Launchpad: ${deployment.launchpadAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
