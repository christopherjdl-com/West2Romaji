"""Call xAI the same way the phone used to."""

import re

from post import post_json
from translation import (
    SYSTEM_PROMPT,
    parse_translation_content,
    read_translation,
    require_phrase,
    user_prompt,
)

ENDPOINT = "https://api.x.ai/v1/chat/completions"
DEFAULT_MODEL = "grok-4.7"
TIMEOUT_SECONDS = 20


def normalize_model(value):
    model = str(value or "").strip()
    if re.fullmatch(r"[A-Za-z0-9._-]{1,80}", model):
        return model
    return DEFAULT_MODEL


def reasoning_effort_for(model):
    if re.match(r"^grok-4\.(5|6|7)($|[^0-9])", model):
        return "low"
    if model == "grok-4.3":
        return "none"
    return None


def build_body(text, model):
    chosen = normalize_model(model)
    body = {
        "model": chosen,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt(text)},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "west2romaji",
                "strict": True,
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "japanese": {"type": "string"},
                        "romaji": {"type": "string"},
                        "source_lang": {
                            "type": "string",
                            "description": "English name of the language the user wrote in",
                        },
                    },
                    "required": ["japanese", "romaji", "source_lang"],
                },
            },
        },
        "max_completion_tokens": 700,
    }
    effort = reasoning_effort_for(chosen)
    if effort:
        body["reasoning_effort"] = effort
    return body


def adjust_body(body, error_text):
    text = str(error_text or "")
    if body.get("reasoning_effort") and re.search(r"reasoning_effort|does not support reasoning", text, re.I):
        return {key: value for key, value in body.items() if key != "reasoning_effort"}
    response_format = body.get("response_format") or {}
    if response_format.get("type") == "json_schema" and re.search(r"response_format|json_schema", text, re.I):
        return {**body, "response_format": {"type": "json_object"}}
    if body.get("max_completion_tokens") and re.search(r"max_completion_tokens", text, re.I):
        limit = body["max_completion_tokens"]
        rest = {key: value for key, value in body.items() if key != "max_completion_tokens"}
        return {**rest, "max_tokens": limit}
    return None


def complete(post, body):
    current = body
    status, text = post(current)
    for _ in range(3):
        if status != 400:
            break
        nxt = adjust_body(current, text)
        if nxt is None:
            break
        current = nxt
        status, text = post(current)
    return status, text


def message_content(payload):
    choices = payload.get("choices") if isinstance(payload, dict) else None
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(_content_part(part) for part in content)
    return ""


def translation_from(payload):
    return parse_translation_content(message_content(payload))


def translate(text, api_key, model, url=ENDPOINT):
    source = require_phrase(text)

    def post(body):
        return _post_json(url, api_key, body)

    status, raw = complete(post, build_body(source, model))
    return read_translation(status, raw, message_content)


def _post_json(url, api_key, body):
    return post_json(
        url,
        body,
        {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "x-grok-conv-id": "west2romaji",
            "User-Agent": "west2romaji",
        },
        TIMEOUT_SECONDS,
    )


def _content_part(part):
    if isinstance(part, str):
        return part
    if isinstance(part, dict) and isinstance(part.get("text"), str):
        return part["text"]
    return ""
