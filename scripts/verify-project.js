require("dotenv").config({ quiet: true });

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { Contract, JsonRpcProvider, ZeroAddress, getAddress, isAddress } = require("ethers");

const LAUNCHPAD_ABI = [
  "function vault() view returns (address)",
  "function isLaunchpadToken(address token) view returns (bool)",
  "function tokenToProjectId(address token) view returns (uint256)",
  "function projectSaleVault(uint256 projectId) view returns (address)",
  "function getProject(uint256 projectId) view returns (tuple(uint256 id,address token,address creator,string beastName,string tokenName,string tokenSymbol,string metadataURI,uint256 initialSupply,uint256 auraThreshold,uint8 beastType,uint256 createdAt) project)"
];

const SALE_VAULT_ABI = [
  "function creator() view returns (address)",
  "function liquidityReceiver() view returns (address)",
  "function liquidityRouter() view returns (address)",
  "function mintCount() view returns (uint256)",
  "function tokensPerMint() view returns (uint256)",
  "function mintPrice() view returns (uint256)",
  "function maxMintPerWallet() view returns (uint256)",
  "function whitelistMintLimit() view returns (uint256)",
  "function whitelistEnabled() view returns (bool)",
  "function saleDeadline() view returns (uint256)"
];

async function main() {
  const rpcUrl = process.env.BSC_RPC_URL || process.env.RUYI_RPC_URL || "https://bsc.publicnode.com";
  const launchpadAddress = getConfiguredLaunchpadAddress();
  const tokenAddress = readTokenAddress();

  if (!isAddress(launchpadAddress)) {
    throw new Error("LAUNCHPAD_ADDRESS or web/deployments/latest.json launchpadAddress is invalid.");
  }
  if (!isAddress(tokenAddress)) {
    throw new Error("Set PROJECT_TOKEN=0x... or pass the token address as the first argument.");
  }

  const provider = new JsonRpcProvider(rpcUrl, 56);
  const launchpad = new Contract(launchpadAddress, LAUNCHPAD_ABI, provider);
  const token = getAddress(tokenAddress);
  const launchpadToken = await launchpad.isLaunchpadToken(token);
  if (!launchpadToken) {
    throw new Error(`Token ${token} is not indexed in Launchpad ${launchpadAddress}.`);
  }

  const [vaultAddress, projectId] = await Promise.all([
    launchpad.vault(),
    launchpad.tokenToProjectId(token)
  ]);
  const [project, saleVaultAddress] = await Promise.all([
    launchpad.getProject(projectId),
    launchpad.projectSaleVault(projectId)
  ]);

  const hasSaleVault = saleVaultAddress && !sameAddress(saleVaultAddress, ZeroAddress);
  const tokenConstructorArgs = [
    project.tokenName,
    project.tokenSymbol,
    project.initialSupply,
    launchpadAddress,
    vaultAddress,
    launchpadAddress,
    project.id,
    project.beastName,
    project.metadataURI,
    project.auraThreshold
  ];

  const argsDir = path.join("work", "verify-args", token.toLowerCase());
  fs.mkdirSync(argsDir, { recursive: true });
  const tokenArgsPath = path.join(argsDir, "token.cjs");
  writeArgsFile(tokenArgsPath, tokenConstructorArgs);

  console.log("Verifying project contracts");
  console.log("Launchpad:", launchpadAddress);
  console.log("Token:", token);

  await verifyOne({
    address: token,
    constructorArgsPath: tokenArgsPath,
    contract: "contracts/RuyiBeastToken.sol:RuyiBeastToken",
    label: "Token"
  });

  if (hasSaleVault) {
    const saleVault = new Contract(saleVaultAddress, SALE_VAULT_ABI, provider);
    const [
      creator,
      liquidityReceiver,
      liquidityRouter,
      mintCount,
      tokensPerMint,
      mintPrice,
      maxMintPerWallet,
      whitelistMintLimit,
      whitelistEnabled,
      saleDeadline
    ] = await Promise.all([
      saleVault.creator(),
      saleVault.liquidityReceiver(),
      saleVault.liquidityRouter(),
      saleVault.mintCount(),
      saleVault.tokensPerMint(),
      saleVault.mintPrice(),
      saleVault.maxMintPerWallet(),
      saleVault.whitelistMintLimit(),
      saleVault.whitelistEnabled(),
      saleVault.saleDeadline()
    ]);
    const saleArgsPath = path.join(argsDir, "sale-vault.cjs");
    writeArgsFile(saleArgsPath, [
      token,
      creator,
      liquidityReceiver,
      liquidityRouter,
      mintCount,
      tokensPerMint,
      mintPrice,
      maxMintPerWallet,
      whitelistMintLimit,
      whitelistEnabled,
      saleDeadline
    ]);

    console.log("SaleVault:", saleVaultAddress);
    await verifyOne({
      address: saleVaultAddress,
      constructorArgsPath: saleArgsPath,
      contract: "contracts/RuyiBeastSaleVault.sol:RuyiBeastSaleVault",
      label: "SaleVault"
    });
  }
}

function readTokenAddress() {
  const cliValue = process.argv.find((arg) => isAddress(arg));
  return process.env.PROJECT_TOKEN || cliValue || "";
}

function getConfiguredLaunchpadAddress() {
  if (process.env.LAUNCHPAD_ADDRESS && isAddress(process.env.LAUNCHPAD_ADDRESS)) {
    return process.env.LAUNCHPAD_ADDRESS;
  }

  try {
    const deployment = JSON.parse(fs.readFileSync(path.join("web", "deployments", "latest.json"), "utf8"));
    return deployment.launchpadAddress || "";
  } catch {
    return "";
  }
}

async function verifyOne({ address, constructorArgsPath, contract, label }) {
  console.log(`Verifying ${label}: ${address}`);
  await runCommand("npx", [
    "hardhat",
    "verify",
    "--network",
    "bsc",
    "--contract",
    contract,
    "--constructor-args",
    constructorArgsPath,
    address
  ]);
}

function writeArgsFile(filePath, args) {
  const normalized = JSON.stringify(args, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value
  );
  fs.writeFileSync(filePath, `module.exports = ${normalized};\n`);
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const logs = [];
    const child = spawn(command, args, {
      env: process.env,
      shell: process.platform === "win32"
    });

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      logs.push(text);
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = String(chunk);
      logs.push(text);
      process.stderr.write(text);
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const output = logs.join("");
      if (/already verified|already been verified|contract source code already verified/i.test(output)) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

function sameAddress(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
