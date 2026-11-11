import { AppError, MESSAGES } from "./errors.js";
import { formatSourceLang } from "./format.js";
import { cleanRomaji, resolveRomaji } from "./romaji.js";

function cleanJapanese(value) {
  return String(value || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function parseJsonObject(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new AppError("bad_response", MESSAGES.bad_response);
  const candidates = [trimmed];
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1].trim());
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));

  let lastError = null;
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch (error) {
      lastError = error;
    }
  }
  throw new AppError("bad_response", MESSAGES.bad_response, lastError ? String(lastError.message || "") : "");
}

export function parseTranslation(content) {
  const text = Array.isArray(content)
    ? content.map((part) => part?.text || "").join("")
    : String(content || "");
  const json = parseJsonObject(text);
  const japanese = cleanJapanese(json.japanese);
  const romaji = cleanRomaji(json.romaji);
  if (!japanese || !romaji) {
    throw new AppError(
      "bad_response",
      "The model returned no Japanese. Try again."
    );
  }
  const resolved = resolveRomaji({ japanese, romaji });
  if (!resolved.romaji) {
    throw new AppError("bad_response", MESSAGES.bad_response);
  }
  return {
    japanese,
    romaji: resolved.romaji,
    romajiVia: resolved.via,
    sourceLang: formatSourceLang(json.source_lang),
  };
}

export function extractMessageContent(payload) {
  const data = typeof payload === "string" ? JSON.parse(payload) : payload;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content;
  if (Array.isArray(content)) {
    const joined = content.map((part) => part?.text || "").join("").trim();
    if (joined) return joined;
  }
  throw new AppError(
    "bad_response",
    "The model returned no Japanese. Try again."
  );
}

export function geminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  const spoken = parts.filter((part) => !part?.thought).map((part) => part?.text || "").join("").trim();
  if (spoken) return spoken;
  return parts.map((part) => part?.text || "").join("").trim();
}

export function translationFromResponse(body) {
  let data = null;
  try {
    data = JSON.parse(body);
  } catch (error) {
    throw new AppError("bad_response", MESSAGES.bad_response);
  }
  if (data?.choices) return parseTranslation(extractMessageContent(data));
  const gemini = geminiText(data);
  if (gemini) return parseTranslation(gemini);
  return parseTranslation(body);
}
