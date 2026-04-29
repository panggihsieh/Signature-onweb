import { createHash, createSign, randomBytes } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = resolve(__dirname);
const tempRoot = resolve(__dirname, ".tmp");
const caseRoot = join(tempRoot, "cases");
const fileRoot = join(tempRoot, "files");

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
setInterval(cleanExpiredCases, 15 * 60 * 1000).unref();
cleanExpiredCases();

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/api/cases") {
      await createCase(req, res);
      return;
    }

    const caseMatch = url.pathname.match(/^\/api\/cases\/([a-f0-9]{32})$/);
    if (req.method === "GET" && caseMatch) {
      await readCase(res, caseMatch[1]);
      return;
    }

    const completeMatch = url.pathname.match(/^\/api\/cases\/([a-f0-9]{32})\/complete$/);
    if (req.method === "POST" && completeMatch) {
      await completeCase(res, completeMatch[1]);
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
    sendJson(res, 500, { error: "server_error", message: "伺服器暫時無法處理請求。" });
  }
});

server.listen(port, () => {
  console.log(`Signature-onweb running at http://localhost:${port}`);
});

async function createCase(req, res) {
  const payload = await readJsonBody(req);
  const title = sanitizeText(payload.title, 80) || "未命名同意書";
  const text = sanitizeText(payload.text, 12000);
  const fields = normalizeFields(payload.fields);
  const file = normalizeUpload(payload.file);

  if (!fields.length) {
    sendJson(res, 400, { error: "missing_signature_field", message: "請至少新增一個簽名欄。" });
    return;
  }

  if (!file) {
    sendJson(res, 400, { error: "missing_document", message: "請上傳圖片或 PDF 同意書。" });
    return;
  }

  const id = randomBytes(16).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const storedFile = file ? await storeFile(id, file) : null;
  const record = {
    id,
    title,
    text,
    fields,
    status: "open",
    createdAt: now.toISOString(),
    expiresAt,
    completedAt: null,
    file: storedFile,
  };

  await writeCase(record);
  sendJson(res, 201, {
    id,
    expiresAt,
    parentUrl: `/index.html?case=${id}`,
    storage: storedFile.storage,
  });
}

async function readCase(res, id) {
  const record = await getCase(id);

  if (!record || record.status !== "open") {
    sendJson(res, 404, { error: "case_not_found", message: "此簽名連結不存在或已失效。" });
    return;
  }

  if (isExpired(record)) {
    await deleteCase(record);
    sendJson(res, 410, { error: "case_expired", message: "此簽名連結已超過 4 小時，請向老師索取新的連結。" });
    return;
  }

  const fileDataUrl = record.file ? await readStoredFile(record.file) : "";
  sendJson(res, 200, {
    id: record.id,
    title: record.title,
    text: record.text,
    fields: record.fields,
    expiresAt: record.expiresAt,
    file: record.file
      ? {
          name: record.file.name,
          type: record.file.type,
          dataUrl: fileDataUrl,
        }
      : null,
  });
}

async function completeCase(res, id) {
  const record = await getCase(id);

  if (!record) {
    sendJson(res, 404, { error: "case_not_found" });
    return;
  }

  record.status = "completed";
  record.completedAt = new Date().toISOString();
  await deleteCase(record);
  sendJson(res, 200, { ok: true });
}

async function storeFile(caseId, file) {
  const buffer = Buffer.from(file.base64, "base64");
  const checksum = createHash("sha256").update(buffer).digest("hex");

  if (driveConfigured()) {
    const driveFile = await uploadDriveFile({
      name: `${caseId}-${file.name}`,
      type: file.type,
      buffer,
    });
    return {
      storage: "google_drive",
      driveFileId: driveFile.id,
      name: file.name,
      type: file.type,
      size: buffer.length,
      checksum,
    };
  }

  const localName = `${caseId}${file.type === "application/pdf" ? ".pdf" : ".bin"}`;
  await writeFile(join(fileRoot, localName), buffer);
  return {
    storage: "local_temp",
    localName,
    name: file.name,
    type: file.type,
    size: buffer.length,
    checksum,
  };
}

async function readStoredFile(file) {
  let buffer;

  if (file.storage === "google_drive") {
    buffer = await downloadDriveFile(file.driveFileId);
  } else {
    buffer = await readFile(join(fileRoot, file.localName));
  }

  return `data:${file.type};base64,${buffer.toString("base64")}`;
}

async function deleteCase(record) {
  if (record.file?.storage === "google_drive") {
    await deleteDriveFile(record.file.driveFileId).catch((error) => {
      console.error(`Drive delete failed for ${record.file.driveFileId}`, error);
    });
  }

  if (record.file?.storage === "local_temp") {
    await rm(join(fileRoot, record.file.localName), { force: true }).catch(() => {});
  }

  await rm(casePath(record.id), { force: true });
}

async function cleanExpiredCases() {
  await ensureStorage();
  const files = await readdir(caseRoot).catch(() => []);

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const id = file.slice(0, -5);
    const record = await getCase(id);
    if (record && isExpired(record)) {
      await deleteCase(record);
    }
  }
}

