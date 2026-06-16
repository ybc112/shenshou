const { ethers } = require("ethers");
const fs = require("node:fs");
const path = require("node:path");

const TOKEN_DEPLOYER_ADDRESS =
  process.env.TOKEN_DEPLOYER_ADDRESS || "0x144648A3392dA2055eb19891e78A070e767357f7";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function artifact(name) {
  return JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "artifacts", "contracts", `${name}.sol`, `${name}.json`), "utf8")
  );
}

function deployerArtifact(contractName) {
  return JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "artifacts", "contracts", "RuyiBeastDeployers.sol", `${contractName}.json`),
      "utf8"
    )
  );
}

async function waitForReceipt(provider, txHash) {
  for (let i = 0; i < 160; i++) {
    const receipt = await provider.send("eth_getTransactionReceipt", [txHash]);
    if (receipt) {
      if (receipt.status !== "0x1") {
        throw new Error(`Transaction failed: ${txHash}`);
      }
      return receipt;
    }
    await sleep(3000);
  }

  throw new Error(`Timed out waiting for transaction: ${txHash}`);
}

async function sendCreateTx({ provider, wallet, chainId, nonce, contractArtifact, args = [] }) {
  const iface = new ethers.Interface(contractArtifact.abi);
  const data = `${contractArtifact.bytecode}${iface.encodeDeploy(args).slice(2)}`;
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || ethers.parseUnits("3", "gwei");
  const estimatedGas = await provider.estimateGas({
    from: wallet.address,
    data
  });
  const gasLimit = (estimatedGas * 120n) / 100n;
  const signed = await wallet.signTransaction({
    chainId,
    nonce,
    data,
    gasPrice,
    gasLimit,
    value: 0
  });
  const txHash = await provider.send("eth_sendRawTransaction", [signed]);

  console.log(`Sent deploy tx: ${txHash}`);
  const receipt = await waitForReceipt(provider, txHash);
  return {
    txHash,
    address: ethers.getAddress(receipt.contractAddress),
    gasUsed: BigInt(receipt.gasUsed).toString()
  };
}

async function main() {
  if (!process.env.BSC_RPC_URL) {
    throw new Error("BSC_RPC_URL is required");
  }
  if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY is required");
  }

  const provider = new ethers.JsonRpcProvider(process.env.BSC_RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);

  if (chainId !== 56) {
    throw new Error(`Expected BSC mainnet chainId 56, got ${chainId}`);
  }

  const tokenDeployerAddress = ethers.getAddress(TOKEN_DEPLOYER_ADDRESS);
  const tokenDeployerCode = await provider.getCode(tokenDeployerAddress);
  if (tokenDeployerCode === "0x") {
    throw new Error(`Token deployer has no code: ${tokenDeployerAddress}`);
  }

  const treasury = process.env.TREASURY || process.env.FEE_RECIPIENT || wallet.address;
  const creationFee =
    process.env.CREATION_FEE_WEI ||
    (process.env.CREATION_FEE_BNB ? ethers.parseEther(process.env.CREATION_FEE_BNB).toString() : "0");

  let nonce = await provider.getTransactionCount(wallet.address, "pending");

  const saleVaultDeployerDeploy = await sendCreateTx({
    provider,
    wallet,
    chainId,
    nonce,
    contractArtifact: deployerArtifact("RuyiBeastSaleVaultDeployer")
  });
  nonce += 1;

  const launchpadDeploy = await sendCreateTx({
    provider,
    wallet,
    chainId,
    nonce,
    contractArtifact: artifact("RuyiBeastLaunchpad"),
    args: [treasury, creationFee, tokenDeployerAddress, saleVaultDeployerDeploy.address]
  });

  const launchpadArtifact = artifact("RuyiBeastLaunchpad");
  const launchpad = new ethers.Contract(launchpadDeploy.address, launchpadArtifact.abi, provider);
  const vaultAddress = await launchpad.vault();

  const deployment = {
    chainId,
    network: "bsc",
    tokenDeployerAddress,
    saleVaultDeployerAddress: saleVaultDeployerDeploy.address,
    launchpadAddress: launchpadDeploy.address,
    vaultAddress,
    platformTreasury: treasury,
    creationFee,
    transactions: {
      tokenDeployer: "0xfc7f15cad73ee8400793f713fcd2adcbb20bb6e63036a57da8dbec3a3fe64deb",
      saleVaultDeployer: saleVaultDeployerDeploy.txHash,
      launchpad: launchpadDeploy.txHash
    },
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

  console.log("Deployment complete");
  console.log(`RuyiBeastTokenDeployer: ${deployment.tokenDeployerAddress}`);
  console.log(`RuyiBeastSaleVaultDeployer: ${deployment.saleVaultDeployerAddress}`);
  console.log(`RuyiBeastLaunchpad: ${deployment.launchpadAddress}`);
  console.log(`RuyiBeastVault: ${deployment.vaultAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
