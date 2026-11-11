export class AppError extends Error {
  constructor(code, message, detail = "") {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.detail = detail;
  }
}

export const MESSAGES = {
  empty: "Type a phrase first.",
  too_long: "Keep the phrase under 600 characters.",
  missing_key: "No translation key is set. Leave XAI_API_KEY empty and set GEMINI_API_KEY to use Gemini.",
  offline: "No connection. Phrases you already translated are still in History.",
  invalid_key: "The translation key was rejected.",
  payment: "That translation account has no credit left.",
  rate_limit: "The translation service is rate-limiting requests. Wait a moment and try again.",
  timeout: "The translation timed out. Check your connection and try again.",
  server: "The translation service had a problem answering. Try again in a moment.",
  bad_response: "The translation came back in an unexpected shape. Try again.",
};

export function redact(text, secret = "") {
  let out = String(text || "");
  if (secret) out = out.split(secret).join("…");
  return out
    .replace(/Bearer\s+\S+/gi, "Bearer …")
    .replace(/\bxai-[A-Za-z0-9_-]+\b/g, "xai-…")
    .replace(/\bAIza[0-9A-Za-z_-]{10,}\b/g, "AIza…");
}

export function extractApiMessage(body) {
  if (!body) return "";
  try {
    const json = typeof body === "string" ? JSON.parse(body) : body;
    const message = json?.error?.message || json?.message || json?.error;
    if (typeof message === "string") return message.slice(0, 240);
  } catch (error) {
    /* Not JSON. */
  }
  const text = String(body).replace(/\s+/g, " ").trim();
  if (!text || text.length > 240 || text.startsWith("<")) return "";
  return text;
}

export function mapStatus(status, body, secret = "", provider = "xai") {
  const name = provider === "gemini" ? "Gemini" : "xAI";
  const detail = redact(extractApiMessage(body), secret);
  if (status === 401 || status === 403) {
    return new AppError("invalid_key", `${name} rejected that API key.`, detail);
  }
  if (status === 402) return new AppError("payment", MESSAGES.payment, detail);
  if (status === 408) return new AppError("timeout", MESSAGES.timeout, detail);
  if (status === 429) return new AppError("rate_limit", MESSAGES.rate_limit, detail);
  if (status >= 500) return new AppError("server", MESSAGES.server, detail);
  if (status >= 400) {
    return new AppError("bad_response", detail || MESSAGES.bad_response, detail);
  }
  return null;
}

export function userMessage(error) {
  if (error instanceof AppError) {
    if (error.detail && error.code === "bad_response" && error.detail !== error.message) {
      return error.message;
    }
    return error.message;
  }
  return MESSAGES.server;
}
