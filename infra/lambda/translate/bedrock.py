"""Call Amazon Bedrock with the Lambda role. There is no API key."""

import json
import re

from translation import SYSTEM_PROMPT, public_failure, read_translation, require_phrase, user_prompt

NOVA_MODEL = "amazon.nova-lite-v1:0"
CLAUDE_MODEL = "jp.anthropic.claude-haiku-4-5-20251001-v1:0"


def is_claude(model):
    name = str(model or "")
    return "anthropic" in name or "claude" in name


def normalize_model(value):
    model = str(value or "").strip()
    if re.fullmatch(r"[A-Za-z0-9.:-]{1,128}", model):
        return model
    return CLAUDE_MODEL if is_claude(model) else NOVA_MODEL


def build_body(text, model=NOVA_MODEL):
    prompt = user_prompt(text)
    if is_claude(model):
        return {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 700,
            "temperature": 0,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": prompt}],
        }
    return {
        "schemaVersion": "messages-v1",
        "system": [{"text": SYSTEM_PROMPT}],
        "messages": [{"role": "user", "content": [{"text": prompt}]}],
        "inferenceConfig": {"maxTokens": 700, "temperature": 0},
    }


def message_text(payload):
    if not isinstance(payload, dict):
        return ""
    output = payload.get("output")
    message = output.get("message") if isinstance(output, dict) else None
    content = message.get("content") if isinstance(message, dict) else payload.get("content")
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ""
    return "".join(
        part["text"]
        for part in content
        if isinstance(part, dict) and isinstance(part.get("text"), str)
    )


def translate(text, model=None, invoke=None):
    source = require_phrase(text)
    caller = invoke or _invoke
    model_id = normalize_model(model)
    status, raw = caller(model_id, build_body(source, model_id))
    return read_translation(status, raw, message_text)


def _invoke(model_id, body):
    import boto3
    from botocore.exceptions import ClientError

    client = boto3.client("bedrock-runtime")
    try:
        response = client.invoke_model(
            modelId=model_id,
            body=json.dumps(body).encode("utf-8"),
            contentType="application/json",
            accept="application/json",
        )
    except ClientError as error:
        status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 502)
        raise public_failure(status) from error
    raw = response["body"].read()
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", "replace")
    return 200, raw
