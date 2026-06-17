const { ethers } = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_PLATFORM_TREASURY = "0xdE24f90b7802E32982E1af679449bA7FD6c3501D";

function readExistingFrontendConfig(webDir) {
  const configPath = path.join(webDir, "config.js");
  if (!fs.existsSync(configPath)) return {};

  const content = fs.readFileSync(configPath, "utf8");
  const match = content.match(/window\.RUYI_CONFIG\s*=\s*(\{[\s\S]*?\});?\s*$/);
  if (!match) return {};

  try {
    return JSON.parse(match[1]);
  } catch {
    return {};
  }
}

function writeFrontendConfig(webDir, deployment) {
  const existing = readExistingFrontendConfig(webDir);
  const config = {
    ...existing,
    launchpadAddress: deployment.launchpadAddress,
    rpcUrl: process.env.FRONTEND_RPC_URL ?? existing.rpcUrl ?? "",
    chainId: deployment.chainId
  };

  fs.writeFileSync(
    path.join(webDir, "config.js"),
    `window.RUYI_CONFIG = ${JSON.stringify(config, null, 2)};\n`
  );
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const treasury = process.env.TREASURY || DEFAULT_PLATFORM_TREASURY;
  const creationFee = process.env.CREATION_FEE_WEI || (
    process.env.CREATION_FEE_BNB ? ethers.parseEther(process.env.CREATION_FEE_BNB).toString() : "0"
  );

  const TokenDeployer = await ethers.getContractFactory("RuyiBeastTokenDeployer");
  const tokenDeployer = await TokenDeployer.deploy();
  await tokenDeployer.waitForDeployment();

  const SaleVaultDeployer = await ethers.getContractFactory("RuyiBeastSaleVaultDeployer");
  const saleVaultDeployer = await SaleVaultDeployer.deploy();
  await saleVaultDeployer.waitForDeployment();

  const Launchpad = await ethers.getContractFactory("RuyiBeastLaunchpad");
  const launchpad = await Launchpad.deploy(
    treasury,
    creationFee,
    await tokenDeployer.getAddress(),
    await saleVaultDeployer.getAddress()
  );
  await launchpad.waitForDeployment();

  console.log("RuyiBeastTokenDeployer:", await tokenDeployer.getAddress());
  console.log("RuyiBeastSaleVaultDeployer:", await saleVaultDeployer.getAddress());
  console.log("RuyiBeastLaunchpad:", await launchpad.getAddress());
  console.log("RuyiBeastVault:", await launchpad.vault());
  console.log("Platform treasury:", treasury);
  console.log("Creation fee:", creationFee);
  console.log("Required token suffix:", (await launchpad.requiredTokenSuffix()).toString(16).padStart(4, "0"));

  const network = await ethers.provider.getNetwork();
  const deployment = {
    chainId: Number(network.chainId),
    network: network.name,
    tokenDeployerAddress: await tokenDeployer.getAddress(),
    saleVaultDeployerAddress: await saleVaultDeployer.getAddress(),
    launchpadAddress: await launchpad.getAddress(),
    vaultAddress: await launchpad.vault(),
    platformTreasury: treasury,
    requiredTokenSuffix: (await launchpad.requiredTokenSuffix()).toString(16).padStart(4, "0"),
    creationFee,
    deployedAt: new Date().toISOString()
  };

  const webDir = path.join(__dirname, "..", "web");
  const deploymentsDir = path.join(webDir, "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(path.join(deploymentsDir, "latest.json"), JSON.stringify(deployment, null, 2));
  writeFrontendConfig(webDir, deployment);

  console.log("Frontend config:", path.join(webDir, "config.js"));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
