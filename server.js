import { randomBytes } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = resolve(__dirname);
const tempRoot = resolve(__dirname, ".tmp");
const monitorRoot = join(tempRoot, "monitors");

const allowedStatic = new Set([
  ".html",
  ".css",
  ".js",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
]);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

loadDotEnv();
const port = Number(process.env.PORT || 3000);
const maxUploadSizeMb = Number(process.env.MAX_UPLOAD_SIZE_MB || 5);
const maxUploadBytes = maxUploadSizeMb * 1024 * 1024;
const ttlHours = Number(process.env.TEMP_CASE_TTL_HOURS || 4);
const ttlMs = ttlHours * 60 * 60 * 1000;

await ensureStorage();
setInterval(cleanExpiredSigningSessions, 15 * 60 * 1000).unref();
cleanExpiredSigningSessions();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/signing-sessions") {
      await createSigningSession(req, res);
      return;
    }

    const signingSessionMatch = url.pathname.match(/^\/api\/signing-sessions\/([a-f0-9]{32})$/);
    if (req.method === "GET" && signingSessionMatch) {
      await readSigningSession(res, signingSessionMatch[1]);
      return;
    }

    const signingEventMatch = url.pathname.match(/^\/api\/signing-sessions\/([a-f0-9]{32})\/(opened|signed|completed|snapshot)$/);
    if (req.method === "POST" && signingEventMatch) {
      await updateSigningSession(req, res, signingEventMatch[1], signingEventMatch[2]);
      return;
    }

    if (req.method === "GET") {
      await serveStatic(res, url.pathname);
      return;
    }

    sendJson(res, 405, { error: "method_not_allowed" });
  } catch (error) {
    if (error.status) {
      sendJson(res, error.status, { error: error.error, message: error.message });
      return;
    }
    console.error(error);
    sendJson(res, 500, { error: "server_error", message: "伺服器發生錯誤。" });
  }
});

server.listen(port, () => {
  console.log(`Signature-onweb running at http://localhost:${port}`);
});

async function createSigningSession(req, res) {
  const payload = await readJsonBody(req);
  const id = randomBytes(16).toString("hex");
  const now = new Date();
  const record = {
    id,
    title: sanitizeText(payload.title, 80) || "同意書",
    status: "waiting",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    openedAt: null,
    signedAt: null,
    completedAt: null,
    previewDataUrl: "",
    previewUpdatedAt: null,
  };

  await writeSigningSession(record);
  sendJson(res, 201, record);
}

async function readSigningSession(res, id) {
  const record = await getSigningSession(id);
  if (!record) {
    sendJson(res, 404, { error: "session_not_found" });
    return;
  }

  if (isExpired(record)) {
    await rm(signingSessionPath(id), { force: true }).catch(() => {});
    sendJson(res, 410, { error: "session_expired" });
    return;
  }

  sendJson(res, 200, record);
}

async function updateSigningSession(req, res, id, event) {
  const record = await getSigningSession(id);
  if (!record) {
    sendJson(res, 404, { error: "session_not_found" });
    return;
  }

  const now = new Date().toISOString();
  record.updatedAt = now;

  if (event === "opened" && record.status === "waiting") {
    record.status = "opened";
    record.openedAt = now;
  }

  if (event === "signed" && record.status !== "completed") {
    record.status = "signed";
    record.signedAt = now;
  }

  if (event === "completed") {
    record.status = "completed";
    record.completedAt = now;
  }
  if (event === "snapshot") {
    const payload = await readJsonBody(req);
    const previewDataUrl = String(payload.previewDataUrl || "");
    if (previewDataUrl.startsWith("data:image/") && previewDataUrl.length <= 1_000_000) {
      record.previewDataUrl = previewDataUrl;
      record.previewUpdatedAt = now;
    }
  }

  await writeSigningSession(record);
  sendJson(res, 200, record);
}

async function cleanExpiredSigningSessions() {
  await ensureStorage();
  const monitors = await readdir(monitorRoot).catch(() => []);

  for (const file of monitors) {
    if (!file.endsWith(".json")) continue;
    const id = file.slice(0, -5);
    const record = await getSigningSession(id);
    if (record && isExpired(record)) {
      await rm(signingSessionPath(id), { force: true }).catch(() => {});
    }
  }
}

function signingSessionPath(id) {
  return join(monitorRoot, `${id}.json`);
}

async function getSigningSession(id) {
  try {
    return JSON.parse(await readFile(signingSessionPath(id), "utf8"));
  } catch {
    return null;
  }
}

async function writeSigningSession(record) {
  await writeFile(signingSessionPath(record.id), JSON.stringify(record, null, 2));
}

function isExpired(record) {
  return Date.now() > new Date(record.expiresAt).getTime();
}

async function serveStatic(res, pathname) {
  const decoded = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const safePath = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const target = resolve(publicRoot, `.${safePath}`);

  if (!target.startsWith(publicRoot)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  const ext = extname(target).toLowerCase();
  if (!allowedStatic.has(ext)) {
    sendText(res, 404, "Not found");
    return;
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error("Not a file");
    res.writeHead(200, { "content-type": mimeTypes[ext] || "application/octet-stream" });
    createReadStream(target).pipe(res);
  } catch {
    sendText(res, 404, "Not found");
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  const limit = Math.ceil(maxUploadBytes * 1.5) + 1024 * 1024;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) {
      throw httpError(413, "payload_too_large", `上傳內容超過 ${maxUploadSizeMb}MB。`);
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw httpError(400, "invalid_json", "請提供正確的 JSON。");
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function httpError(status, error, message) {
  const problem = new Error(message);
  problem.status = status;
  problem.error = error;
  return problem;
}

function sanitizeText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

async function ensureStorage() {
  await mkdir(monitorRoot, { recursive: true });
}

function loadDotEnv() {
  try {
    const path = join(__dirname, ".env");
    const content = readFileSync(path, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // .env is optional.
  }
}

process.on("uncaughtException", (error) => {
  if (error.status) return;
  console.error(error);
});
