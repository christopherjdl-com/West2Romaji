"""Call Gemini."""

import re

from post import post_json
from translation import SYSTEM_PROMPT, read_translation, require_phrase, user_prompt

DEFAULT_MODEL = "gemini-3.5-flash-lite"
HOST = "https://generativelanguage.googleapis.com/v1beta/models"
TIMEOUT_SECONDS = 40

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "japanese": {"type": "STRING"},
        "romaji": {"type": "STRING"},
        "source_lang": {"type": "STRING"},
    },
    "required": ["japanese", "romaji", "source_lang"],
}


def normalize_model(value):
    return DEFAULT_MODEL


def endpoint(model):
    return f"{HOST}/{normalize_model(model)}:generateContent"


def build_body(text):
    return {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [
            {
                "role": "user",
                "parts": [{"text": user_prompt(text)}],
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": SCHEMA,
            "maxOutputTokens": 512,
            "thinkingConfig": {"thinkingLevel": "minimal"},
        },
    }


def adjust_body(body, error_text):
    text = str(error_text or "")
    config = dict(body.get("generationConfig") or {})
    changed = False
    if config.get("thinkingConfig") and re.search(r"thinking", text, re.I):
        config.pop("thinkingConfig", None)
        changed = True
    if config.get("responseSchema") and re.search(r"responseSchema|schema|unknown name", text, re.I):
        config.pop("responseSchema", None)
        changed = True
    if not changed:
        return None
    return {**body, "generationConfig": config}


def candidate_text(payload):
    candidates = payload.get("candidates") if isinstance(payload, dict) else None
    if not candidates:
        return ""
    parts = ((candidates[0].get("content") or {}).get("parts") or [])
    chunks = []
    spoken = []
    for part in parts:
        if not isinstance(part, dict) or not isinstance(part.get("text"), str):
            continue
        chunks.append(part["text"])
        if not part.get("thought"):
            spoken.append(part["text"])
    return "".join(spoken or chunks)


def translate(text, api_key, model=DEFAULT_MODEL, url=None):
    source = require_phrase(text)
    target = url or endpoint(model)

    def post(body):
        return _post_json(target, api_key, body)

    current = build_body(source)
    status, raw = post(current)
    if status == 400:
        adjusted = adjust_body(current, raw)
        if adjusted is not None:
            status, raw = post(adjusted)
    return read_translation(status, raw, candidate_text)


def _post_json(url, api_key, body):
    return post_json(
        url,
        body,
        {
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
            "User-Agent": "west2romaji",
        },
        TIMEOUT_SECONDS,
    )
