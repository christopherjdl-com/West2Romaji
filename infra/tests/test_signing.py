import base64
import sys
import unittest
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lambda" / "translate"))

from signing import canonical_bytes, load_p256_public_key, public_pem, same_key, signature_is_valid


def key_pair():
    private = ec.generate_private_key(ec.SECP256R1())
    return private, private.public_key()


class SigningTest(unittest.TestCase):
    def test_canonical_bytes_are_stable(self):
        body = b'{"text":"O\xc3\xb9 est la gare ?"}'
        signed = canonical_bytes("post", "/translate", "1730000000", body)
        self.assertEqual(
            signed,
            b"v1\nPOST\n/translate\n1730000000\n"
            + __import__("hashlib").sha256(body).hexdigest().encode(),
        )

    def test_the_matching_key_verifies(self):
        private, public = key_pair()
        payload = canonical_bytes("POST", "/enroll", "1730000000", b"{}")
        signature = private.sign(payload, ec.ECDSA(hashes.SHA256()))
        restored = load_p256_public_key(public_pem(public))
        self.assertTrue(same_key(public, restored))
        self.assertTrue(signature_is_valid(restored, payload, signature))
        self.assertFalse(signature_is_valid(restored, payload + b" ", signature))

    def test_a_different_key_is_rejected(self):
        private, _public = key_pair()
        _other, stranger = key_pair()
        payload = canonical_bytes("POST", "/translate", "1730000000", b"{}")
        signature = base64.b64decode(base64.b64encode(private.sign(payload, ec.ECDSA(hashes.SHA256()))))
        self.assertFalse(signature_is_valid(stranger, payload, signature))
        r, s = decode_dss_signature(private.sign(payload, ec.ECDSA(hashes.SHA256())))
        raw = r.to_bytes(32, "big") + s.to_bytes(32, "big")
        self.assertEqual(len(raw), 64)
        self.assertTrue(signature_is_valid(_public, payload, raw))

    def test_private_keys_and_other_curves_are_rejected(self):
        private, public = key_pair()
        private_pem = private.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode()
        with self.assertRaises(ValueError):
            load_p256_public_key(private_pem)
        p384 = ec.generate_private_key(ec.SECP384R1()).public_key()
        pem = public_pem(p384)
        with self.assertRaises(ValueError):
            load_p256_public_key(pem)
        self.assertIn("BEGIN PUBLIC KEY", public_pem(public))


if __name__ == "__main__":
    unittest.main()
