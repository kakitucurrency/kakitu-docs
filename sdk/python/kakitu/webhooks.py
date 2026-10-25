"""Webhook signature verification.

PLANNED FORMAT, NOT YET VERIFIED AGAINST SERVER CODE: the outbound webhook sender
(``webhookout``) is not written yet. This implements the format in the developer-API plan:
the signature header value is ``t=<unix>,v1=<hex hmac-sha256 over "<t>.<raw body>">`` keyed
with the webhook secret issued at merchant approval. The header's name is not fixed yet, so
this helper takes the header *value*. Re-check against the server when it ships.
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
