const NAMES = {
  en: "English",
  eng: "English",
  fr: "French",
  fra: "French",
  es: "Spanish",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ko: "Korean",
  ja: "Japanese",
  jp: "Japanese",
  zh: "Chinese",
  ar: "Arabic",
  ru: "Russian",
  nl: "Dutch",
  sv: "Swedish",
  pl: "Polish",
  tr: "Turkish",
  vi: "Vietnamese",
  th: "Thai",
  id: "Indonesian",
  hi: "Hindi",
  uk: "Ukrainian",
};

export function formatSourceLang(value) {
  const raw = String(value || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const key = raw.toLowerCase();
  if (NAMES[key]) return NAMES[key];
  return raw.slice(0, 48);
}

export function formatElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)} seconds`;
  return `${Math.round(seconds)} seconds`;
}

export function formatWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function wordCount(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter((part) => /[\p{L}\p{N}]/u.test(part)).length;
}
