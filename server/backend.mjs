import dotenv from "dotenv";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  getAddress,
  getCreate2Address,
  hexlify,
  isAddress,
  keccak256,
  randomBytes,
  solidityPackedKeccak256
} from "ethers";

dotenv.config({ quiet: true });

const port = Number(process.env.PORT || 8787);
const serverDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(serverDir, "..");
const assetDir = path.resolve(process.env.ASSET_DIR || path.join(rootDir, "work", "assets"));
const webDir = path.resolve(process.env.WEB_DIR || path.join(rootDir, "web"));
const corsOrigin = process.env.CORS_ORIGIN || "*";
const LAUNCHPAD_ABI = [
  "function projectCount() view returns (uint256)",
  "function vault() view returns (address)",
  "function tokenDeployer() view returns (address)",
  "function requiredTokenSuffix() view returns (uint16)",
  "function isLaunchpadToken(address token) view returns (bool)",
  "function getProject(uint256 projectId) view returns (tuple(uint256 id,address token,address creator,string beastName,string tokenName,string tokenSymbol,string metadataURI,uint256 initialSupply,uint256 auraThreshold,uint8 beastType,uint256 createdAt) project)"
];
const tokenArtifact = readJson(path.join(rootDir, "artifacts", "contracts", "RuyiBeastToken.sol", "RuyiBeastToken.json"), null);
const deployment = readJson(path.join(webDir, "deployments", "latest.json"), {});
const chainId = Number(process.env.RUYI_CHAIN_ID || deployment.chainId || 56);
const rpcUrl = process.env.BSC_RPC_URL || process.env.RUYI_RPC_URL || "";
const launchpadAddress = normalizeOptionalAddress(process.env.LAUNCHPAD_ADDRESS || deployment.launchpadAddress || "");
const provider = rpcUrl ? new JsonRpcProvider(rpcUrl, chainId) : null;
const launchpad = provider && launchpadAddress ? new Contract(launchpadAddress, LAUNCHPAD_ABI, provider) : null;
const DEFAULT_SUPPLY = 1_000_000_000n * 1_000_000_000_000_000_000n;
const defaultVanitySuffix = String(process.env.RUYI_VANITY_SUFFIX || "dddd").trim().replace(/^0x/i, "").toLowerCase();
const vanityMaxIterations = Number(process.env.VANITY_MAX_ITERATIONS || 500000);
const autoVerify = process.env.AUTO_VERIFY_PROJECTS !== "false";
const verifyPollMs = Number(process.env.VERIFY_POLL_MS || 30000);
const verifyBackfillCount = Number(process.env.VERIFY_BACKFILL_COUNT || 12);
const verifyInitialDelayMs = Number(process.env.VERIFY_INITIAL_DELAY_MS || 20000);
const verifyRetryDelayMs = Number(process.env.VERIFY_RETRY_DELAY_MS || 60000);
const verifyRetryLimit = Number(process.env.VERIFY_RETRY_LIMIT || 5);
const jobs = new Map();
let lastProjectCount = 0;
let verifying = false;

