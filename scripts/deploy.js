const { ethers } = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const treasury = process.env.TREASURY || deployer.address;
  const creationFee = process.env.CREATION_FEE_WEI || "0";

  const Launchpad = await ethers.getContractFactory("RuyiBeastLaunchpad");
  const launchpad = await Launchpad.deploy(treasury, creationFee);
  await launchpad.waitForDeployment();

  console.log("RuyiBeastLaunchpad:", await launchpad.getAddress());
  console.log("RuyiBeastVault:", await launchpad.vault());
  console.log("Platform treasury:", treasury);
  console.log("Creation fee:", creationFee);

  const network = await ethers.provider.getNetwork();
  const deployment = {
    chainId: Number(network.chainId),
    network: network.name,
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
