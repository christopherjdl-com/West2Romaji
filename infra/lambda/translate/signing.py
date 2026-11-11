"""Request signature for the phone that enrolled.

The phone signs the exact bytes below with ECDSA P-256 and SHA-256.
WebCrypto sends the raw 64-byte P1363 signature. DER is accepted too.
Both are standard base64. The private key stays on the phone.

    v1
    POST
    /translate
    1730000000
    <hex sha256 of the raw body>
"""

import hashlib

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

MAX_SKEW_SECONDS = 300


def canonical_bytes(method, path, timestamp, body):
    digest = hashlib.sha256(body).hexdigest()
    text = f"v1\n{method.upper()}\n{path}\n{timestamp}\n{digest}"
    return text.encode("utf-8")


def load_p256_public_key(pem):
    if not isinstance(pem, str) or len(pem) > 1024 or "BEGIN PUBLIC KEY" not in pem:
        raise ValueError("The public key must be a P-256 PEM.")
    key = serialization.load_pem_public_key(pem.encode("utf-8"))
    if not isinstance(key, ec.EllipticCurvePublicKey) or key.curve.name != "secp256r1":
        raise ValueError("The public key must be a P-256 PEM.")
    return key


def public_pem(key):
    raw = key.public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return raw.decode("utf-8")


def same_key(left, right):
    return left.public_numbers() == right.public_numbers()


def der_signature(signature):
    if len(signature) != 64:
        return signature
    r = int.from_bytes(signature[:32], "big")
    s = int.from_bytes(signature[32:], "big")
    return encode_dss_signature(r, s)


def signature_is_valid(public_key, payload, signature):
    candidates = [signature]
    if len(signature) == 64:
        candidates.append(der_signature(signature))
    for candidate in candidates:
        try:
            public_key.verify(candidate, payload, ec.ECDSA(hashes.SHA256()))
        except (InvalidSignature, ValueError):
            continue
        return True
    return False
