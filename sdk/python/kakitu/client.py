"""The Kakitu client. Signing, idempotency keys and retries are automatic."""
from __future__ import annotations

import json
import os
import random
import time
import uuid
from typing import Any, Iterator
from urllib.parse import quote, urlencode

import httpx

from .errors import KakituConnectionError, KakituError, error_from_response
from .models import (
    Balances, Charge, Event, Limits, Merchant, Order, Payout, PayoutQuote, Quote, Transfer,
)
from .pagination import Page, auto_paginate
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
        self.transfers = Transfers(self)
        self.balances = BalancesResource(self)
        self.orders = Orders(self)
        self.limits = LimitsResource(self)
        self.quotes = Quotes(self)
        self.events = Events(self)
        self.payouts = Payouts(self)

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
                 json_body: dict[str, Any] | None = None, idempotency_key: str | None = None,
                 idempotent: bool = False) -> Any:
        """Sends one signed request.

        ``idempotent=True`` marks a route the server REQUIRES an ``Idempotency-Key`` on
        (``/v1/charges``, ``/v1/transfers``, ``/v1/payouts``); one is generated when the caller
        does not supply their own. It is deliberately NOT keyed off ``method == "POST"``:
        ``/v1/quotes``, ``/v1/payouts/quote`` and ``/v1/events/{id}/replay`` are POSTs that mount
        no idempotency at all, and ``/v1/merchants`` is an upsert. Sending a key everywhere would
        be this SDK pretending a contract is uniform when it is not.

        A caller's explicit ``idempotency_key`` is always honoured, on any route.
        """
        url = self._base_url + path
        if params:
            url += "?" + urlencode({k: v for k, v in params.items() if v is not None})
        body = b""
        headers: dict[str, str] = {"Accept": "application/json", "User-Agent": "kakitu-python/0.1.0"}
        if json_body is not None:
            # Serialise ONCE; the exact bytes are hashed and sent.
            body = json.dumps(json_body, separators=(",", ":"), ensure_ascii=False).encode()
            headers["Content-Type"] = "application/json"
        if idempotency_key is not None:
            headers["Idempotency-Key"] = idempotency_key
        elif idempotent:
            # One key per logical request, reused across retries so a retry can never run twice.
            headers["Idempotency-Key"] = str(uuid.uuid4())

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
    """Charges: an M-Pesa prompt on a payer's phone, settled to your wallet."""

    def __init__(self, client: Kakitu) -> None:
        self._c = client

    def create(self, *, amount: int, phone: str, reference: str,
               idempotency_key: str | None = None) -> Charge:
        """Create a charge (``POST /v1/charges``): prompts the payer's phone via M-Pesa.

        ``amount`` is whole KES. ``reference`` is your own id, unique per merchant — reusing one
        raises ``ReferenceReusedError``.

        An ``Idempotency-Key`` is REQUIRED here and one is generated for you, then reused across
        every automatic retry. It lives only in memory, so pass your own (derived from your order
        id and stored) if you want a retry after a crash or restart to be safe too.
        """
        return Charge.from_dict(self._c._request(
            "POST", "/v1/charges", json_body={"amount": amount, "phone": phone, "reference": reference},
            idempotency_key=idempotency_key, idempotent=True))

    def get(self, charge_id: str) -> Charge:
        """Fetch one charge (``GET /v1/charges/{id}``)."""
        return Charge.from_dict(self._c._request("GET", f"/v1/charges/{quote(str(charge_id), safe='')}"))

    def list(self, *, status: str | None = None, reference: str | None = None,
             created_after: str | None = None, limit: int | None = None,
             cursor: str | None = None) -> Page:
        """One page of charges (``GET /v1/charges``), newest first.

        Returns a :class:`~kakitu.pagination.Page`, which is a list of :class:`Charge` carrying
        ``next_cursor``. Use :meth:`auto_paging_iter` to walk every page.
        """
        return Page.from_response(self._c._request(
            "GET", "/v1/charges",
            params={"status": status, "reference": reference, "created_after": created_after,
                    "limit": limit, "cursor": cursor}), Charge.from_dict)

    def auto_paging_iter(self, **filters: Any) -> Iterator[Charge]:
        """Walks every page, yielding charges. See :func:`kakitu.pagination.auto_paginate`."""
        filters.pop("cursor", None)
        return auto_paginate(lambda c: self.list(cursor=c, **filters))


