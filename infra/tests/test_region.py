import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lambda" / "translate"))

from region import answering_region, attach_region


class AnsweringRegionTest(unittest.TestCase):
    def test_the_lambda_region_is_copied_onto_the_translation(self):
        environ = {"AWS_REGION": "ap-northeast-1"}
        self.assertEqual(answering_region(environ), "ap-northeast-1")
        payload = attach_region(
            {"japanese": "駅", "romaji": "Eki", "source_lang": "French"},
            environ,
        )
        self.assertEqual(payload["region"], "ap-northeast-1")
        self.assertEqual(payload["source_lang"], "French")

    def test_a_missing_region_is_an_empty_string(self):
        self.assertEqual(attach_region({"romaji": "Eki"}, {})["region"], "")


if __name__ == "__main__":
    unittest.main()
