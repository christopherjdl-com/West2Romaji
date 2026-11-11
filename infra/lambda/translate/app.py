"""Enrollment and translation.

The first signed public key is stored. Enrollment then closes.
Later requests must be signed by that key. A signature can be used once.
"""

import logging
import os
import random
import time

from auth import require_fresh_signature
from bedrock import translate as translate_bedrock
from errors import RequestError, TranslationError
from gateway import headers_of, parse_object, raw_body, respond
from gemini import translate as translate_gemini
from provider import choose_bedrock, choose_route, decode_secret_string
from region import attach_region
from signing import load_p256_public_key, public_pem, same_key
from store import PRIMARY, enrolled_key, put_unless_exists, secret_string
from xai import ENDPOINT, translate as translate_xai

logger = logging.getLogger()
logger.setLevel(logging.INFO)

ROUTES = ("/enroll", "/translate")


def handle(event):
    try:
        return route(event or {})
    except RequestError as error:
        logger.info("rejected status=%s", error.status)
        return respond(error.status, {"error": error.message})
    except TranslationError as error:
        logger.info("xai status=%s", error.status)
        return respond(error.status, {"error": error.message})
    except Exception:
        logger.exception("translate failed")
        return respond(500, {"error": "The translation could not be completed."})


def route(event):
    method = event.get("requestContext", {}).get("http", {}).get("method", "")
    path = event.get("rawPath") or ""
    if method != "POST" or path not in ROUTES:
        raise RequestError(404, "That route does not exist.")
    body = raw_body(event)
    headers = headers_of(event)
    if path == "/enroll":
        return enroll(body, headers)
    return translate_request(body, headers)


def enroll(body, headers):
    payload = parse_object(body)
    public_key = _public_key(payload.get("public_key"))
    require_fresh_signature("/enroll", headers, body, public_key)
    conflict = put_unless_exists(
        {
            "device_id": PRIMARY,
            "public_key_pem": public_pem(public_key),
            "enrolled_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    )
    if conflict is None:
        return respond(201, {"enrolled": True})
    current = enrolled_key()
    if current is None or not same_key(current, public_key):
        raise RequestError(409, "Enrollment is closed.") from conflict
    return respond(200, {"enrolled": True})


def translate_request(body, headers):
    public_key = enrolled_key()
    if public_key is None:
        raise RequestError(401, "This phone is not enrolled.")
    require_fresh_signature("/translate", headers, body, public_key)
    payload = parse_object(body)
    provider, key, model = choose_route(
        decode_secret_string(secret_string(os.environ.get("SECRET_ID"))),
        decode_secret_string(secret_string(os.environ.get("GEMINI_SECRET_ID"))),
        random.random,
    )
    logger.info("provider=%s model=%s", provider, model)
    text = payload.get("text")
    try:
        result = invoke_provider(provider, key, model, text)
    except TranslationError:
        if provider != "gemini":
            raise
        logger.info("gemini failed, using bedrock")
        _provider, _key, model = choose_bedrock(random.random)
        logger.info("provider=%s model=%s", "bedrock", model)
        result = invoke_provider("bedrock", "", model, text)
    return respond(200, attach_region(result))


def invoke_provider(provider, key, model, text):
    if provider == "bedrock":
        result = translate_bedrock(text, _bedrock_model_id(model))
        result["model"] = model
        return result
    if provider == "gemini":
        return _direct(translate_gemini, text, key, os.environ.get("GEMINI_MODEL"), "gemini")
    if provider == "xai":
        return _direct(
            translate_xai,
            text,
            key,
            os.environ.get("XAI_MODEL"),
            "grok",
            os.environ.get("XAI_URL") or ENDPOINT,
        )
    raise RequestError(500, "The translation key is not set.")


def _public_key(pem):
    try:
        return load_p256_public_key(pem)
    except ValueError as error:
        raise RequestError(400, "The public key must be a P-256 PEM.") from error


def _bedrock_model_id(model):
    name = "BEDROCK_CLAUDE_MODEL" if model == "claude" else "BEDROCK_NOVA_MODEL"
    return os.environ.get(name)


def _direct(call, text, key, model, label, *extra):
    if not key:
        raise RequestError(500, "The translation key is not set.")
    result = call(text, key, model, *extra)
    result["model"] = label
    return result
