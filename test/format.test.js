import assert from "node:assert/strict";
import test from "node:test";
import { wordCount } from "../www/js/format.js";

test("word count ignores punctuation-only tokens", () => {
  assert.equal(wordCount("Où est la gare ?"), 4);
  assert.equal(wordCount("hello, world!"), 2);
  assert.equal(wordCount("   "), 0);
  assert.equal(wordCount("駅はどこですか"), 1);
});