const server = createServer(async (request, response) => {
  setCors(response);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      service: "ruyi-backend",
      uptime: Math.round(process.uptime()),
      chainId,
      launchpad: launchpadAddress || "",
      autoVerify,
      verifierReady: Boolean(launchpad && process.env.BSCSCAN_API_KEY),
      vanitySuffix: defaultVanitySuffix,
      vanityReady: Boolean(launchpad && tokenArtifact),
      queued: [...jobs.values()].filter((job) => job.status === "queued").length,
      running: [...jobs.values()].filter((job) => job.status === "running").length
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/verify-status") {
    try {
      const token = normalizeAddress(url.searchParams.get("token") || "");
      sendJson(response, 200, { token, job: jobs.get(token.toLowerCase()) || null });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/assets/")) {
    await sendAsset(response, url.pathname);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/assets") {
    try {
      const body = await readBody(request);
      const asset = await saveDataUrlAsset(body.dataUrl, request);
      sendJson(response, 201, { ok: true, ...asset });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/vanity-salt") {
    try {
      const body = await readBody(request);
      const result = await findVanitySalt(body);
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/verify-project") {
    try {
      const body = await readBody(request);
      const token = normalizeAddress(body.token);
      await assertLaunchpadProject(token);
      queueVerify(token, "api");
      sendJson(response, 202, { ok: true, token, job: jobs.get(token.toLowerCase()) });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (request.method === "GET") {
    await sendStatic(response, url.pathname);
    return;
  }

  sendJson(response, 404, { error: "Not found" });
});

server.listen(port, () => {
  console.log(`Backend listening on :${port}`);
  console.log(`Asset dir: ${assetDir}`);
  console.log(`Web dir: ${webDir}`);
  console.log(`Launchpad: ${launchpadAddress || "not configured"}`);
  if (autoVerify && launchpad) {
    void syncProjects(true);
    setInterval(() => void syncProjects(false), verifyPollMs);
  }
});

async function syncProjects(backfill) {
  if (!launchpad) return;

  try {
    const count = Number(await launchpad.projectCount());
    const start = backfill ? Math.max(0, count - verifyBackfillCount) : lastProjectCount;
    for (let index = start; index < count; index += 1) {
      const project = await launchpad.getProject(index);
      if (project?.token && isAddress(project.token)) {
        queueVerify(project.token, backfill ? "backfill" : "monitor");
      }
    }
    lastProjectCount = count;
  } catch (error) {
    console.error("Project sync failed:", error instanceof Error ? error.message : error);
  }
}

function queueVerify(token, source) {
  const normalized = getAddress(token);
  const key = normalized.toLowerCase();
  const current = jobs.get(key);
  if (current && ["queued", "running", "success"].includes(current.status)) {
    return;
  }

  jobs.set(key, {
    token: normalized,
    source,
    status: "queued",
    attempts: 0,
    logs: [],
    nextRunAt: source === "backfill" ? "" : new Date(Date.now() + verifyInitialDelayMs).toISOString(),
    updatedAt: new Date().toISOString()
  });
  void drainVerifyQueue();
}

async function drainVerifyQueue() {
  if (verifying) return;
  verifying = true;

  try {
    while (true) {
      const now = Date.now();
      const queuedJobs = [...jobs.values()].filter((job) => job.status === "queued");
      const job = queuedJobs.find((item) => !item.nextRunAt || Date.parse(item.nextRunAt) <= now);
      if (!job) {
        const nextRunAt = queuedJobs
          .map((item) => item.nextRunAt ? Date.parse(item.nextRunAt) : now)
          .filter((time) => Number.isFinite(time))
          .sort((left, right) => left - right)[0];
        if (nextRunAt) {
          setTimeout(() => void drainVerifyQueue(), Math.max(1000, nextRunAt - now));
        }
        return;
      }

      job.status = "running";
      job.nextRunAt = "";
      job.updatedAt = new Date().toISOString();

      try {
        const logs = await runVerify(job.token);
        job.status = "success";
        job.logs = logs;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        job.attempts = Number(job.attempts || 0) + 1;
        job.logs = [message];
        if (job.attempts < verifyRetryLimit) {
          job.status = "queued";
          job.nextRunAt = new Date(Date.now() + verifyRetryDelayMs * job.attempts).toISOString();
        } else {
          job.status = "error";
          job.nextRunAt = "";
        }
      }
      job.updatedAt = new Date().toISOString();
    }
  } finally {
    verifying = false;
  }
}

function runVerify(token) {
  return new Promise((resolve, reject) => {
    const logs = [];
    const child = spawn("npm", ["run", "verify:project"], {
      cwd: rootDir,
      env: {
        ...process.env,
        PROJECT_TOKEN: token,
        LAUNCHPAD_ADDRESS: launchpadAddress,
        BSC_RPC_URL: rpcUrl
      },
      shell: process.platform === "win32"
    });

    child.stdout.on("data", (chunk) => logs.push(String(chunk)));
    child.stderr.on("data", (chunk) => logs.push(String(chunk)));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(logs.slice(-80));
        return;
      }
      reject(new Error(logs.join("") || `verify exited with code ${code}`));
    });
  });
}

async function findVanitySalt(body) {
  if (!launchpad || !provider || !launchpadAddress) {
    throw new Error("Launchpad vanity service is not configured.");
  }
  if (!tokenArtifact?.abi || !tokenArtifact?.bytecode) {
    throw new Error("Token artifact is missing. Run npm run compile on the backend server.");
  }

  const requestedSuffix = String(body.suffix || defaultVanitySuffix || "dddd").trim().replace(/^0x/i, "").toLowerCase();
  const requiredSuffix = await readRequiredTokenSuffix();
  const suffix = requiredSuffix || requestedSuffix;
  if (!/^[0-9a-f]{1,4}$/.test(suffix)) {
    throw new Error("suffix must be 1-4 hex characters.");
  }
  if (requiredSuffix && requestedSuffix.padStart(4, "0") !== requiredSuffix) {
    throw new Error(`Launchpad requires token suffix ${requiredSuffix}.`);
  }

  const creator = normalizeAddress(body.creator);
  const params = normalizeCreateParams(body.params || {});
  const maxIterations = Math.min(Math.max(Number(body.maxIterations || vanityMaxIterations), 1), 2_000_000);
  const [vaultAddress, tokenDeployer, projectId] = await Promise.all([
    launchpad.vault(),
    launchpad.tokenDeployer(),
    launchpad.projectCount()
  ]);

  const initialSupply = params.initialSupply > 0n ? params.initialSupply : DEFAULT_SUPPLY;
  const auraThreshold = params.auraThreshold > 0n ? params.auraThreshold : initialSupply / 1000n;
  const tokenFactory = new ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode);
  const deployTx = await tokenFactory.getDeployTransaction(
    params.tokenName,
    params.tokenSymbol,
    initialSupply,
    launchpadAddress,
    getAddress(vaultAddress),
    launchpadAddress,
    projectId,
    params.beastName,
    params.metadataURI,
    auraThreshold
  );
  const initCodeHash = keccak256(deployTx.data);
  const startedAt = Date.now();

  for (let attempts = 1; attempts <= maxIterations; attempts += 1) {
    const salt = hexlify(randomBytes(32));
    const tokenSalt = solidityPackedKeccak256(
      ["address", "bytes32", "string", "string", "uint256"],
      [creator, salt, params.tokenName, params.tokenSymbol, chainId]
    );
    const tokenAddress = getCreate2Address(getAddress(tokenDeployer), tokenSalt, initCodeHash);
    if (tokenAddress.toLowerCase().endsWith(suffix)) {
      return {
        ok: true,
        suffix,
        salt,
        tokenSalt,
        tokenAddress,
        launchpad: launchpadAddress,
        tokenDeployer: getAddress(tokenDeployer),
        projectId: projectId.toString(),
        chainId,
        attempts,
        elapsedMs: Date.now() - startedAt
      };
    }
  }

  return {
    ok: false,
    suffix,
    launchpad: launchpadAddress,
    chainId,
    attempts: maxIterations,
    elapsedMs: Date.now() - startedAt
  };
}

