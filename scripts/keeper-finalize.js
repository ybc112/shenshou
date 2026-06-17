const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("hardhat");

const PANCAKE_FACTORY = "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73";
const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";

const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)"
];

const SALE_VAULT_ABI = [
  "function finalized() view returns (bool)",
  "function cancelled() view returns (bool)",
  "function saleDeadline() view returns (uint256)",
  "function creator() view returns (address)",
  "function finalize(address pair) external"
];

async function main() {
  const deploymentPath = path.join(__dirname, "..", "web", "deployments", "latest.json");
  if (!fs.existsSync(deploymentPath)) {
    console.log("No deployment found. Run deploy first.");
    return;
  }

  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const provider = new ethers.JsonRpcProvider(process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org/");

  const launchpad = await ethers.getContractAt("RuyiBeastLaunchpad", deployment.launchpadAddress, provider);
  const factory = new ethers.Contract(PANCAKE_FACTORY, FACTORY_ABI, provider);

  const count = Number(await launchpad.projectCount());
  if (count === 0) {
    console.log("No projects found.");
    return;
  }

  const keeperKey = process.env.KEEPER_PRIVATE_KEY || "";
  if (!keeperKey) {
    console.log("KEEPER_PRIVATE_KEY not set, running in dry-run mode (no transactions).");
  }
  const signer = keeperKey ? new ethers.Wallet(keeperKey, provider) : null;

  let finalizedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < count; i++) {
    const saleVaultAddress = await launchpad.projectSaleVault(i);
    if (saleVaultAddress === ethers.ZeroAddress) {
      console.log(`Project ${i}: no sale vault, skip.`);
      skippedCount++;
      continue;
    }

    const saleVault = new ethers.Contract(saleVaultAddress, SALE_VAULT_ABI, provider);
    const [finalized, cancelled, deadline] = await Promise.all([
      saleVault.finalized(),
      saleVault.cancelled(),
      saleVault.saleDeadline()
    ]);

    if (finalized) {
      console.log(`Project ${i}: already finalized, skip.`);
      skippedCount++;
      continue;
    }

    if (cancelled) {
      console.log(`Project ${i}: cancelled, skip.`);
      skippedCount++;
      continue;
    }

    const now = Math.floor(Date.now() / 1000);
    if (deadline == 0 || Number(deadline) > now) {
      console.log(`Project ${i}: deadline not reached (${deadline} > ${now}), skip.`);
      skippedCount++;
      continue;
    }

    const project = await launchpad.getProject(i);
    const pair = await factory.getPair(project.token, WBNB);

    if (pair === ethers.ZeroAddress) {
      console.log(`Project ${i}: pair not found on PancakeSwap, skip.`);
      skippedCount++;
      continue;
    }

    console.log(`Project ${i}: deadline expired, pair=${pair}, ready to finalize.`);

    if (signer) {
      try {
        const tx = await saleVault.connect(signer).finalize(pair);
        console.log(`  tx sent: ${tx.hash}`);
        await tx.wait();
        console.log(`  finalized successfully.`);
        finalizedCount++;
      } catch (err) {
        console.error(`  finalize failed: ${err.message || err}`);
      }
    } else {
      console.log(`  (dry-run) would call finalize(${pair})`);
      finalizedCount++;
    }
  }

  console.log(`\nDone. Finalized: ${finalizedCount}, Skipped: ${skippedCount}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
