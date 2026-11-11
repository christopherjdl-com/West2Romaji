import assert from "node:assert/strict";
import test from "node:test";
import {
  createKeyStore,
  createKeychainStore,
  createDebugEnvStore,
  createSessionStore,
  isLocalDebug,
  normalizeKey,
} from "../www/js/keychain.js";

test("bearer prefixes are stripped before the key is stored", () => {
  assert.equal(normalizeKey("  Bearer xai-abc  "), "xai-abc");
});

test("a session store round-trips without using the Keychain", async () => {
  const data = new Map();
  const session = {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
  const store = createSessionStore(session);
  assert.equal(store.backend, "session");
  await store.set("xai-session");
  assert.equal(await store.get(), "xai-session");
  await store.clear();
  assert.equal(await store.get(), "");
});

test("debug on localhost reads .env, and the phone build does not", async () => {
  assert.equal(isLocalDebug({ hostname: "127.0.0.1", search: "?debug=1" }), true);
  assert.equal(isLocalDebug({ hostname: "localhost", search: "?debug" }), true);
  assert.equal(isLocalDebug({ hostname: "localhost", search: "?debug=0" }), false);
  assert.equal(isLocalDebug({ hostname: "localhost", search: "" }), false);
  assert.equal(isLocalDebug({ hostname: "example.com", search: "?debug=1" }), false);

  const phone = createKeyStore({
    inCordova: true,
    debug: true,
    SecureStorage: class {
      constructor(success) { queueMicrotask(success); }
      get(success) { success(""); }
      set(success) { success(); }
      remove(success) { success(); }
    },
  });
  assert.equal(phone.backend, "keychain");

  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method });
    if (options.method === "GET") {
      return { ok: true, status: 200, json: async () => ({ apiKey: "Bearer xai-mac" }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const debug = createDebugEnvStore(fetchImpl);
  assert.equal(debug.backend, "debug");
  assert.equal(await debug.get(), "xai-mac");
  assert.equal(calls[0].url, "/__debug/key");
});

test("a missing .env key is an empty key", async () => {
  const store = createDebugEnvStore(async () => ({ ok: false, status: 404, json: async () => ({}) }));
  assert.equal(await store.get(), "");
});

test("the Keychain store treats a missing item as no key", async () => {
  const saved = new Map();
  class FakeSecureStorage {
    constructor(success) {
      queueMicrotask(success);
    }

    set(success, error, key, value) {
      saved.set(key, value);
      success(key);
    }

    get(success, error, key) {
      if (!saved.has(key)) error("Error: Item not found");
      else success(saved.get(key));
    }

    remove(success, error, key) {
      saved.delete(key);
      success(key);
    }
  }
  const store = createKeychainStore(FakeSecureStorage);
  assert.equal(store.backend, "keychain");
  assert.equal(await store.get(), "");
  await store.set("xai-phone");
  assert.equal(await store.get(), "xai-phone");
  assert.equal(saved.get("xai_api_key"), "xai-phone");
  await store.clear();
  assert.equal(await store.get(), "");
});
