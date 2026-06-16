const { ethers } = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const treasury = process.env.TREASURY || process.env.FEE_RECIPIENT || deployer.address;
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

  const network = await ethers.provider.getNetwork();
  const deployment = {
    chainId: Number(network.chainId),
    network: network.name,
    tokenDeployerAddress: await tokenDeployer.getAddress(),
    saleVaultDeployerAddress: await saleVaultDeployer.getAddress(),
    launchpadAddress: await launchpad.getAddress(),
    vaultAddress: await launchpad.vault(),
    platformTreasury: treasury,
    creationFee,
    deployedAt: new Date().toISOString()
  };

  const webDir = path.join(__dirname, "..", "web");
  const deploymentsDir = path.join(webDir, "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  fs.writeFileSync(path.join(deploymentsDir, "latest.json"), JSON.stringify(deployment, null, 2));
  fs.writeFileSync(
    path.join(webDir, "config.js"),
    `window.RUYI_CONFIG = ${JSON.stringify(
      {
        launchpadAddress: deployment.launchpadAddress,
        rpcUrl: process.env.FRONTEND_RPC_URL || "",
        chainId: deployment.chainId
      },
      null,
      2
    )};\n`
  );

  console.log("Frontend config:", path.join(webDir, "config.js"));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
