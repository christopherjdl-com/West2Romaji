import assert from "node:assert/strict";
import test from "node:test";
import { parseTranslation, translationFromResponse } from "../www/js/parse.js";

test("parses the translation object and keeps an open source language", () => {
  const parsed = parseTranslation(JSON.stringify({
    japanese: "駅はどこですか",
    romaji: "Eki wa doko desu ka",
    source_lang: "Korean",
  }));
  assert.equal(parsed.japanese, "駅はどこですか");
  assert.equal(parsed.romaji, "Eki wa doko desu ka");
  assert.equal(parsed.sourceLang, "Korean");
});

test("accepts a language code and a fenced payload", () => {
  const parsed = parseTranslation("```json\n{\"japanese\":\"はい\",\"romaji\":\"Hai\",\"source_lang\":\"fr\"}\n```");
  assert.equal(parsed.sourceLang, "French");
  assert.equal(parsed.romaji, "Hai");
});

test("reads a chat completion envelope", () => {
  const body = JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          japanese: "ありがとう",
          romaji: "Arigatō",
          source_lang: "Spanish",
        }),
      },
    }],
  });
  const parsed = translationFromResponse(body);
  assert.equal(parsed.sourceLang, "Spanish");
  assert.equal(parsed.japanese, "ありがとう");
});

test("rejects an empty translation", () => {
  assert.throws(
    () => parseTranslation(JSON.stringify({ japanese: "", romaji: "", source_lang: "English" })),
    (error) => error.code === "bad_response"
  );
});
