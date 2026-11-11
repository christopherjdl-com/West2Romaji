const HISTORY_KEY = "west2romaji.history";
export const HISTORY_LIMIT = 40;

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

function browserStorage() {
  try {
    if (typeof localStorage === "undefined") return memoryStorage();
    const probe = "west2romaji.probe";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch (error) {
    return memoryStorage();
  }
}

function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

function read(storage) {
  try {
    const raw = storage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
  } catch (error) {
    return [];
  }
}

function write(storage, entries) {
  const json = JSON.stringify(entries);
  try {
    storage.setItem(HISTORY_KEY, json);
  } catch (error) {
    const smaller = entries.slice(0, Math.max(1, Math.floor(entries.length / 2)));
    storage.setItem(HISTORY_KEY, JSON.stringify(smaller));
  }
}

function normalize(input) {
  return {
    id: input.id || uid(),
    createdAt: input.createdAt || new Date().toISOString(),
    sourceText: String(input.sourceText || ""),
    sourceLang: String(input.sourceLang || ""),
    japanese: String(input.japanese || ""),
    romaji: String(input.romaji || ""),
    model: String(input.model || ""),
    region: String(input.region || ""),
  };
}

export function createHistory(storage = browserStorage()) {
  let entries = read(storage);

  function persist() {
    write(storage, entries);
  }

  return {
    list() {
      return entries.map((entry) => ({ ...entry }));
    },
    add(input) {
      const entry = normalize(input);
      const newest = entries[0];
      if (
        newest
        && newest.sourceText === entry.sourceText
        && newest.japanese === entry.japanese
        && newest.romaji === entry.romaji
      ) {
        newest.createdAt = entry.createdAt;
        newest.sourceLang = entry.sourceLang || newest.sourceLang;
        newest.model = entry.model || newest.model;
        newest.region = entry.region || newest.region;
        persist();
        return { ...newest };
      }
      entries = [entry, ...entries].slice(0, HISTORY_LIMIT);
      persist();
      return { ...entry };
    },
    remove(id) {
      const index = entries.findIndex((entry) => entry.id === id);
      if (index < 0) return null;
      const [removed] = entries.splice(index, 1);
      persist();
      return { entry: { ...removed }, index };
    },
    insertAt(index, entry) {
      const next = normalize(entry);
      const clamped = Math.max(0, Math.min(index, entries.length));
      entries.splice(clamped, 0, next);
      entries = entries.slice(0, HISTORY_LIMIT);
      persist();
      return { ...next };
    },
    clear() {
      entries = [];
      persist();
    },
  };
}