async function readRequiredTokenSuffix() {
  try {
    const suffix = Number(await launchpad.requiredTokenSuffix());
    return suffix > 0 ? suffix.toString(16).padStart(4, "0") : "";
  } catch {
    return defaultVanitySuffix || "";
  }
}

function normalizeCreateParams(params) {
  return {
    beastName: requiredString(params.beastName, "params.beastName"),
    tokenName: requiredString(params.tokenName, "params.tokenName"),
    tokenSymbol: requiredString(params.tokenSymbol, "params.tokenSymbol"),
    metadataURI: String(params.metadataURI || ""),
    initialSupply: BigInt(params.initialSupply || 0),
    auraThreshold: BigInt(params.auraThreshold || 0)
  };
}

async function saveDataUrlAsset(dataUrl, request) {
  const raw = String(dataUrl ?? "");
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif|svg\+xml));base64,([a-zA-Z0-9+/=]+)$/i.exec(raw);
  if (!match) {
    throw new Error("Invalid asset data URL.");
  }

  const mimeType = normalizeAssetMimeType(match[1]);
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 260 * 1024) {
    throw new Error("Asset is too large (max 260KB).");
  }

  const hash = createHash("sha256").update(mimeType).update(bytes).digest("hex");
  const filename = `${hash.slice(0, 32)}.${assetExtension(mimeType)}`;
  fs.mkdirSync(assetDir, { recursive: true });
  const filePath = path.join(assetDir, filename);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, bytes);
  }

  return {
    url: `${publicBaseUrl(request)}/api/assets/${filename}`,
    mimeType,
    bytes: bytes.length,
  };
}