class Transfers:
    """Gasless KSHS transfers (``POST /v1/transfers``)."""

    def __init__(self, client: Kakitu) -> None:
        self._c = client

    def create(self, *, from_address: str, to: str, value_wei: str, deadline: int,
               v: int, r: str, s: str, iv: int, ir: str, is_: str,
               idempotency_key: str | None = None) -> Transfer:
        """Relay a transfer YOU have already signed.

        **THIS SDK DOES NOT SIGN THE TRANSFER, AND CANNOT.** Two signatures you produce with
        your own wallet key are required, and you pass both in:

        * ``v`` / ``r`` / ``s`` — an **EIP-2612 permit**, signed under the **token's** EIP-712
          domain.
        * ``iv`` / ``ir`` / ``is_`` — an **EIP-712 Relay(owner,to,value,deadline,nonce) intent**,
          signed under the **forwarder's** domain.

        Kakitu holds no keys, signs nothing on your behalf and never decides who pays whom; it
        only pays the gas. The ``X-Kakitu-Signature`` this SDK adds to every request
        authenticates you to the API and authorises nothing on chain — the two are unrelated.

        ``from_address`` must be your own wallet: the server refuses a transfer whose ``from`` is
        not the authenticated caller. ``value_wei`` is a STRING and must stay one; through a
        float it is a different number and the signature will not verify. ``is_`` is spelled with
        a trailing underscore because ``is`` is a Python keyword; it goes on the wire as ``is``.

        An ``Idempotency-Key`` is REQUIRED and one is generated unless you pass your own.
        """
        body = {"from": from_address, "to": to, "value_wei": str(value_wei), "deadline": int(deadline),
                "v": int(v), "r": r, "s": s, "iv": int(iv), "ir": ir, "is": is_}
        return Transfer.from_dict(self._c._request("POST", "/v1/transfers", json_body=body,
                                                   idempotency_key=idempotency_key, idempotent=True))


class BalancesResource:
    """Your own KSHS and USDC balances on Base."""

    def __init__(self, client: Kakitu) -> None:
        self._c = client

    def retrieve(self) -> Balances:
        """``GET /v1/balances``. An address with no history holds zero; that is an answer, not
        an error."""
        return Balances.from_dict(self._c._request("GET", "/v1/balances"))


class Orders:
    """Your own ramp orders (deposits and withdrawals)."""

    def __init__(self, client: Kakitu) -> None:
        self._c = client

    def get(self, order_id: str) -> Order:
        """``GET /v1/orders/{id}``. An order that is not yours answers exactly as one that does
        not exist (``OrderNotFoundError``): the API never confirms somebody else's id."""
        return Order.from_dict(self._c._request("GET", f"/v1/orders/{quote(str(order_id), safe='')}"))


class LimitsResource:
    """The withdrawal band, and — for a merchant — your own payout limits."""

    def __init__(self, client: Kakitu) -> None:
        self._c = client

    def retrieve(self) -> Limits:
        """``GET /v1/limits``.

        ``.payout`` is present only for a registered merchant and carries ``max_kes``,
        ``daily_cap_kes`` and ``hold_above_kes`` — read it before asking somebody to sign, rather
        than learning the numbers by being refused.
        """
        return Limits.from_dict(self._c._request("GET", "/v1/limits"))


class Quotes:
    """Prices for deposits and withdrawals (``POST /v1/quotes``)."""

    def __init__(self, client: Kakitu) -> None:
        self._c = client

    def create(self, *, type: str, amount_kes: int, phone: str | None = None,
               beneficiary: dict[str, Any] | None = None) -> Quote:
        """Ask what something would cost. ``type`` is ``"deposit"`` or ``"withdrawal"``.

        A deposit quote takes ``phone``; a withdrawal quote REQUIRES ``beneficiary``
        (``{"channel": ..., "number": ..., "reference": ...}``).

        **NO Idempotency-Key is sent**, and the server mounts none on this route: a quote creates
        no order, no charge and no transfer, so it is not a write. This is also NOT a payout
        quote — ``client.payouts.quote`` mints the single-use id ``payouts.create`` requires, and
        an id from here is refused there.
        """
        body: dict[str, Any] = {"type": type, "amount_kes": amount_kes}
        if phone is not None:
            body["phone"] = phone
        if beneficiary is not None:
            body["beneficiary"] = beneficiary
        return Quote.from_dict(self._c._request("POST", "/v1/quotes", json_body=body))


class Events:
    """Webhook deliveries: what we sent, where it stands, and a way to ask for it again."""

    def __init__(self, client: Kakitu) -> None:
        self._c = client

    def list(self, *, type: str | None = None, status: str | None = None,
             charge_id: str | None = None, limit: int | None = None,
             cursor: str | None = None) -> Page:
        """One page of your webhook events (``GET /v1/events``), newest first.

        ``type`` is one of :data:`~kakitu.models.EVENT_TYPES` and ``status`` one of
        :data:`~kakitu.models.EVENT_STATUSES`. A value outside those sets is refused with
        ``invalid_request`` rather than quietly matching nothing.

        Returns a :class:`~kakitu.pagination.Page` of :class:`Event`.
        """
        return Page.from_response(self._c._request(
            "GET", "/v1/events",
            params={"type": type, "status": status, "charge_id": charge_id,
                    "limit": limit, "cursor": cursor}), Event.from_dict)

    def auto_paging_iter(self, **filters: Any) -> Iterator[Event]:
        """Walks every page, yielding events."""
        filters.pop("cursor", None)
        return auto_paginate(lambda c: self.list(cursor=c, **filters))

    def replay(self, event_id: str) -> Event:
        """Put one event back in the delivery queue with a fresh 24h budget
        (``POST /v1/events/{id}/replay``).

        Works whatever state it was in — abandoned after a day of failures, or delivered and
        simply lost on your side.

        **NO Idempotency-Key is sent**: replay is idempotent by construction, since requeuing an
        already-requeued event sets the same row to the same state, and the server mounts no
        idempotency on this route.

        It answers HTTP **202**: nothing has been delivered when this returns, and the returned
        event is the queued state, not a delivery receipt. The event **id does not change**, so a
        receiver that dedupes on it can tell this is one it may already have seen.
        """
        return Event.from_dict(self._c._request(
            "POST", f"/v1/events/{quote(str(event_id), safe='')}/replay"))


