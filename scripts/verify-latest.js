const hre = require("hardhat");
const fs = require("node:fs");
const path = require("node:path");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetryableExplorerError(message) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("network request failed") ||
    normalized.includes("socket disconnected") ||
    normalized.includes("timeout") ||
    normalized.includes("econnreset")
  );
}

async function verifyContract(address, constructorArguments = []) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await hre.run("verify:verify", {
        address,
        constructorArguments
      });
      console.log(`Verified: ${address}`);
      return;
    } catch (error) {
      const message = error?.message || String(error);
      if (message.toLowerCase().includes("already verified")) {
        console.log(`Already verified: ${address}`);
        return;
      }
      if (attempt < 5 && isRetryableExplorerError(message)) {
        console.log(`Explorer request failed, retrying ${address} (${attempt}/5)`);
        await sleep(10000);
        continue;
      }
      throw error;
    }
  }
}

async function main() {
  const deploymentPath = path.join(__dirname, "..", "web", "deployments", "latest.json");
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`Deployment file not found: ${deploymentPath}`);
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  await verifyContract(deployment.tokenDeployerAddress);
  await verifyContract(deployment.saleVaultDeployerAddress);
  await verifyContract(deployment.launchpadAddress, [
    deployment.platformTreasury,
    deployment.creationFee,
    deployment.tokenDeployerAddress,
    deployment.saleVaultDeployerAddress
  ]);
  await verifyContract(deployment.vaultAddress, [deployment.launchpadAddress]);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
