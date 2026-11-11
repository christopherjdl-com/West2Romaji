import assert from "node:assert/strict";
import test from "node:test";
import {
  adjustRequest,
  buildRequest,
  chooseProvider,
  reasoningEffortFor,
  SYSTEM_PROMPT,
  translatePhrase,
} from "../www/js/translate.js";

test("the prompt lets the model name any written language", () => {
  assert.match(SYSTEM_PROMPT, /any written language/i);
  assert.doesNotMatch(SYSTEM_PROMPT, /en\|fr/);
  assert.doesNotMatch(SYSTEM_PROMPT, /English or French only/i);
  const request = buildRequest({ text: "어디예요?", model: "grok-4.7" });
  assert.equal(request.body.model, "grok-4.7");
  assert.equal(request.body.reasoning_effort, "low");
  assert.equal(request.body.response_format.json_schema.schema.properties.source_lang.enum, undefined);
  assert.equal(JSON.stringify(request.body).includes("secret-key"), false);
  assert.equal(request.headers.Authorization, undefined);
});

test("null and empty xAI keys fall through to Gemini", () => {
  assert.deepEqual(chooseProvider({ xaiKey: "", geminiKey: "gemini-key" }), {
    provider: "gemini",
    apiKey: "gemini-key",
  });
  assert.deepEqual(chooseProvider({ xaiKey: "null", geminiKey: "gemini-key" }).provider, "gemini");
  assert.deepEqual(chooseProvider({ xaiKey: "undefined", geminiKey: "" }), {
    provider: "",
    apiKey: "",
  });
  assert.equal(chooseProvider({ xaiKey: "xai-real", geminiKey: "gemini-key" }).provider, "xai");
});

test("reasoning effort follows the current xAI model split", () => {
  assert.equal(reasoningEffortFor("grok-4.7"), "low");
  assert.equal(reasoningEffortFor("grok-4.6"), "low");
  assert.equal(reasoningEffortFor("grok-4.3"), "none");
  assert.equal(reasoningEffortFor("grok-4.20-0309-non-reasoning"), null);
});

test("a rejected request is adjusted once and then accepted", async () => {
  const calls = [];
  const result = await translatePhrase({
    text: "Où est la gare ?",
    apiKey: "xai-test-key",
    model: "grok-4.7",
    offline: () => false,
    now: (() => {
      let tick = 0;
      return () => {
        tick += 1000;
        return tick;
      };
    })(),
    post: async (request) => {
      calls.push(request);
      if (calls.length === 1) {
        return { status: 400, body: JSON.stringify({ error: { message: "response_format is not supported" } }) };
      }
      assert.equal(request.headers.Authorization, "Bearer xai-test-key");
      assert.equal(JSON.stringify(request.body).includes("xai-test-key"), false);
      assert.equal(request.body.response_format.type, "json_object");
      return {
        status: 200,
        body: JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                japanese: "駅はどこですか",
                romaji: "Eki wa doko desu ka",
                source_lang: "French",
              }),
            },
          }],
        }),
      };
    },
  });
  assert.equal(result.sourceLang, "French");
  assert.equal(result.romaji, "Eki wa doko desu ka");
  assert.equal(result.elapsedMs, 1000);
  assert.equal(calls.length, 2);
});

test("adjustRequest strips an unsupported reasoning field", () => {
  const request = buildRequest({ text: "hello", model: "grok-4.7" });
  const next = adjustRequest(request, "unknown parameter reasoning_effort");
  assert.equal(next.body.reasoning_effort, undefined);
  assert.equal(adjustRequest(request, "invalid api key"), null);
});

test("an empty xAI key sends the phrase to Gemini", async () => {
  const calls = [];
  const result = await translatePhrase({
    text: "Où est la gare ?",
    apiKey: "",
    geminiKey: "AIza-gemini-test-key",
    model: "grok-4.7",
    offline: () => false,
    post: async (request) => {
      calls.push(request);
      assert.equal(request.headers.Authorization, undefined);
      assert.equal(request.headers["x-goog-api-key"], "AIza-gemini-test-key");
      assert.equal(request.url.endsWith("/gemini-3.5-flash-lite:generateContent"), true);
      assert.equal(request.body.generationConfig.thinkingConfig.thinkingLevel, "minimal");
      assert.equal(request.timeoutMs, 45000);
      assert.equal(request.url.includes("AIza"), false);
      return {
        status: 200,
        body: JSON.stringify({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  japanese: "駅はどこですか",
                  romaji: "Eki wa doko desu ka",
                  source_lang: "French",
                }),
              }],
            },
          }],
        }),
      };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(result.romaji, "Eki wa doko desu ka");
});

test("a set xAI key is not replaced by Gemini", async () => {
  await translatePhrase({
    text: "hello",
    apiKey: "xai-real",
    geminiKey: "AIza-gemini-test-key",
    offline: () => false,
    post: async (request) => {
      assert.equal(request.headers.Authorization, "Bearer xai-real");
      assert.equal(request.url, "https://api.x.ai/v1/chat/completions");
      return {
        status: 200,
        body: JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                japanese: "こんにちは",
                romaji: "Konnichiwa",
                source_lang: "English",
              }),
            },
          }],
        }),
      };
    },
  });
});

test("missing key and empty text fail before the network", async () => {
  await assert.rejects(
    () => translatePhrase({ text: "   ", apiKey: "xai-x", offline: () => false, post: async () => { throw new Error("called"); } }),
    (error) => error.code === "empty"
  );
  await assert.rejects(
    () => translatePhrase({ text: "hello", apiKey: "", offline: () => false, post: async () => { throw new Error("called"); } }),
    (error) => error.code === "missing_key"
  );
});
