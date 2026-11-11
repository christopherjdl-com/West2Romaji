import { AppError, MESSAGES, mapStatus } from "./errors.js";
import { isOffline, postJson } from "./net.js";
import { translationFromResponse } from "./parse.js";

export const DEFAULT_MODEL = "grok-4.7";
export const GEMINI_MODEL = "gemini-3.5-flash-lite";
export const MAX_CHARS = 600;
export const WORD_HINT = 20;
export const ENDPOINT = "https://api.x.ai/v1/chat/completions";
export const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

const SYSTEM_PROMPT = `You translate text into natural spoken Japanese for someone travelling in Japan who will read the romaji aloud.
The user's text may be in any written language. Identify that language yourself. Do not assume English or French, and do not ask which language it is.
Return JSON only, with exactly these fields:
- "japanese": the Japanese as it is normally written, using kanji and kana where a native sentence would.
- "romaji": Modified Hepburn. Use macrons for long vowels (Tōkyō, Kyōto). Write the particles は as "wa", を as "o", and へ as "e".
- "source_lang": the English name of the language the user wrote in, such as "English", "French", "Korean", or "Arabic".
If the text is already Japanese, return that Japanese and its Hepburn reading, with source_lang "Japanese".
If it is only a name or a number, transliterate it into Japanese and romaji.
No notes, no furigana, and no markdown.`;

export function normalizeModel(value) {
  const model = String(value || "").trim();
  if (/^[A-Za-z0-9._-]{1,80}$/.test(model)) return model;
  return DEFAULT_MODEL;
}

export function usableKey(value) {
  const key = String(value ?? "").trim().replace(/^bearer\s+/i, "").trim();
  if (!key || /^(null|undefined)$/i.test(key)) return "";
  return key;
}

export function chooseProvider({ xaiKey, geminiKey } = {}) {
  const xai = usableKey(xaiKey);
  if (xai) return { provider: "xai", apiKey: xai };
  const gemini = usableKey(geminiKey);
  if (gemini) return { provider: "gemini", apiKey: gemini };
  return { provider: "", apiKey: "" };
}

export function modelFor(provider, requested) {
  const model = normalizeModel(requested);
  if (provider === "gemini") return GEMINI_MODEL;
  if (model.startsWith("gemini-")) return DEFAULT_MODEL;
  return model;
}

export function reasoningEffortFor(model) {
  if (/^grok-4\.(5|6|7)($|[^0-9])/.test(model)) return "low";
  if (model === "grok-4.3") return "none";
  return null;
}

export function buildRequest({ text, model = DEFAULT_MODEL }) {
  const chosen = modelFor("xai", model);
  const body = {
    model: chosen,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Translate this into Japanese.\n\nTEXT:\n"""\n${text}\n"""`,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "west2romaji",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            japanese: { type: "string" },
            romaji: { type: "string" },
            source_lang: {
              type: "string",
              description: "English name of the language the user wrote in",
            },
          },
          required: ["japanese", "romaji", "source_lang"],
        },
      },
    },
    max_completion_tokens: 700,
  };
  const effort = reasoningEffortFor(chosen);
  if (effort) body.reasoning_effort = effort;
  return {
    url: ENDPOINT,
    headers: {
      "Content-Type": "application/json",
      "x-grok-conv-id": "west2romaji",
    },
    body,
    timeoutMs: 25000,
  };
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    japanese: { type: "STRING" },
    romaji: { type: "STRING" },
    source_lang: { type: "STRING" },
  },
  required: ["japanese", "romaji", "source_lang"],
};

export function buildGeminiRequest({ text, model = GEMINI_MODEL }) {
  const chosen = modelFor("gemini", model);
  return {
    url: `${GEMINI_ENDPOINT}/${chosen}:generateContent`,
    headers: { "Content-Type": "application/json" },
    body: {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{
        role: "user",
        parts: [{ text: `Translate this into Japanese.\n\nTEXT:\n"""\n${text}\n"""` }],
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        maxOutputTokens: 512,
        thinkingConfig: { thinkingLevel: "minimal" },
      },
    },
    timeoutMs: 45000,
  };
}

export function adjustGeminiRequest(request, errorBody) {
  const text = String(errorBody || "");
  const config = request.body?.generationConfig;
  if (!config) return null;
  const generationConfig = { ...config };
  let changed = false;
  if (generationConfig.thinkingConfig && /thinking/i.test(text)) {
    delete generationConfig.thinkingConfig;
    changed = true;
  }
  if (generationConfig.responseSchema && /responseSchema|schema|unknown name/i.test(text)) {
    delete generationConfig.responseSchema;
    changed = true;
  }
  if (!changed) return null;
  return { ...request, body: { ...request.body, generationConfig } };
}

export function adjustRequest(request, errorBody) {
  const text = String(errorBody || "");
  if (request.body.reasoning_effort && /reasoning_effort|does not support reasoning/i.test(text)) {
    const body = { ...request.body };
    delete body.reasoning_effort;
    return { ...request, body };
  }
  if (request.body.response_format?.type === "json_schema" && /response_format|json_schema/i.test(text)) {
    return {
      ...request,
      body: { ...request.body, response_format: { type: "json_object" } },
    };
  }
  if (request.body.max_completion_tokens && /max_completion_tokens/i.test(text)) {
    const { max_completion_tokens: limit, ...rest } = request.body;
    return { ...request, body: { ...rest, max_tokens: limit } };
  }
  return null;
}

export async function completeChat({ post, request, adjust = adjustRequest }) {
  let current = request;
  let response = await post(current);
  for (let attempt = 0; attempt < 3 && response.status === 400; attempt += 1) {
    const next = adjust(current, response.body);
    if (!next) break;
    current = next;
    response = await post(current);
  }
  return response;
}

export async function translatePhrase({
  text,
  apiKey,
  geminiKey,
  provider,
  model,
  post = postJson,
  offline = isOffline,
  now = () => Date.now(),
}) {
  const sourceText = String(text || "").trim();
  if (!sourceText) throw new AppError("empty", MESSAGES.empty);
  if (sourceText.length > MAX_CHARS) throw new AppError("too_long", MESSAGES.too_long);
  const chosen = provider
    ? { provider, apiKey: usableKey(apiKey) }
    : chooseProvider({ xaiKey: apiKey, geminiKey });
  if (!chosen.provider || !chosen.apiKey) throw new AppError("missing_key", MESSAGES.missing_key);
  if (offline()) throw new AppError("offline", MESSAGES.offline);

  const started = now();
  const request = chosen.provider === "gemini"
    ? buildGeminiRequest({ text: sourceText, model })
    : buildRequest({ text: sourceText, model });
  const auth = chosen.provider === "gemini"
    ? { "x-goog-api-key": chosen.apiKey }
    : { Authorization: `Bearer ${chosen.apiKey}` };
  const response = await completeChat({
    post: (req) => post({ ...req, headers: { ...req.headers, ...auth } }),
    request,
    adjust: chosen.provider === "gemini" ? adjustGeminiRequest : adjustRequest,
  });
  const failure = mapStatus(response.status, response.body, chosen.apiKey, chosen.provider);
  if (failure) throw failure;
  const translation = translationFromResponse(response.body);
  return {
    sourceText,
    sourceLang: translation.sourceLang,
    japanese: translation.japanese,
    romaji: translation.romaji,
    romajiVia: translation.romajiVia,
    elapsedMs: Math.max(0, now() - started),
  };
}

export { SYSTEM_PROMPT };
