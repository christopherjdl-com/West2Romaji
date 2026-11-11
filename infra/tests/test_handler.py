import base64
import json
import sys
import unittest
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lambda" / "translate"))

import app
import handler
import store
from errors import TranslationError
from signing import canonical_bytes, public_pem


PHRASE = "Where is the station?"


def key_pair():
    private = ec.generate_private_key(ec.SECP256R1())
    return private, private.public_key()


class FakeTable:
    def __init__(self, pem):
        self.items = {"primary": {"device_id": "primary", "public_key_pem": pem}}

    def get_item(self, Key):
        item = self.items.get(Key["device_id"])
        return {"Item": item} if item else {}

    def put_item(self, Item, ConditionExpression=None):
        self.items[Item["device_id"]] = Item


class FakeSecrets:
    def __init__(self, values):
        self.values = values

    def get_secret_value(self, SecretId):
        return {"SecretString": self.values.get(SecretId, "")}


class HandlerRouteTest(unittest.TestCase):
    def setUp(self):
        self.private, public = key_pair()
        store._table = FakeTable(public_pem(public))
        store._secrets = FakeSecrets({"xai-secret": "xai-secret-value", "gemini-secret": "gemini-secret-value"})
        self.calls = []
        self._bedrock = app.translate_bedrock
        self._gemini = app.translate_gemini
        self._xai = app.translate_xai
        self._random = app.random.random
        self._time = app.time.time
        app.time.time = lambda: 1_730_000_000
        app.translate_bedrock = self.record("bedrock")
        app.translate_gemini = self.record("gemini")
        app.translate_xai = self.record("xai")
        os_environ = {
            "SECRET_ID": "xai-secret",
            "GEMINI_SECRET_ID": "gemini-secret",
            "BEDROCK_CLAUDE_MODEL": "jp.anthropic.claude-haiku-4-5-20251001-v1:0",
            "BEDROCK_NOVA_MODEL": "amazon.nova-lite-v1:0",
            "XAI_MODEL": "grok-4.7",
            "GEMINI_MODEL": "gemini-3.5-flash-lite",
            "TABLE_NAME": "west2romaji-devices",
        }
        self._saved = {key: app.os.environ.get(key) for key in os_environ}
        app.os.environ.update(os_environ)

    def tearDown(self):
        store._table = None
        store._secrets = None
        app.translate_bedrock = self._bedrock
        app.translate_gemini = self._gemini
        app.translate_xai = self._xai
        app.random.random = self._random
        app.time.time = self._time
        for key, value in self._saved.items():
            if value is None:
                app.os.environ.pop(key, None)
            else:
                app.os.environ[key] = value

    def record(self, name):
        def client(*args):
            self.calls.append((name, args))
            if name == "bedrock" and getattr(self, "bedrock_error", None):
                raise self.bedrock_error
            if name == "gemini" and getattr(self, "gemini_error", None):
                raise self.gemini_error
            return {"japanese": "駅", "romaji": "Eki", "source_lang": "English"}

        return client

    def event(self):
        body = json.dumps({"text": PHRASE}).encode()
        payload = canonical_bytes("POST", "/translate", "1730000000", body)
        signature = base64.b64encode(self.private.sign(payload, ec.ECDSA(hashes.SHA256()))).decode()
        return {
            "requestContext": {"http": {"method": "POST"}},
            "rawPath": "/translate",
            "isBase64Encoded": False,
            "body": body.decode(),
            "headers": {
                "x-west2romaji-timestamp": "1730000000",
                "x-west2romaji-signature": signature,
            },
        }

    def translate(self, *rolls):
        pending = iter(rolls)
        app.random.random = lambda: next(pending)
        with self.assertLogs(app.logger, level="INFO") as logs:
            response = handler.lambda_handler(self.event(), None)
        self.logged = "\n".join(logs.output)
        return response

    def test_bedrock_is_the_only_client_called(self):
        response = self.translate(0.1, 0.1)
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual([name for name, _args in self.calls], ["bedrock"])
        _name, args = self.calls[0]
        self.assertEqual(args, (PHRASE, "jp.anthropic.claude-haiku-4-5-20251001-v1:0"))
        self.assertEqual(json.loads(response["body"])["model"], "claude")
        self.calls.clear()
        nova = self.translate(0.1, 0.8)
        self.assertEqual(json.loads(nova["body"])["model"], "nova")
        self.assertEqual(self.calls[-1][1], (PHRASE, "amazon.nova-lite-v1:0"))
        self.assertNotIn("xai-secret-value", self.logged)
        self.assertNotIn("gemini-secret-value", self.logged)
        self.assertNotIn(PHRASE, self.logged)

    def test_a_direct_call_uses_only_the_chosen_client(self):
        self.translate(0.9, 0.1)
        self.assertEqual([name for name, _args in self.calls], ["gemini"])
        self.assertEqual(self.calls[0][1][1], "gemini-secret-value")
        self.translate(0.9, 0.9)
        self.assertEqual([name for name, _args in self.calls], ["gemini", "xai"])
        self.assertEqual(self.calls[-1][1][1], "xai-secret-value")
        self.assertNotIn("xai-secret-value", self.logged)
        self.assertNotIn("gemini-secret-value", self.logged)
        self.assertNotIn(PHRASE, self.logged)

    def test_an_empty_grok_key_uses_gemini(self):
        store._secrets = FakeSecrets({"xai-secret": "null", "gemini-secret": "gemini-secret-value"})
        response = self.translate(0.9, 0.9)
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual(json.loads(response["body"])["model"], "gemini")
        self.assertEqual([name for name, _args in self.calls], ["gemini"])
        self.assertEqual(self.calls[0][1][1], "gemini-secret-value")

    def test_a_failed_gemini_call_uses_the_bedrock_raffle(self):
        self.gemini_error = TranslationError(502, "The translation service did not answer.")
        response = self.translate(0.9, 0.1, 0.1)
        self.assertEqual(response["statusCode"], 200)
        self.assertEqual([name for name, _args in self.calls], ["gemini", "bedrock"])
        self.assertEqual(self.calls[-1][1], (PHRASE, "jp.anthropic.claude-haiku-4-5-20251001-v1:0"))
        self.assertEqual(json.loads(response["body"])["model"], "claude")
        self.calls.clear()
        nova = self.translate(0.9, 0.2, 0.8)
        self.assertEqual(json.loads(nova["body"])["model"], "nova")
        self.assertEqual(self.calls[-1][1], (PHRASE, "amazon.nova-lite-v1:0"))

    def test_a_missing_gemini_key_is_not_rerolled(self):
        store._secrets = FakeSecrets({"xai-secret": "", "gemini-secret": ""})
        response = self.translate(0.9, 0.9)
        self.assertEqual(response["statusCode"], 500)
        self.assertEqual(json.loads(response["body"])["error"], "The translation key is not set.")
        self.assertEqual(self.calls, [])

    def test_a_bedrock_error_is_not_rerolled(self):
        self.bedrock_error = TranslationError(502, "The translation service did not answer.")
        response = self.translate(0.2, 0.2)
        self.assertEqual(response["statusCode"], 502)
        self.assertEqual(json.loads(response["body"])["error"], "The translation service did not answer.")
        self.assertEqual([name for name, _args in self.calls], ["bedrock"])


if __name__ == "__main__":
    unittest.main()