function normalizeUpload(file) {
  if (!file) return null;

  const name = sanitizeFileName(file.name || "consent");
  const type = String(file.type || "");
  const dataUrl = String(file.dataUrl || "");
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);

  if (!match) {
    throw httpError(400, "invalid_file", "檔案格式無法讀取。");
  }

  const dataType = match[1];
  const base64 = match[2];
  const size = Math.floor((base64.length * 3) / 4);
  const isImage = dataType.startsWith("image/");
  const isPdf = dataType === "application/pdf";

  if (!isImage && !isPdf) {
    throw httpError(400, "unsupported_file_type", "第一版僅支援圖片與 PDF。");
  }

  if (size > maxUploadBytes) {
    throw httpError(413, "file_too_large", `檔案超過 ${maxUploadSizeMb}MB，請壓縮後再上傳。`);
  }

  return { name, type, base64 };
}

function normalizeFields(fields) {
  if (!Array.isArray(fields)) return [];
  return fields
    .map((field, index) => ({
      id: typeof field.id === "string" ? field.id.slice(0, 80) : randomBytes(8).toString("hex"),
      label: sanitizeText(field.label, 40) || `家長簽名 ${index + 1}`,
      x: clampNumber(field.x, 0, 100),
      y: clampNumber(field.y, 0, 100),
      w: clampNumber(field.w, 8, 100),
      h: clampNumber(field.h, 4, 50),
    }))
    .filter((field) => field.w > 0 && field.h > 0)
    .slice(0, 12);
}

function sanitizeText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function sanitizeFileName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, "_").slice(0, 120) || "consent";
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(Math.max(number, min), max);
}

async function writeCase(record) {
  await writeFile(casePath(record.id), JSON.stringify(record, null, 2));
}

async function getCase(id) {
  try {
    return JSON.parse(await readFile(casePath(id), "utf8"));
  } catch {
    return null;
  }
}

function casePath(id) {
  return join(caseRoot, `${id}.json`);
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
      throw httpError(413, "payload_too_large", `上傳資料超過 ${maxUploadSizeMb}MB 限制。`);
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw httpError(400, "invalid_json", "請求格式錯誤。");
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

process.on("uncaughtException", (error) => {
  if (error.status) return;
  console.error(error);
});

async function ensureStorage() {
  await mkdir(caseRoot, { recursive: true });
  await mkdir(fileRoot, { recursive: true });
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

function driveConfigured() {
  if (!process.env.GOOGLE_DRIVE_TEMP_FOLDER_ID) return false;
  return getGoogleAuthMode() === "oauth" || getGoogleAuthMode() === "service_account";
}

async function uploadDriveFile({ name, type, buffer }) {
  const token = await getDriveAccessToken();
  const boundary = `signature_onweb_${randomBytes(8).toString("hex")}`;
  const metadata = {
    name,
    parents: [process.env.GOOGLE_DRIVE_TEMP_FOLDER_ID],
  };
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\ncontent-type: application/json; charset=utf-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    ),
    Buffer.from(`--${boundary}\r\ncontent-type: ${type}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": `multipart/related; boundary=${boundary}`,
        "content-length": String(body.length),
      },
      body,
    },
  );

  if (!response.ok) {
    throw new Error(`Google Drive upload failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function downloadDriveFile(fileId) {
  const token = await getDriveAccessToken();
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Google Drive download failed: ${response.status} ${await response.text()}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function deleteDriveFile(fileId) {
  const token = await getDriveAccessToken();
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`Google Drive delete failed: ${response.status} ${await response.text()}`);
  }
}

let cachedToken = null;

async function getDriveAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  if (getGoogleAuthMode() === "oauth") {
    return getOAuthAccessToken();
  }

  return getServiceAccountAccessToken();
}

function getGoogleAuthMode() {
  const explicitMode = String(process.env.GOOGLE_AUTH_MODE || "").toLowerCase();
  const hasOAuth =
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const hasServiceAccount = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY;

  if (explicitMode === "oauth") return hasOAuth ? "oauth" : "local";
  if (explicitMode === "service_account") return hasServiceAccount ? "service_account" : "local";
  if (hasOAuth) return "oauth";
  if (hasServiceAccount) return "service_account";
  return "local";
}

async function getOAuthAccessToken() {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
  });

  if (!response.ok) {
    throw new Error(`Google OAuth token request failed: ${response.status} ${await response.text()}`);
  }

  const token = await response.json();
  cachedToken = {
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

async function getServiceAccountAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(
    JSON.stringify({
      iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      scope: "https://www.googleapis.com/auth/drive.file",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n");
  const signature = createSign("RSA-SHA256").update(unsigned).sign(privateKey);
  const assertion = `${unsigned}.${base64Url(signature)}`;
  const params = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params,
  });

  if (!response.ok) {
    throw new Error(`Google token request failed: ${response.status} ${await response.text()}`);
  }

  const token = await response.json();
  cachedToken = {
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

function base64Url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
