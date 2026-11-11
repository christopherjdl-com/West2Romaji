import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lambda" / "translate"))

from xai import adjust_body, build_body, complete, translation_from


class XaiRequestTest(unittest.TestCase):
    def test_grok_4_7_asks_for_light_reasoning(self):
        body = build_body("Où est la gare ?", "grok-4.7")
        self.assertEqual(body["reasoning_effort"], "low")
        self.assertEqual(body["response_format"]["type"], "json_schema")
        self.assertNotIn("api_key", json.dumps(body))

    def test_a_rejected_field_is_removed_once(self):
        body = build_body("hello", "grok-4.7")
        calls = []

        def post(current):
            calls.append(current)
            if "reasoning_effort" in current:
                return 400, "reasoning_effort is not supported"
            return 200, "{}"

        status, _text = complete(post, body)
        self.assertEqual(status, 200)
        self.assertNotIn("reasoning_effort", calls[-1])

    def test_translation_json_is_read_from_the_message(self):
        payload = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "japanese": "駅はどこですか",
                                "romaji": "Eki wa doko desu ka",
                                "source_lang": "French",
                            }
                        )
                    }
                }
            ]
        }
        result = translation_from(payload)
        self.assertEqual(result["source_lang"], "French")
        self.assertEqual(result["romaji"], "Eki wa doko desu ka")

    def test_json_schema_falls_back_to_a_json_object(self):
        body = build_body("hello", "grok-4.7")
        adjusted = adjust_body(body, "response_format json_schema is unavailable")
        self.assertEqual(adjusted["response_format"], {"type": "json_object"})


if __name__ == "__main__":
    unittest.main()
