"""The Kakitu client. Signing, idempotency keys and retries are automatic."""
from __future__ import annotations

import json
import os
import random
import time
import uuid
from typing import Any
from urllib.parse import urlencode

import httpx

from .errors import KakituConnectionError, KakituError, error_from_response
from .models import Charge, Merchant
from .signing import Signer

DEFAULT_BASE_URL = "https://walletapi.kakitu.org"
_RETRYABLE_429 = {"rate_limited"}  # other 429 codes (daily cap, payer velocity) are not transient


class Kakitu:
    """Client for the Kakitu developer API.

    ``private_key`` is your wallet's hex key; it falls back to the ``KAKITU_PRIVATE_KEY``
    environment variable. It is held only inside the signer and never logged or shown in
    ``repr``. The wallet address derived from it IS your API credential.
    """

    def __init__(self, private_key: str | None = None, base_url: str = DEFAULT_BASE_URL, *,
                 max_retries: int = 3, timeout: float = 30.0,
                 http_client: httpx.Client | None = None) -> None:
        key = private_key or os.environ.get("KAKITU_PRIVATE_KEY")
        if not key:
            raise ValueError("Pass private_key=... or set the KAKITU_PRIVATE_KEY environment variable.")
        self._signer = Signer(key)
        self._base_url = base_url.rstrip("/")
        self._max_retries = max_retries
        self._http = http_client or httpx.Client(timeout=timeout)
        self.merchants = Merchants(self)
        self.charges = Charges(self)

    @property
    def address(self) -> str:
        return self._signer.address

    def __repr__(self) -> str:
        return f"Kakitu(address={self.address!r}, base_url={self._base_url!r})"

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "Kakitu":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # -- core -------------------------------------------------------------
    def _request(self, method: str, path: str, *, params: dict[str, Any] | None = None,
                 json_body: dict[str, Any] | None = None, idempotency_key: str | None = None) -> Any:
        url = self._base_url + path
        if params:
            url += "?" + urlencode({k: v for k, v in params.items() if v is not None})
        body = b""
        headers: dict[str, str] = {"Accept": "application/json", "User-Agent": "kakitu-python/0.1.0"}
        if json_body is not None:
            # Serialise ONCE; the exact bytes are hashed and sent.
            body = json.dumps(json_body, separators=(",", ":"), ensure_ascii=False).encode()
            headers["Content-Type"] = "application/json"
        if method == "POST":
            # One key per logical request, reused across retries so a retry can never run twice.
            headers["Idempotency-Key"] = idempotency_key or str(uuid.uuid4())

        last_exc: KakituError | None = None
        for attempt in range(self._max_retries + 1):
            req = self._http.build_request(method, url, content=body or None, headers=headers)
            # Sign what is actually going on the wire (raw_path = path + "?" + query as sent).
            req.headers.update(self._signer.sign(method, req.url.raw_path.decode(), body))
            delay: float | None = None
            try:
                resp = self._http.send(req)
            except httpx.TransportError:
                last_exc = KakituConnectionError("connection_error", "Could not reach the Kakitu API.")
                delay = self._backoff(attempt)
            else:
                if resp.is_success:
                    return resp.json() if resp.content else None
                try:
                    parsed = resp.json()
                except ValueError:
                    parsed = None
                err = error_from_response(resp.status_code, parsed, resp.headers.get("X-Request-Id"))
                if self._retryable(resp.status_code, err.code):
                    last_exc = err
                    delay = self._retry_after(resp) or self._backoff(attempt)
                else:
                    raise err  # 4xx (and anything non-transient) is never retried
            if attempt == self._max_retries:
                break
            time.sleep(delay or 0)
        assert last_exc is not None
        raise last_exc

    @staticmethod
    def _retryable(status: int, code: str) -> bool:
        if status == 429:
            return code in _RETRYABLE_429
        return status >= 500

    @staticmethod
    def _backoff(attempt: int) -> float:
        return min(8.0, 0.5 * (2 ** attempt)) * (0.5 + random.random() / 2)

    @staticmethod
    def _retry_after(resp: httpx.Response) -> float | None:
        v = resp.headers.get("Retry-After")
        try:
            return min(float(v), 30.0) if v else None
        except ValueError:
            return None


class Merchants:
    def __init__(self, client: Kakitu) -> None:
        self._c = client

    def register(self, *, business_name: str, contact_email: str, contact_phone: str | None = None,
                 callback_url: str | None = None, idempotency_key: str | None = None) -> Merchant:
        """Register the wallet as a merchant (``POST /v1/merchants``). Creates a PENDING merchant;
        approval is by a Kakitu operator. Re-registering updates contact details; the business
        name is frozen after review (``MerchantNameFrozenError``). Omitted optional fields keep
        their stored value; pass ``""`` to clear one."""
        body: dict[str, Any] = {"business_name": business_name, "contact_email": contact_email}
        if contact_phone is not None:
            body["contact_phone"] = contact_phone
        if callback_url is not None:
            body["callback_url"] = callback_url
        return Merchant.from_dict(self._c._request("POST", "/v1/merchants", json_body=body,
                                                   idempotency_key=idempotency_key))

    def me(self) -> Merchant:
        """Read your merchant record (``GET /v1/merchants/me``)."""
        return Merchant.from_dict(self._c._request("GET", "/v1/merchants/me"))


class Charges:
    """NOT YET AVAILABLE. The /v1/charges endpoints are being written; calling these methods
    will fail (likely 404) until they ship. Paths and field names below are PROVISIONAL, taken
    from the server's internal charge service (amount_kes, phone, reference), not a live
    contract."""

    def __init__(self, client: Kakitu) -> None:
        self._c = client

    def create(self, *, amount_kes: int, phone: str, reference: str,
               idempotency_key: str | None = None) -> Charge:
        """NOT YET AVAILABLE. Create a charge: prompts the payer's phone via M-Pesa STK push.
        Pass the same ``idempotency_key`` when retrying after a timeout so the payer is never
        prompted twice."""
        return Charge.from_dict(self._c._request(
            "POST", "/v1/charges", json_body={"amount_kes": amount_kes, "phone": phone, "reference": reference},
            idempotency_key=idempotency_key))

    def get(self, charge_id: str) -> Charge:
        """NOT YET AVAILABLE. Fetch one charge."""
        return Charge.from_dict(self._c._request("GET", f"/v1/charges/{charge_id}"))

    def list(self, *, status: str | None = None, limit: int | None = None,
             cursor: str | None = None) -> list[Charge]:
        """NOT YET AVAILABLE. List charges. Filter names are provisional."""
        data = self._c._request("GET", "/v1/charges", params={"status": status, "limit": limit, "cursor": cursor})
        items = data.get("data", data) if isinstance(data, dict) else data
        return [Charge.from_dict(i) for i in items or []]
