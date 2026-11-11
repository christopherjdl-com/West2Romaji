import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lambda" / "translate"))

from bedrock import build_body as bedrock_body
from bedrock import translate as translate_bedrock
from gemini import adjust_body, build_body, candidate_text, normalize_model
from provider import choose_route, decode_secret_string, select_provider
from errors import TranslationError
from translation import parse_translation_content


def rolls(*values):
    pending = iter(values)
    return lambda: next(pending)


class ProviderChoiceTest(unittest.TestCase):
    def test_empty_xai_key_selects_gemini(self):
        self.assertEqual(select_provider("", "gemini-key"), ("gemini", "gemini-key"))
        self.assertEqual(select_provider("null", "gemini-key")[0], "gemini")
        self.assertEqual(select_provider("undefined", ""), ("", ""))
        self.assertEqual(select_provider("xai-key", "gemini-key")[0], "xai")

    def test_the_phone_raffle_is_two_even_flips(self):
        self.assertEqual(choose_route("xai-key", "gemini-key", rolls(0.0, 0.0)), ("bedrock", "", "claude"))
        self.assertEqual(choose_route("xai-key", "gemini-key", rolls(0.49, 0.5)), ("bedrock", "", "nova"))
        self.assertEqual(choose_route("xai-key", "gemini-key", rolls(0.5, 0.0)), ("gemini", "gemini-key", "gemini"))
        self.assertEqual(choose_route("xai-key", "gemini-key", rolls(0.5, 0.49)), ("gemini", "gemini-key", "gemini"))
        self.assertEqual(choose_route("xai-key", "gemini-key", rolls(0.5, 0.5)), ("xai", "xai-key", "grok"))
        self.assertEqual(choose_route("", "gemini-key", rolls(0.5, 0.5)), ("gemini", "gemini-key", "gemini"))
        self.assertEqual(choose_route("null", "gemini-key", rolls(0.5, 0.5)), ("gemini", "gemini-key", "gemini"))
        self.assertEqual(choose_route("", "", rolls(0.5, 0.5)), ("gemini", "", "gemini"))
        self.assertEqual(choose_route("xai-key", "null", rolls(0.5, 0.0)), ("gemini", "", "gemini"))
        self.assertEqual(choose_route("", "", rolls(0.0, 0.0)), ("bedrock", "", "claude"))

    def test_bedrock_flips_only_between_claude_and_nova(self):
        seen = []

        def source():
            seen.append(len(seen))
            return 0.1

        self.assertEqual(choose_route("xai-key", "gemini-key", source), ("bedrock", "", "claude"))
        self.assertEqual(seen, [0, 1])

    def test_json_secret_and_bearer_prefix(self):
        raw = json.dumps({"api_key": "Bearer gemini-key"})
        self.assertEqual(decode_secret_string(raw), "gemini-key")
        self.assertEqual(decode_secret_string("null"), "")

    def test_gemini_body_has_no_key_and_ignores_a_grok_model_name(self):
        body = build_body("Où est la gare ?")
        self.assertNotIn("api_key", json.dumps(body))
        self.assertEqual(body["generationConfig"]["responseMimeType"], "application/json")
        self.assertEqual(body["generationConfig"]["thinkingConfig"]["thinkingLevel"], "minimal")
        self.assertEqual(normalize_model("grok-4.7"), "gemini-3.5-flash-lite")
        self.assertEqual(normalize_model("gemini-3.8-flash"), "gemini-3.5-flash-lite")

    def test_a_rejected_schema_is_removed(self):
        adjusted = adjust_body(build_body("hello"), "responseSchema is unknown")
        self.assertNotIn("responseSchema", adjusted["generationConfig"])

    def test_gemini_candidate_json_is_the_translation(self):
        payload = {
            "candidates": [
                {
                    "content": {
                        "parts": [
                            {
                                "text": json.dumps(
                                    {
                                        "japanese": "駅はどこですか",
                                        "romaji": "Eki wa doko desu ka",
                                        "source_lang": "French",
                                    }
                                )
                            }
                        ]
                    }
                }
            ]
        }
        result = parse_translation_content(candidate_text(payload))
        self.assertEqual(result["source_lang"], "French")


class BedrockClientTest(unittest.TestCase):
    def test_the_request_has_no_key_and_the_reply_is_the_translation(self):
        body = bedrock_body("hello", "amazon.nova-lite-v1:0")
        self.assertEqual(body["schemaVersion"], "messages-v1")
        claude = bedrock_body("hello", "jp.anthropic.claude-haiku-4-5-20251001-v1:0")
        self.assertEqual(claude["anthropic_version"], "bedrock-2023-05-31")
        self.assertNotIn("api_key", json.dumps(body))
        self.assertNotIn("api_key", json.dumps(claude))
        seen = []

        def invoke(model, request):
            seen.append((model, request))
            reply = {
                "output": {
                    "message": {
                        "content": [
                            {
                                "text": json.dumps(
                                    {
                                        "japanese": "駅",
                                        "romaji": "Eki",
                                        "source_lang": "English",
                                    }
                                )
                            }
                        ]
                    }
                }
            }
            return 200, json.dumps(reply)

        result = translate_bedrock("hello", "eu.amazon.nova-micro-v1:0", invoke)
        self.assertEqual(seen[0][0], "eu.amazon.nova-micro-v1:0")
        self.assertNotIn("api_key", json.dumps(seen[0][1]))
        self.assertEqual(result["romaji"], "Eki")

    def test_a_bedrock_error_is_returned_as_is(self):
        def invoke(model, request):
            return 403, "denied"

        with self.assertRaises(TranslationError) as caught:
            translate_bedrock("hello", invoke=invoke)
        self.assertEqual(caught.exception.status, 502)
        self.assertEqual(caught.exception.message, "The translation key was rejected.")


if __name__ == "__main__":
    unittest.main()
