"""Request signing for the Kakitu API.

This module is the whole authentication contract, mirrored from the server's
``auth/wallet.go``. You never need to call it: :class:`kakitu.Kakitu` signs every
request for you.

Signed message (EIP-191 ``personal_sign``), exactly::

    "{METHOD} {path}{?rawquery} {timestamp} {sha256hex(body)}"

* ``path`` is the *decoded* URL path (Go's ``URL.Path``).
* ``?rawquery`` is appended only when the query is non-empty, byte-for-byte as sent.
* ``body`` is the raw bytes on the wire; empty bytes for GET/DELETE.
"""
from __future__ import annotations

import hashlib
import threading
import time
from urllib.parse import unquote

from eth_account import Account
from eth_account.messages import encode_defunct

HEADER_ADDRESS = "X-Kakitu-Address"
HEADER_TIMESTAMP = "X-Kakitu-Timestamp"
HEADER_SIGNATURE = "X-Kakitu-Signature"


def body_hash(body: bytes) -> str:
    """Lowercase hex sha256 of the raw request body."""
    return hashlib.sha256(body).hexdigest()


def signed_target(raw_path: str) -> str:
    """Turn the on-the-wire ``/path?query`` into the string the server signs.

    The path is percent-decoded (the server signs ``URL.Path``); the query is left
    exactly as sent.
    """
    path, sep, query = raw_path.partition("?")
    path = unquote(path)
    return f"{path}?{query}" if sep and query else path


def build_message(method: str, target: str, timestamp: int | str, body: bytes = b"") -> str:
    """The exact string that gets signed. ``target`` is path plus optional ``?query``."""
    return f"{method.upper()} {target} {timestamp} {body_hash(body)}"


class Signer:
    """Holds the private key and produces auth headers. The key is never exposed."""

    def __init__(self, private_key: str) -> None:
        try:
            self._account = Account.from_key(private_key)
        except Exception:
            # Deliberately do not chain or echo: the exception text could carry the key.
            raise ValueError(
                "private_key is not a valid 32-byte hex secp256k1 key"
            ) from None
        self.address: str = self._account.address
        self._lock = threading.Lock()
        self._used: set[tuple[str, str, int, str]] = set()
        self._used_second = 0

    def __repr__(self) -> str:
        return f"Signer(address={self.address!r})"

    def sign(self, method: str, raw_path: str, body: bytes = b"", timestamp: int | None = None) -> dict[str, str]:
        """Return the three X-Kakitu-* headers for this request.

        If ``timestamp`` is None, the current time is used, and the call waits for the
        next second rather than produce a request identical to one already signed in this
        second: the server rejects those as replays (a retry inside the same second would
        otherwise fail with a confusing 401).
        """
        target = signed_target(raw_path)
        bh = body_hash(body)
        if timestamp is None:
            timestamp = self._claim_timestamp(method.upper(), target, bh)
        msg = encode_defunct(text=build_message(method, target, timestamp, body))
        sig = self._account.sign_message(msg).signature.hex()
        if not sig.startswith("0x"):
            sig = "0x" + sig
        return {
            HEADER_ADDRESS: self.address,
            HEADER_TIMESTAMP: str(timestamp),
            HEADER_SIGNATURE: sig,
        }

    def _claim_timestamp(self, method: str, target: str, bh: str) -> int:
        while True:
            with self._lock:
                now = int(time.time())
                if now != self._used_second:
                    self._used.clear()
                    self._used_second = now
                k = (method, target, now, bh)
                if k not in self._used:
                    self._used.add(k)
                    return now
            time.sleep(0.05)
