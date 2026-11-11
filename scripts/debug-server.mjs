#!/usr/bin/env node
/**
 * Local preview. Listens on 127.0.0.1 only.
 *
 * http://127.0.0.1:4173/?debug=1 reads the repo .env.
 * XAI_API_KEY wins. An empty xAI key uses GEMINI_API_KEY.
 * That file is gitignored. The iPhone build never calls this route.
 */
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../www/", import.meta.url));
const ENV_PATH = fileURLToPath(new URL("../.env", import.meta.url));
const KEY_NAME = "XAI_API_KEY";
const GEMINI_KEY_NAME = "GEMINI_API_KEY";
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

export function normalizeStoredKey(value) {
  return String(value || "").trim().replace(/^bearer\s+/i, "").trim();
}

export function isLoopbackHost(header) {
  const host = String(header || "").replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function envValue(text, name = KEY_NAME) {
  const pattern = new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`);
  for (const line of String(text ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = line.match(pattern);
    if (!match) continue;
    let value = match[1].trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return normalizeStoredKey(value);
  }
  return "";
}

export function chooseDebugKey(text) {
  const xai = envValue(text, KEY_NAME);
  if (xai && !/^(null|undefined)$/i.test(xai)) return { provider: "xai", apiKey: xai };
  const gemini = envValue(text, GEMINI_KEY_NAME);
  if (gemini && !/^(null|undefined)$/i.test(gemini)) return { provider: "gemini", apiKey: gemini };
  return { provider: "", apiKey: "" };
}

export function setEnvValue(text, name, value) {
  const key = normalizeStoredKey(value);
  const pattern = new RegExp(`^\\s*${name}\\s*=`);
  const kept = String(text ?? "").split("\n").filter((line) => !pattern.test(line));
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  if (key) kept.push(`${name}=${key}`);
  return kept.length ? `${kept.join("\n")}\n` : "";
}

async function readEnv() {
  try {
    return await readFile(ENV_PATH, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

async function writeEnv(text) {
  await writeFile(ENV_PATH, text, { mode: 0o600 });
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 4096) {
        reject(Object.assign(new Error("too large"), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

export async function handleDebugKey(request, response, io = { read: readEnv, write: writeEnv }) {
  if (!isLoopbackHost(request.headers.host)) {
    sendJson(response, 404, { error: "not found" });
    return;
  }
  try {
    const current = await io.read();
    if (request.method === "GET") {
      const chosen = chooseDebugKey(current);
      if (!chosen.apiKey) {
        sendJson(response, 404, { error: "missing" });
        return;
      }
      sendJson(response, 200, chosen);
      return;
    }
    if (request.method === "PUT") {
      const raw = await readBody(request);
      const payload = JSON.parse(raw || "{}");
      const key = normalizeStoredKey(payload.apiKey);
      if (key.length < 8) {
        sendJson(response, 400, { error: "Enter a key first." });
        return;
      }
      await io.write(setEnvValue(current, KEY_NAME, key));
      sendJson(response, 200, { saved: true });
      return;
    }
    if (request.method === "DELETE") {
      await io.write(setEnvValue(current, KEY_NAME, ""));
      sendJson(response, 200, { removed: true });
      return;
    }
    sendJson(response, 405, { error: "method" });
  } catch (error) {
    if (error instanceof SyntaxError) {
      sendJson(response, 400, { error: "The request body must be JSON." });
      return;
    }
    sendJson(response, error.status || 500, { error: "The debug key could not be read." });
  }
}

function filePath(urlPath) {
  let pathname = urlPath.split("?")[0];
  try {
    pathname = decodeURIComponent(pathname);
  } catch (error) {
    return null;
  }
  const relative = pathname.replace(/^\/+/, "");
  const full = normalize(join(ROOT, relative));
  const root = ROOT.endsWith(sep) ? ROOT.slice(0, -1) : ROOT;
  if (full !== root && !full.startsWith(`${root}${sep}`)) return null;
  return full;
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${HOST}`);
  let full = filePath(url.pathname);
  if (!full) {
    response.writeHead(403);
    response.end();
    return;
  }
  try {
    let info = await stat(full);
    if (info.isDirectory()) {
      full = join(full, "index.html");
      info = await stat(full);
    }
    const type = TYPES[extname(full)] || "application/octet-stream";
    response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    createReadStream(full).pipe(response);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 500);
    response.end();
  }
}

export function createDebugServer(io) {
  return createServer((request, response) => {
    const path = (request.url || "").split("?")[0];
    if (path === "/__debug/key") {
      handleDebugKey(request, response, io);
      return;
    }
    if (path === "/cordova.js") {
      const body = "/* Browser preview. The iPhone build supplies the real cordova.js. */\n";
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
        "content-length": Buffer.byteLength(body),
      });
      response.end(request.method === "HEAD" ? undefined : body);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405);
      response.end();
      return;
    }
    serveStatic(request, response);
  });
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const server = createDebugServer();
  server.listen(PORT, HOST, () => {
    console.log(`West2Romaji debug preview: http://${HOST}:${PORT}/?debug=1`);
  });
}