class Payouts:
    """Merchant payouts: sending KES to somebody else.

    Two steps, and they are not interchangeable: :meth:`quote` mints a SINGLE-USE quote id and
    tells you exactly what to sign, :meth:`create` spends it.
    """

    def __init__(self, client: Kakitu) -> None:
        self._c = client

    def quote(self, *, amount_kes: int, beneficiary_phone: str, beneficiary_name: str) -> PayoutQuote:
        """Price a payout and get what to sign (``POST /v1/payouts/quote``).

        ``amount_kes`` is what LANDS on the beneficiary, not what leaves your wallet (that is
        ``send_kes``). ``beneficiary_phone`` is a Kenyan mobile as ``2547xxxxxxxx`` and
        ``beneficiary_name`` is the person being PAID — it is what their M-Pesa statement shows,
        and it is never filled in from your own profile.

        **NO Idempotency-Key is sent**: a quote creates no payout and moves no money, and the
        server mounts no idempotency on this route.

        The returned quote carries ``value_wei``, ``treasury_address``, ``deadline`` and BOTH
        EIP-712 domains to sign under. Your daily payout cap is checked HERE, at quote time, so
        you learn you are over budget before signing anything.
        """
        return PayoutQuote.from_dict(self._c._request(
            "POST", "/v1/payouts/quote",
            json_body={"amount_kes": amount_kes,
                       "beneficiary": {"phone": beneficiary_phone, "name": beneficiary_name}}))

    def create(self, *, quote_id: str, from_address: str, to: str, value_wei: str, deadline: int,
               v: int, r: str, s: str, iv: int, ir: str, is_: str,
               idempotency_key: str | None = None) -> Payout:
        """Confirm a payout with the quote you signed (``POST /v1/payouts``).

        **THIS SDK DOES NOT SIGN THE PAYOUT, AND CANNOT.** As with
        :meth:`Transfers.create`, ``v``/``r``/``s`` is an **EIP-2612 permit** signed under the
        token's domain (``quote.permit_domain``) and ``iv``/``ir``/``is_`` an **EIP-712 Relay
        intent** signed under the forwarder's (``quote.relay_domain``). You produce both with
        your own wallet key; Kakitu holds no keys. Signing the permit under the wrong domain
        produces a signature the chain rejects with nothing to read.

        Everything the quote fixed is enforced: ``from_address`` must be your own wallet, ``to``
        the quote's ``treasury_address``, ``value_wei`` the quote's exactly, and ``deadline`` in
        the future and no later than the quote's.

        An ``Idempotency-Key`` is REQUIRED and one is generated unless you pass your own.

        A payout over your ``hold_above_kes`` comes back **held** and has NOT been sent: a person
        will release or cancel it. That is a normal outcome, not an error — poll :meth:`get`.
        """
        body = {
            "quote_id": quote_id,
            "transfer": {"from": from_address, "to": to, "value_wei": str(value_wei),
                         "deadline": int(deadline), "v": int(v), "r": r, "s": s,
                         "iv": int(iv), "ir": ir, "is": is_},
        }
        return Payout.from_dict(self._c._request("POST", "/v1/payouts", json_body=body,
                                                 idempotency_key=idempotency_key, idempotent=True))

    def get(self, payout_id: str) -> Payout:
        """``GET /v1/payouts/{id}``. A payout that is not yours answers exactly as one that does
        not exist (``PayoutNotFoundError``)."""
        return Payout.from_dict(self._c._request("GET", f"/v1/payouts/{quote(str(payout_id), safe='')}"))

    def list(self, *, status: str | None = None, created_after: str | None = None,
             limit: int | None = None, cursor: str | None = None) -> Page:
        """One page of your payouts (``GET /v1/payouts``), newest first.

        ``status`` is one of :data:`~kakitu.models.PAYOUT_STATES`; anything else is refused with
        ``invalid_request`` rather than returning an empty page, which for a typo would be a lie
        about somebody's money. ``created_after`` is RFC 3339.
        """
        return Page.from_response(self._c._request(
            "GET", "/v1/payouts",
            params={"status": status, "created_after": created_after,
                    "limit": limit, "cursor": cursor}), Payout.from_dict)

    def auto_paging_iter(self, **filters: Any) -> Iterator[Payout]:
        """Walks every page, yielding payouts."""
        filters.pop("cursor", None)
        return auto_paginate(lambda c: self.list(cursor=c, **filters))
