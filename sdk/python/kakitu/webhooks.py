"""Webhook signature verification.

The scheme is the server's own (``webhookout/signer.go``): header ``Kakitu-Signature`` carries
``t=<unix>,v1=<hex hmac-sha256 over "<t>.<raw body>">``, keyed with the webhook secret issued at
merchant approval. This helper takes the header *value*.

The timestamp is INSIDE the signed string, not merely alongside it, so a replayer cannot shift
the clock without breaking the signature.

Pass the RAW body bytes. Re-marshalling the JSON first reorders keys and changes whitespace, and
you would then verify a different string than the one that was signed.

Delivery is AT-LEAST-ONCE: the ``Kakitu-Event-Id`` header (and ``id`` in the payload) is stable
across every attempt and across a replay, and it is your dedupe key.
"""
from __future__ import annotations

import hashlib
import hmac
import time


class WebhookVerificationError(Exception):
    """The webhook failed verification. Reject the request (HTTP 400)."""


def compute_signature(secret: str, timestamp: int, payload: bytes) -> str:
    mac = hmac.new(secret.encode(), f"{timestamp}.".encode() + payload, hashlib.sha256)
    return f"t={timestamp},v1={mac.hexdigest()}"


def verify_webhook(payload: bytes, signature_header: str, secret: str, tolerance: int = 300,
                   now: float | None = None) -> bool:
    """Return True if valid; raise :class:`WebhookVerificationError` otherwise.

    ``payload`` must be the raw request body bytes, before any JSON parsing.
    """
    if isinstance(payload, str):
        raise TypeError("payload must be the raw bytes of the request body")
    parts = dict(p.split("=", 1) for p in signature_header.split(",") if "=" in p)
    try:
        t = int(parts["t"])
        given = parts["v1"]
    except (KeyError, ValueError):
        raise WebhookVerificationError("malformed signature header") from None
    want = compute_signature(secret, t, payload).split("v1=", 1)[1]
    if not hmac.compare_digest(want, given):
        raise WebhookVerificationError("signature mismatch")
    if abs((time.time() if now is None else now) - t) > tolerance:
        raise WebhookVerificationError("timestamp outside tolerance (possible replay)")
    return True
