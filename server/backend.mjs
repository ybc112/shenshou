import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const port = Number(process.env.PORT || 8787);
const assetDir = path.resolve(process.env.ASSET_DIR || path.join(process.cwd(), "work", "assets"));
const webDir = path.resolve(process.env.WEB_DIR || path.join(process.cwd(), "web"));
const corsOrigin = process.env.CORS_ORIGIN || "*";

const server = createServer(async (request, response) => {
  setCors(response);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, service: "ruyi-backend", uptime: Math.round(process.uptime()) });
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
});

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
