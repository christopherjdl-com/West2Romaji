"""Pick a model provider.

select_provider is the local debug rule: a usable xAI key wins, otherwise Gemini.
choose_route is the phone path. The first flip chooses a direct HTTP call or
Bedrock. A direct call flips again, between Gemini and xAI. Bedrock flips
again, between Claude Haiku and Nova Lite. When xAI wins and its key is
empty, the route is Gemini. A missing Gemini key stays empty so the caller
can fail without another flip. A Gemini call that fails is retried on
Bedrock, which flips again between Claude and Nova.
"""

import json


def usable_key(value):
    text = str(value or "").strip()
    if text.lower().startswith("bearer "):
        text = text[7:].strip()
    if not text or text.lower() in ("null", "undefined"):
        return ""
    return text


def decode_secret_string(text):
    raw = str(text or "").strip()
    if raw.startswith("{"):
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return ""
        if not isinstance(data, dict):
            return ""
        raw = str(data.get("api_key") or data.get("key") or "")
    return usable_key(raw)


def select_provider(xai_key, gemini_key):
    xai = usable_key(xai_key)
    if xai:
        return "xai", xai
    gemini = usable_key(gemini_key)
    if gemini:
        return "gemini", gemini
    return "", ""


def choose_bedrock(random_source):
    model = "claude" if random_source() < 0.5 else "nova"
    return "bedrock", "", model


def choose_route(xai_key, gemini_key, random_source):
    if random_source() < 0.5:
        return choose_bedrock(random_source)
    gemini = usable_key(gemini_key)
    if random_source() < 0.5:
        return "gemini", gemini, "gemini"
    xai = usable_key(xai_key)
    if not xai:
        return "gemini", gemini, "gemini"
    return "xai", xai, "grok"
