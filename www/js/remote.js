import { AppError, MESSAGES } from "./errors.js";
import { loadOrCreateKey, markEnrolled } from "./device-key.js";
import { postJson } from "./net.js";

const MAX_CHARS = 600;

function bytesToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesToHex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function signBody({ path, bodyText, privateKey, now = () => Date.now() }) {
  const bytes = new TextEncoder().encode(bodyText);
  const timestamp = String(Math.floor(now() / 1000));
  const digest = bytesToHex(await crypto.subtle.digest("SHA-256", bytes));
  const payload = new TextEncoder().encode(`v1\nPOST\n${path}\n${timestamp}\n${digest}`);
  const raw = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, payload);
  return { timestamp, signature: bytesToBase64(raw) };
}

function failureMessage(body, fallback) {
  try {
    const parsed = JSON.parse(body || "{}");
    if (typeof parsed.error === "string" && parsed.error) return parsed.error;
  } catch (error) {
    /* The function returned a non-JSON body. */
  }
  return fallback;
}

function enrolledHere(key, base) {
  return Array.isArray(key.enrolledUrls) && key.enrolledUrls.includes(base);
}

function notEnrolled(response) {
  return response.status === 401 && /not enrolled/i.test(failureMessage(response.body, ""));
}

async function postSigned(post, base, path, payload, key, now) {
  const bodyText = JSON.stringify(payload);
  const signed = await signBody({ path, bodyText, privateKey: key.privateKey, now });
  return post({
    url: `${base}${path}`,
    headers: {
      "Content-Type": "application/json",
      "x-west2romaji-timestamp": signed.timestamp,
      "x-west2romaji-signature": signed.signature,
    },
    body: bodyText,
    timeoutMs: 25000,
  });
}

async function enrollAt(post, base, key, now, keys) {
  const response = await postSigned(post, base, "/enroll", { public_key: key.pem }, key, now);
  if (response.status >= 400) {
    throw new AppError("bad_response", failureMessage(response.body, "The translation could not be completed."));
  }
  await keys.markEnrolled(base);
  const urls = new Set(Array.isArray(key.enrolledUrls) ? key.enrolledUrls : []);
  urls.add(base);
  key.enrolledUrls = [...urls];
}

export async function translateWithFunction({
  text,
  baseUrl,
  post = postJson,
  now = () => Date.now(),
  keys = { load: loadOrCreateKey, markEnrolled },
}) {
  const sourceText = String(text || "").trim();
  if (!sourceText) throw new AppError("empty", MESSAGES.empty);
  if (sourceText.length > MAX_CHARS) throw new AppError("too_long", MESSAGES.too_long);
  const base = String(baseUrl || "").trim().replace(/\/$/, "");
  if (!base) throw new AppError("missing_key", "The translation address is not set.");

  const key = await keys.load();
  if (!enrolledHere(key, base)) await enrollAt(post, base, key, now, keys);

  const started = now();
  let response = await postSigned(post, base, "/translate", { text: sourceText }, key, now);
  if (notEnrolled(response)) {
    await enrollAt(post, base, key, now, keys);
    response = await postSigned(post, base, "/translate", { text: sourceText }, key, now);
  }
  if (response.status >= 400) {
    throw new AppError("bad_response", failureMessage(response.body, "The translation could not be completed."));
  }
  let data = {};
  try {
    data = JSON.parse(response.body || "{}");
  } catch (error) {
    throw new AppError("bad_response", MESSAGES.bad_response);
  }
  const japanese = String(data.japanese || "").trim();
  const romaji = String(data.romaji || "").trim();
  if (!japanese || !romaji) throw new AppError("bad_response", MESSAGES.bad_response);
  return {
    sourceText,
    sourceLang: String(data.source_lang || ""),
    japanese,
    romaji,
    region: String(data.region || ""),
    model: String(data.model || ""),
    elapsedMs: Math.max(0, now() - started),
  };
}
