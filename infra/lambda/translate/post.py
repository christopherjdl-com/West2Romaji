"""JSON POST for the direct model providers."""

import json
import urllib.error
import urllib.request

from errors import TranslationError

READ_LIMIT = 1_000_000


def post_json(url, body, headers, timeout):
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers=headers,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, _text(response)
    except urllib.error.HTTPError as error:
        return error.code, _text(error)
    except TimeoutError as error:
        raise TranslationError(504, "The translation took too long.") from error
    except urllib.error.URLError as error:
        raise TranslationError(502, "The translation service did not answer.") from error


def _text(response):
    return response.read(READ_LIMIT).decode("utf-8", "replace")
