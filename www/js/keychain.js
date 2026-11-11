const SERVICE = "app.west2romaji";
const ACCOUNT = "xai_api_key";
const SESSION_KEY = "west2romaji.preview-key";

function call(target, method, args) {
  return new Promise((resolve, reject) => {
    target[method](resolve, reject, ...args);
  });
}

export function normalizeKey(value) {
  return String(value || "").trim().replace(/^bearer\s+/i, "").trim();
}

export function explainKeychainError(error) {
  const text = String(error?.message || error || "The iPhone Keychain could not be opened.");
  if (/passcode|not secure|secure screen|lock screen|device is not secure/i.test(text)) {
    return "The iPhone Keychain could not be opened. Set a device passcode, unlock the phone, and try again.";
  }
  return text.length > 180 ? "The iPhone Keychain could not be opened." : text;
}

function unavailable(message) {
  const fail = () => Promise.reject(new Error(message));
  return { backend: "unavailable", get: fail, set: fail, clear: fail };
}

export function createKeychainStore(SecureStorage) {
  if (typeof SecureStorage !== "function") {
    return unavailable("The Keychain plugin is not installed in this build.");
  }
  let store = null;
  const ready = new Promise((resolve, reject) => {
    try {
      store = new SecureStorage(
        () => resolve(store),
        (error) => reject(new Error(explainKeychainError(error))),
        SERVICE
      );
    } catch (error) {
      reject(new Error(explainKeychainError(error)));
    }
  });

  async function withStore() {
    await ready;
    return store;
  }

  return {
    backend: "keychain",
    async get() {
      const ss = await withStore();
      try {
        return await call(ss, "get", [ACCOUNT]);
      } catch (error) {
        if (/not found|item not found|null/i.test(String(error?.message || error))) return "";
        throw new Error(explainKeychainError(error));
      }
    },
    async set(value) {
      const ss = await withStore();
      await call(ss, "set", [ACCOUNT, value]);
    },
    async clear() {
      const ss = await withStore();
      try {
        await call(ss, "remove", [ACCOUNT]);
      } catch (error) {
        if (/not found|item not found/i.test(String(error?.message || error))) return;
        throw new Error(explainKeychainError(error));
      }
    },
  };
}

export function createSessionStore(storage) {
  const session = storage || fallbackSession();
  return {
    backend: "session",
    async get() {
      return session.getItem(SESSION_KEY) || "";
    },
    async set(value) {
      session.setItem(SESSION_KEY, value);
    },
    async clear() {
      session.removeItem(SESSION_KEY);
    },
  };
}

function fallbackSession() {
  try {
    if (typeof sessionStorage !== "undefined") {
      const probe = "west2romaji.session-probe";
      sessionStorage.setItem(probe, "1");
      sessionStorage.removeItem(probe);
      return sessionStorage;
    }
  } catch (error) {
    /* Private mode can throw. Keep the key in memory for this page only. */
  }
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

export const MAC_KEY_ENDPOINT = "/__debug/key";

export function isLocalDebug(location) {
  const loc = location || globalThis.location;
  if (!loc) return false;
  const host = String(loc.hostname || "");
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (!loopback) return false;
  const params = new URLSearchParams(loc.search || "");
  if (!params.has("debug")) return false;
  const value = params.get("debug");
  return value === "" || value === "1" || value === "true";
}

export function createDebugEnvStore(fetchImpl = globalThis.fetch) {
  async function send(method, body) {
    const response = await fetchImpl(MAC_KEY_ENDPOINT, {
      method,
      cache: "no-store",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return response;
  }

  const store = {
    backend: "debug",
    provider: "",
    async get() {
      const response = await send("GET");
      if (response.status === 404) {
        store.provider = "";
        return "";
      }
      if (!response.ok) throw new Error("The debug key could not be read.");
      const data = await response.json();
      store.provider = data.provider === "gemini" ? "gemini" : (data.apiKey ? "xai" : "");
      return normalizeKey(data.apiKey || "");
    },
    async set(value) {
      const response = await send("PUT", { apiKey: value });
      if (!response.ok) throw new Error("The debug key could not be saved.");
    },
    async clear() {
      const response = await send("DELETE");
      if (response.status === 404 || response.ok) return;
      throw new Error("The debug key could not be saved.");
    },
  };
  return store;
}

export function createKeyStore({ inCordova = false, debug = false, SecureStorage, session, fetchImpl } = {}) {
  if (inCordova) return createKeychainStore(SecureStorage);
  if (debug) return createDebugEnvStore(fetchImpl);
  return createSessionStore(session);
}
