import assert from "node:assert/strict";
import test from "node:test";
import { createHistory, HISTORY_LIMIT } from "../www/js/history.js";

function memory() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

test("stores phrases newest first and drops anything that is not a phrase", () => {
  const history = createHistory(memory());
  history.add({
    sourceText: "hello",
    sourceLang: "English",
    japanese: "こんにちは",
    romaji: "Konnichiwa",
    model: "nova",
    region: "eu-west-3",
    apiKey: "xai-secret",
  });
  const [entry] = history.list();
  assert.equal(entry.sourceText, "hello");
  assert.equal(entry.sourceLang, "English");
  assert.equal(entry.model, "nova");
  assert.equal(entry.region, "eu-west-3");
  assert.equal("apiKey" in entry, false);
  assert.equal(JSON.stringify(entry).includes("xai-secret"), false);
});

test("refreshes a duplicate instead of stacking it", () => {
  const history = createHistory(memory());
  const first = history.add({ sourceText: "a", japanese: "あ", romaji: "a", createdAt: "2026-01-01T00:00:00.000Z" });
  const second = history.add({ sourceText: "a", japanese: "あ", romaji: "a", createdAt: "2026-02-01T00:00:00.000Z" });
  assert.equal(history.list().length, 1);
  assert.equal(second.id, first.id);
  assert.equal(history.list()[0].createdAt, "2026-02-01T00:00:00.000Z");
});

test("caps the list and can undo a delete by index", () => {
  const history = createHistory(memory());
  for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
    history.add({ sourceText: `phrase ${i}`, japanese: "あ", romaji: `a${i}` });
  }
  assert.equal(history.list().length, HISTORY_LIMIT);
  assert.equal(history.list()[0].sourceText, `phrase ${HISTORY_LIMIT + 4}`);
  const removed = history.remove(history.list()[3].id);
  history.insertAt(removed.index, removed.entry);
  assert.equal(history.list()[3].id, removed.entry.id);
});
