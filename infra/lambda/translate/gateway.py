"""API Gateway request bytes and the JSON response."""

import base64
import json

from errors import RequestError

MAX_BODY_BYTES = 8192
UNREADABLE = "The request body could not be read."
NOT_JSON = "The request body must be JSON."


def respond(status, payload):
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(payload),
    }


def raw_body(event):
    body = event.get("body") or ""
    if event.get("isBase64Encoded"):
        return _decode_body(body)
    if isinstance(body, str):
        return body.encode("utf-8")
    raise RequestError(400, UNREADABLE)


def headers_of(event):
    return {str(key).lower(): value for key, value in (event.get("headers") or {}).items()}


def parse_object(body):
    if len(body) > MAX_BODY_BYTES:
        raise RequestError(400, "The request body is too large.")
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RequestError(400, NOT_JSON) from error
    if not isinstance(payload, dict):
        raise RequestError(400, NOT_JSON)
    return payload


def _decode_body(body):
    try:
        return base64.b64decode(body, validate=True)
    except Exception as error:
        raise RequestError(400, UNREADABLE) from error