async function sendAsset(response, pathname) {
  const filename = path.basename(decodeURIComponent(pathname));
  if (!/^[0-9a-f]{32}\.(?:png|jpg|webp|gif|svg)$/.test(filename)) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const filePath = path.join(assetDir, filename);
  if (!fs.existsSync(filePath)) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const mimeType = mimeTypeForAsset(filename);
  response.writeHead(200, {
    "content-type": mimeType,
    "cache-control": "public, max-age=31536000, immutable",
  });
  fs.createReadStream(filePath).pipe(response);
}

function publicBaseUrl(request) {
  const configured = String(process.env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  const proto = firstHeaderValue(request.headers["x-forwarded-proto"]) || (request.socket.encrypted ? "https" : "http");
  const host = firstHeaderValue(request.headers["x-forwarded-host"]) || firstHeaderValue(request.headers.host);
  if (host) return `${proto}://${host}`.replace(/\/+$/, "");
  return `http://localhost:${port}`;
}

function firstHeaderValue(value) {
  if (Array.isArray(value)) return String(value[0] ?? "").split(",")[0].trim();
  return String(value ?? "").split(",")[0].trim();
}

function normalizeAssetMimeType(mimeType) {
  const lower = String(mimeType).toLowerCase();
  return lower === "image/jpg" ? "image/jpeg" : lower;
}

function assetExtension(mimeType) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/svg+xml") return "svg";
  return mimeType.replace("image/", "");
}

function mimeTypeForAsset(filename) {
  if (filename.endsWith(".jpg")) return "image/jpeg";
  if (filename.endsWith(".svg")) return "image/svg+xml";
  return `image/${filename.split(".").pop()}`;
}

async function sendStatic(response, pathname) {
  const cleanPath = decodeURIComponent(pathname).replace(/^\/+/, "");
  const relativePath = cleanPath && cleanPath !== "/" ? cleanPath : "index.html";
  const filePath = path.resolve(webDir, relativePath);
  if (!isInsideDirectory(webDir, filePath) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  response.writeHead(200, {
    "content-type": mimeTypeForStatic(filePath),
    "cache-control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=300",
  });
  fs.createReadStream(filePath).pipe(response);
}

function isInsideDirectory(rootDir, candidatePath) {
  const relative = path.relative(rootDir, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function mimeTypeForStatic(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  if (filePath.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("Request body too large."));
      }
    });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function setCors(response) {
  response.setHeader("access-control-allow-origin", corsOrigin);
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

async function assertLaunchpadProject(token) {
  if (!launchpad) {
    throw new Error("Launchpad verifier is not configured.");
  }
  const known = await launchpad.isLaunchpadToken(token);
  if (!known) {
    throw new Error("Token is not indexed by the configured Launchpad.");
  }
}

function normalizeAddress(value) {
  const raw = String(value || "").trim();
  if (!isAddress(raw)) {
    throw new Error("Invalid token address.");
  }
  return getAddress(raw);
}

function normalizeOptionalAddress(value) {
  const raw = String(value || "").trim();
  return isAddress(raw) ? getAddress(raw) : "";
}

function requiredString(value, label) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${label} is required.`);
  }
  return text;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}
