/**
 * Modified Hepburn for kana-only strings.
 * The model’s romaji is what we show when it is Latin and close to this
 * reading. Regeneration is the fallback for a missing or unrelated answer,
 * and the consistency check when the Japanese is kana. Kanji is left to the
 * model: this module does not guess readings, and it does not try to turn
 * the particles は / を / へ into wa / o / e.
 */

const BASIC = {
  あ: "a", い: "i", う: "u", え: "e", お: "o",
  か: "ka", き: "ki", く: "ku", け: "ke", こ: "ko",
  が: "ga", ぎ: "gi", ぐ: "gu", げ: "ge", ご: "go",
  さ: "sa", し: "shi", す: "su", せ: "se", そ: "so",
  ざ: "za", じ: "ji", ず: "zu", ぜ: "ze", ぞ: "zo",
  た: "ta", ち: "chi", つ: "tsu", て: "te", と: "to",
  だ: "da", ぢ: "ji", づ: "zu", で: "de", ど: "do",
  な: "na", に: "ni", ぬ: "nu", ね: "ne", の: "no",
  は: "ha", ひ: "hi", ふ: "fu", へ: "he", ほ: "ho",
  ば: "ba", び: "bi", ぶ: "bu", べ: "be", ぼ: "bo",
  ぱ: "pa", ぴ: "pi", ぷ: "pu", ぺ: "pe", ぽ: "po",
  ま: "ma", み: "mi", む: "mu", め: "me", も: "mo",
  や: "ya", ゆ: "yu", よ: "yo",
  ら: "ra", り: "ri", る: "ru", れ: "re", ろ: "ro",
  わ: "wa", ゐ: "wi", ゑ: "we", を: "o", ん: "n",
  ゔ: "vu",
};

const DIGRAPH = {
  きゃ: "kya", きゅ: "kyu", きょ: "kyo",
  ぎゃ: "gya", ぎゅ: "gyu", ぎょ: "gyo",
  しゃ: "sha", しゅ: "shu", しょ: "sho",
  じゃ: "ja", じゅ: "ju", じょ: "jo",
  ちゃ: "cha", ちゅ: "chu", ちょ: "cho",
  にゃ: "nya", にゅ: "nyu", にょ: "nyo",
  ひゃ: "hya", ひゅ: "hyu", ひょ: "hyo",
  びゃ: "bya", びゅ: "byu", びょ: "byo",
  ぴゃ: "pya", ぴゅ: "pyu", ぴょ: "pyo",
  みゃ: "mya", みゅ: "myu", みょ: "myo",
  りゃ: "rya", りゅ: "ryu", りょ: "ryo",
  ぢゃ: "ja", ぢゅ: "ju", ぢょ: "jo",
  ふぁ: "fa", ふぃ: "fi", ふぇ: "fe", ふぉ: "fo",
  てぃ: "ti", でぃ: "di",
  とぅ: "tu", どぅ: "du",
  うぃ: "wi", うぇ: "we",
  ゔぁ: "va", ゔぃ: "vi", ゔぇ: "ve", ゔぉ: "vo",
  じぇ: "je", しぇ: "she", ちぇ: "che",
};

const SMALL = {
  ゃ: "ya", ゅ: "yu", ょ: "yo",
  ぁ: "a", ぃ: "i", ぅ: "u", ぇ: "e", ぉ: "o",
  ゎ: "wa",
};

const PUNCT = {
  "、": ", ",
  "。": ". ",
  "！": "!",
  "？": "?",
  "・": " ",
  "「": "\"",
  "」": "\"",
  "『": "\"",
  "』": "\"",
  "　": " ",
};

const MACRON = { a: "ā", i: "ī", u: "ū", e: "ē", o: "ō" };

function toHiragana(text) {
  let out = "";
  for (const ch of text.normalize("NFKC")) {
    const code = ch.codePointAt(0);
    if (code >= 0x30a1 && code <= 0x30f6) out += String.fromCodePoint(code - 0x60);
    else out += ch;
  }
  return out;
}

function vowelOf(romaji) {
  const match = /[aeiou]/.exec(romaji.replace(/[āīūēō]/g, (m) => ({ ā: "a", ī: "i", ū: "u", ē: "e", ō: "o" }[m])));
  if (!match) return "";
  return romaji.replace(/[āīūēō]/g, (m) => ({ ā: "a", ī: "i", ū: "u", ē: "e", ō: "o" }[m])).match(/[aeiou](?!.*[aeiou])/)?.[0] || "";
}

