const DB_NAME = "west2romaji";
const STORE = "device-key";
const RECORD = "device";

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function toPem(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const lines = btoa(binary).match(/.{1,64}/g).join("\n");
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----\n`;
}

async function read() {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const request = tx.objectStore(STORE).get(RECORD);
  const value = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  await done(tx);
  return value;
}

async function write(record) {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(record, RECORD);
  await done(tx);
}

export async function loadOrCreateKey() {
  const existing = await read();
  if (existing?.privateKey && existing.pem) return existing;
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  const record = {
    privateKey: pair.privateKey,
    pem: toPem(spki),
    enrolledUrls: [],
  };
  await write(record);
  return record;
}

export async function markEnrolled(baseUrl) {
  const record = await read();
  if (!record) return;
  const base = String(baseUrl || "").trim().replace(/\/$/, "");
  const urls = new Set(Array.isArray(record.enrolledUrls) ? record.enrolledUrls : []);
  if (base) urls.add(base);
  record.enrolledUrls = [...urls];
  await write(record);
}
