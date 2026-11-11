"""Check the phone signature and remember it so it cannot be reused."""

import base64
import hashlib
import time

from errors import RequestError
from signing import MAX_SKEW_SECONDS, canonical_bytes, signature_is_valid
from store import put_unless_exists

REJECTED = "The request signature was rejected."


def require_fresh_signature(path, headers, body, public_key):
    signature = verified_signature(path, headers, body, public_key)
    remember_signature(signature)
    return signature


def verified_signature(path, headers, body, public_key):
    timestamp = read_timestamp(headers)
    signature = read_signature(headers)
    payload = canonical_bytes("POST", path, timestamp, body)
    if not signature_is_valid(public_key, payload, signature):
        raise RequestError(401, REJECTED)
    return signature


def read_timestamp(headers):
    raw = str(headers.get("x-west2romaji-timestamp") or "")
    if len(raw) != 10 or not raw.isdigit():
        raise RequestError(401, REJECTED)
    if abs(int(time.time()) - int(raw)) > MAX_SKEW_SECONDS:
        raise RequestError(401, REJECTED)
    return raw


def read_signature(headers):
    raw = str(headers.get("x-west2romaji-signature") or "")
    if not raw or len(raw) > 200:
        raise RequestError(401, REJECTED)
    try:
        return base64.b64decode(raw, validate=True)
    except Exception as error:
        raise RequestError(401, REJECTED) from error


def remember_signature(signature):
    digest = hashlib.sha256(signature).hexdigest()
    conflict = put_unless_exists(
        {
            "device_id": f"sig#{digest}",
            "expires_at": int(time.time()) + MAX_SKEW_SECONDS,
        }
    )
    if conflict is not None:
        raise RequestError(401, REJECTED) from conflict
