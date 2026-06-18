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

async function verifyContract(address, constructorArguments = [], contract = undefined) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const taskArgs = {
        address,
        constructorArguments
      };
      if (contract) taskArgs.contract = contract;
      await hre.run("verify:verify", taskArgs);
      console.log(`Verified: ${address}`);
      return;
    } catch (error) {
      const message = error?.message || String(error);
      if (message.toLowerCase().includes("already verified")) {
        console.log(`Already verified: ${address}`);
        return;
      }
      if (await waitForSourceCode(address)) {
        console.log(`Verified source is visible: ${address}`);
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

async function waitForSourceCode(address) {
  const apiKey = process.env.BSCSCAN_API_KEY || process.env.ETHERSCAN_API_KEY || "";
  if (!apiKey || typeof fetch !== "function") return false;

  const endpoint = process.env.ETHERSCAN_V2_API_URL || "https://api.etherscan.com/v2/api";
  const chainId = process.env.RUYI_CHAIN_ID || "56";

  for (let attempt = 1; attempt <= 8; attempt++) {
    const params = new URLSearchParams({
      chainid: chainId,
      module: "contract",
      action: "getsourcecode",
      address,
      apikey: apiKey
    });

    try {
      const response = await fetch(`${endpoint}?${params.toString()}`);
      const json = await response.json();
      const item = Array.isArray(json.result) ? json.result[0] : null;
      if (json.status === "1" && item?.SourceCode) {
        return true;
      }
    } catch {
      // The normal Hardhat verify output above is more useful than a transient status check.
    }

    await sleep(15000);
  }

  return false;
}

async function main() {
  const deploymentPath = path.join(__dirname, "..", "web", "deployments", "latest.json");
  if (!fs.existsSync(deploymentPath)) {
    throw new Error(`Deployment file not found: ${deploymentPath}`);
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));

  await verifyContract(
    deployment.tokenDeployerAddress,
    [],
    "contracts/RuyiBeastDeployers.sol:RuyiBeastTokenDeployer"
  );
  await verifyContract(
    deployment.saleVaultDeployerAddress,
    [],
    "contracts/RuyiBeastDeployers.sol:RuyiBeastSaleVaultDeployer"
  );
  await verifyContract(deployment.launchpadAddress, [
    deployment.platformTreasury,
    deployment.creationFee,
    deployment.tokenDeployerAddress,
    deployment.saleVaultDeployerAddress
  ], "contracts/RuyiBeastLaunchpad.sol:RuyiBeastLaunchpad");
  await verifyContract(deployment.vaultAddress, [deployment.launchpadAddress], "contracts/RuyiBeastVault.sol:RuyiBeastVault");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
