import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "lambda" / "translate"


class LambdaPackageTest(unittest.TestCase):
    def test_every_local_module_is_copied_into_the_zip(self):
        script = (ROOT / "build.sh").read_text()
        missing = [path.name for path in ROOT.glob("*.py") if path.name not in script]
        self.assertEqual(missing, [])
