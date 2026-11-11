import assert from "node:assert/strict";
import test from "node:test";
import { isKanaText, resolveRomaji, toHepburn } from "../www/js/romaji.js";

test("modified Hepburn readings", () => {
  assert.equal(toHepburn("とうきょう"), "tōkyō");
  assert.equal(toHepburn("がっこう"), "gakkō");
  assert.equal(toHepburn("まっちゃ"), "matcha");
  assert.equal(toHepburn("こっち"), "kotchi");
  assert.equal(toHepburn("しんぶん"), "shinbun");
  assert.equal(toHepburn("きんえん"), "kin'en");
  assert.equal(toHepburn("こんにちは"), "konnichiha");
  assert.equal(toHepburn("ラーメン"), "rāmen");
  assert.equal(toHepburn("コーヒー"), "kōhī");
  assert.equal(toHepburn("おおきい"), "ōkii");
  assert.equal(toHepburn("せんせい"), "sensei");
  assert.equal(toHepburn("カタカナ"), "katakana");
  assert.equal(toHepburn("じゅんび"), "junbi");
  assert.equal(toHepburn("りょこう"), "ryokō");
  assert.equal(toHepburn("いっしょ"), "issho");
  assert.equal(toHepburn("じゃ"), "ja");
});

test("kanji is not guessed", () => {
  assert.equal(toHepburn("今日はいい天気です"), "");
  assert.equal(isKanaText("こんにちは"), true);
  assert.equal(isKanaText("今日は"), false);
});

test("the model romaji wins when it is a real reading", () => {
  const kept = resolveRomaji({ japanese: "こんにちは", romaji: "Konnichiwa" });
  assert.equal(kept.romaji, "Konnichiwa");
  assert.equal(kept.via, "model");

  const kanji = resolveRomaji({
    japanese: "今日はいい天気です",
    romaji: "Kyō wa ii tenki desu",
  });
  assert.equal(kanji.romaji, "Kyō wa ii tenki desu");
  assert.equal(kanji.via, "model");
});

test("a kana phrase is regenerated when the model romaji is unrelated", () => {
  const fixed = resolveRomaji({ japanese: "こんにちは", romaji: "hello" });
  assert.equal(fixed.romaji, "konnichiha");
  assert.equal(fixed.via, "hepburn");
});

test("macrons and ou-spellings count as the same reading", () => {
  const kept = resolveRomaji({ japanese: "とうきょう", romaji: "toukyou" });
  assert.equal(kept.via, "model");
  assert.equal(kept.romaji, "toukyou");
});
