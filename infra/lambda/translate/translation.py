"""Shared prompt and reply for every model provider.

The prompt matches www/js/translate.js. Keep the two together when either changes.
"""

import json
import re

from errors import TranslationError

MAX_CHARS = 600
UNEXPECTED = "The translation came back in an unexpected shape."

SYSTEM_PROMPT = """You translate text into natural spoken Japanese for someone travelling in Japan who will read the romaji aloud.
The user's text may be in any written language. Identify that language yourself. Do not assume English or French, and do not ask which language it is.
Return JSON only, with exactly these fields:
- "japanese": the Japanese as it is normally written, using kanji and kana where a native sentence would.
- "romaji": Modified Hepburn. Use macrons for long vowels (Tōkyō, Kyōto). Write the particles は as "wa", を as "o", and へ as "e".
- "source_lang": the English name of the language the user wrote in, such as "English", "French", "Korean".
If the text is already Japanese, return that Japanese and its Hepburn reading, with source_lang "Japanese".
If it is only a name or a number, transliterate it into Japanese and romaji.
No notes, no furigana, and no markdown."""


def user_prompt(text):
    return f'Translate this into Japanese.\n\nTEXT:\n"""\n{text}\n"""'


def require_phrase(text):
    source = str(text or "").strip()
    if not source:
        raise TranslationError(400, "Write a phrase first.")
    if len(source) > MAX_CHARS:
        raise TranslationError(400, "That phrase is too long.")
    return source


def public_failure(status):
    if status == 429:
        return TranslationError(429, "The translation service is busy. Try again in a moment.")
    if status in (401, 403):
        return TranslationError(502, "The translation key was rejected.")
    if status == 408:
        return TranslationError(504, "The translation took too long.")
    return TranslationError(502, "The translation service did not answer.")


def parse_translation_content(content):
    text = _without_fence(str(content or "").strip())
    data = _object(text)
    japanese = str(data.get("japanese") or "").strip()
    romaji = str(data.get("romaji") or "").strip()
    source_lang = str(data.get("source_lang") or "").strip()
    if not japanese or not romaji or not source_lang:
        raise TranslationError(502, UNEXPECTED)
    return {"japanese": japanese, "romaji": romaji, "source_lang": source_lang}


def read_json(raw):
    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        raise TranslationError(502, UNEXPECTED) from error


def read_translation(status, raw, text_of):
    if status != 200:
        raise public_failure(status)
    return parse_translation_content(text_of(read_json(raw)))


def _without_fence(text):
    if not text.startswith("```"):
        return text
    text = re.sub(r"^```(?:json)?", "", text).strip()
    return re.sub(r"```$", "", text).strip()


def _object(text):
    try:
        data = json.loads(text)
    except json.JSONDecodeError as error:
        raise TranslationError(502, UNEXPECTED) from error
    if not isinstance(data, dict):
        raise TranslationError(502, UNEXPECTED)
    return data