function geminate(romaji) {
  if (romaji.startsWith("ch")) return `t${romaji}`;
  const consonant = romaji.match(/^([^aeiouāīūēō])/);
  if (!consonant) return romaji;
  return consonant[1] + romaji;
}

function macronize(syllable) {
  syllable.romaji = syllable.romaji.replace(/[aeiou]$/, (vowel) => MACRON[vowel]);
}

function tidy(text) {
  return text.replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
}

export function hasJapaneseScript(text) {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(String(text || ""));
}

export function isKanaText(text) {
  const stripped = String(text || "")
    .normalize("NFKC")
    .replace(/[\s\d.,!?'"“”「」『』、。！？・\-—…()（）：:；;]/g, "");
  if (!stripped) return false;
  return /^[\u3041-\u3096\u30a1-\u30fc]+$/.test(stripped);
}

export function cleanRomaji(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * @returns {string} Hepburn, or "" when the string contains kanji or an unknown mark.
 */
export function toHepburn(input) {
  const text = toHiragana(String(input || "").trim());
  if (!text) return "";
  const chars = [...text];
  const syllables = [];
  let pendingStop = false;

  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    if (ch === "っ") {
      pendingStop = true;
      continue;
    }
    if (ch === "ー") {
      syllables.push({ romaji: "", kana: "ー", choon: true, vowel: "" });
      continue;
    }
    if (PUNCT[ch] !== undefined || /\s/.test(ch)) {
      syllables.push({ romaji: PUNCT[ch] ?? ch, kana: ch, literal: true, vowel: "" });
      pendingStop = false;
      continue;
    }

    const pair = ch + (chars[i + 1] || "");
    let romaji = "";
    let kana = ch;
    if (DIGRAPH[pair]) {
      romaji = DIGRAPH[pair];
      kana = pair;
      i += 1;
    } else if (BASIC[ch]) {
      romaji = BASIC[ch];
    } else if (SMALL[ch]) {
      romaji = SMALL[ch];
    } else if (/[A-Za-z0-9]/.test(ch)) {
      romaji = ch;
    } else {
      return "";
    }

    if (pendingStop) {
      romaji = geminate(romaji);
      pendingStop = false;
    }
    syllables.push({ romaji, kana, vowel: vowelOf(romaji) });
  }

  const merged = [];
  for (const syllable of syllables) {
    const previous = merged[merged.length - 1];
    if (syllable.choon) {
      if (previous?.vowel) macronize(previous);
      continue;
    }
    if (!syllable.literal && previous && !previous.literal) {
      const extendsO = syllable.kana === "う" && previous.vowel === "o";
      const extendsU = syllable.kana === "う" && previous.vowel === "u";
      const repeats = syllable.kana === "あ" && previous.vowel === "a"
        || syllable.kana === "え" && previous.vowel === "e"
        || syllable.kana === "お" && previous.vowel === "o";
      if (extendsO || extendsU || repeats) {
        macronize(previous);
        continue;
      }
    }
    merged.push(syllable);
  }

  let out = "";
  for (let i = 0; i < merged.length; i += 1) {
    let part = merged[i].romaji;
    if (part === "n") {
      const next = merged[i + 1]?.romaji || "";
      if (/^[aeiouyāīūēō]/.test(next)) part = "n'";
    }
    out += part;
  }
  return tidy(out);
}

function fold(text) {
  return text
    .toLowerCase()
    .replace(/[āīūēō]/g, (mark) => ({ ā: "a", ī: "i", ū: "u", ē: "e", ō: "o" }[mark]))
    .replace(/ou/g, "o")
    .replace(/oo/g, "o")
    .replace(/uu/g, "u")
    .replace(/[^a-z]/g, "");
}

function levenshtein(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
    }
  }
  return rows[a.length][b.length];
}

function similarity(a, b) {
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  if (!max) return 1;
  return 1 - levenshtein(a, b) / max;
}

export function resolveRomaji({ japanese = "", romaji = "" } = {}) {
  const model = cleanRomaji(romaji);
  const generated = isKanaText(japanese) ? toHepburn(japanese) : "";
  const modelIsLatin = model && !hasJapaneseScript(model);

  if (!modelIsLatin) {
    return { romaji: generated, via: generated ? "hepburn" : "model" };
  }
  if (!generated) return { romaji: model, via: "model" };
  if (similarity(fold(model), fold(generated)) < 0.55) {
    return { romaji: generated, via: "hepburn" };
  }
  return { romaji: model, via: "model" };
}
