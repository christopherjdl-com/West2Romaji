"""The region that answered, taken from the Lambda environment."""

import os


def answering_region(environ=None):
    source = os.environ if environ is None else environ
    return str(source.get("AWS_REGION") or "")


def attach_region(result, environ=None):
    payload = dict(result)
    payload["region"] = answering_region(environ)
    return payload
