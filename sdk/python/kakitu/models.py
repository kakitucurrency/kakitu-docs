"""The wire shapes of the Kakitu developer API, taken field by field from the server's own view
structs (``controller/v1_*.go``).

Every model keeps the full decoded JSON in ``raw``, so a field the server adds is reachable
before this SDK names it.

Amounts in KES are whole shillings and arrive as integers. ``value_wei`` and the USDC balance
arrive as **strings** and stay strings: they do not survive a float, and a rounded ``value_wei``
is a signature that will not verify.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


def _opt_int(v: Any) -> int | None:
    """None stays None. On ``remaining_today_kes`` that distinction is the whole point: a budget
    that could not be read is not an empty one."""
    return None if v is None else int(v)


@dataclass(frozen=True)
class Merchant:
    """A merchant record (``GET /v1/merchants/me``). ``state`` starts as ``"pending"``."""
    address: str
    business_name: str
    contact_email: str
    contact_phone: str
    callback_url: str
    state: str
    daily_cap_kes: int
    per_charge_max_kes: int

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Merchant":
        return cls(
            address=d["address"], business_name=d["business_name"],
            contact_email=d.get("contact_email", ""), contact_phone=d.get("contact_phone", ""),
            callback_url=d.get("callback_url", ""), state=d["state"],
            daily_cap_kes=int(d.get("daily_cap_kes", 0)), per_charge_max_kes=int(d.get("per_charge_max_kes", 0)),
        )


#: Charge statuses (charge/status.go).
CHARGE_STATUSES = ("pending", "prompted", "paid", "settled", "failed", "expired", "cancelled")


@dataclass(frozen=True)
class Charge:
    """A charge: an M-Pesa prompt on a payer's phone, settled to your wallet.

    ``amount`` is whole KES. ``paid_at`` and ``settled_at`` are RFC 3339 strings or None.
    """
    id: str
    reference: str
    amount: int
    currency: str
    status: str
    created_at: str
    paid_at: str | None = None
    settled_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Charge":
        return cls(
            id=str(d.get("id", "")), reference=str(d.get("reference", "")),
            amount=int(d.get("amount", 0) or 0), currency=str(d.get("currency", "")),
            status=str(d.get("status", "")), created_at=str(d.get("created_at", "")),
            paid_at=d.get("paid_at"), settled_at=d.get("settled_at"), raw=d,
        )


@dataclass(frozen=True)
class Transfer:
    """``POST /v1/transfers``. ``id`` is the transaction hash.

    ``status`` is ``"confirmed"`` when the chain already has it (HTTP 200) and ``"pending"``
    while it is in flight (HTTP 202).
    """
    id: str
    status: str
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Transfer":
        return cls(id=str(d.get("id", "")), status=str(d.get("status", "")), raw=d)


@dataclass(frozen=True)
class Balances:
    """Your own balances on Base. ``usdc`` is a decimal STRING, never a float."""
    kshs_amount_kes: int
    usdc_amount: str
    kshs_network: str = "base"
    usdc_network: str = "base"
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Balances":
        k, u = d.get("kshs") or {}, d.get("usdc") or {}
        return cls(
            kshs_amount_kes=int(k.get("amount_kes", 0) or 0), usdc_amount=str(u.get("amount", "0")),
            kshs_network=str(k.get("network", "base")), usdc_network=str(u.get("network", "base")), raw=d,
        )


#: The public, closed set of order statuses. The server collapses its internal pipeline steps to
#: these and maps anything it has no name for to "processing", so a new internal step can never
#: leak a pipeline word into your code.
ORDER_STATUSES = ("awaiting_payment", "completed", "failed", "refunding", "refunded", "processing")


@dataclass(frozen=True)
class Order:
    """A ramp order (``GET /v1/orders/{id}``).

    Deposit: ``amount_kes`` is what was paid in, ``receive_kes`` the KSHS received.
    Withdrawal: ``amount_kes`` is the KSHS sent, ``receive_kes`` the shillings paid out.
    ``expires_at`` is set only while the order is awaiting payment.
    """
    id: str
    type: str
    status: str
    amount_kes: int
    receive_kes: int
    fee_kes: int
    created_at: str
    expires_at: str | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Order":
        return cls(
            id=str(d.get("id", "")), type=str(d.get("type", "")), status=str(d.get("status", "")),
            amount_kes=int(d.get("amount_kes", 0) or 0), receive_kes=int(d.get("receive_kes", 0) or 0),
            fee_kes=int(d.get("fee_kes", 0) or 0), created_at=str(d.get("created_at", "")),
            expires_at=d.get("expires_at"), raw=d,
        )


@dataclass(frozen=True)
class PayoutLimits:
    """Your own payout governance, published so you do not have to learn it by being refused.

    ``hold_above_kes`` is the one to act on: a payout above it is ACCEPTED and held for a person
    to review, which is a normal outcome and not an error.

    ``remaining_today_kes`` is a snapshot and is ``None`` when the counter could not be read —
    which does **not** mean zero.

    ``enabled`` is one fact, not two: whether the global switch or yours is off is deliberately
    not published.
    """
    enabled: bool
    max_kes: int
    daily_cap_kes: int
    hold_above_kes: int
    remaining_today_kes: int | None
    note: str = ""

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "PayoutLimits":
        return cls(
            enabled=bool(d.get("enabled", False)), max_kes=int(d.get("max_kes", 0) or 0),
            daily_cap_kes=int(d.get("daily_cap_kes", 0) or 0),
            hold_above_kes=int(d.get("hold_above_kes", 0) or 0),
            remaining_today_kes=_opt_int(d.get("remaining_today_kes")), note=str(d.get("note", "")),
        )


@dataclass(frozen=True)
class Limits:
    """``GET /v1/limits``: the withdrawal band, plus — for a merchant — your own payout limits.

    The band is cached and refreshed on a timer, so it can be up to ``max_staleness_seconds``
    out of date. A quote, not this band, is what decides whether an amount is accepted.
    ``payout`` is None for a caller that is not a registered merchant.
    """
    withdrawal_min_kes: int
    withdrawal_max_kes: int
    withdrawal_source: str
    max_staleness_seconds: int
    payout: PayoutLimits | None = None
    note: str = ""
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Limits":
        w = d.get("withdrawal") or {}
        p = d.get("payout")
        return cls(
            withdrawal_min_kes=int(w.get("min_kes", 0) or 0), withdrawal_max_kes=int(w.get("max_kes", 0) or 0),
            withdrawal_source=str(w.get("source", "")),
            max_staleness_seconds=int(d.get("max_staleness_seconds", 0) or 0),
            payout=PayoutLimits.from_dict(p) if isinstance(p, dict) else None,
            note=str(d.get("note", "")), raw=d,
        )


@dataclass(frozen=True)
class Quote:
    """A price, and nothing else: no id, no rail, no treasury address.

    Deposit: ``pay_kes`` is what the payer is asked for. Withdrawal: ``send_kes`` is the KSHS
    that would be sent. ``rate_kes_per_usdc`` is a decimal string.

    This is NOT a payout quote. To price and then send a merchant payout use
    ``client.payouts.quote``, which mints the single-use id ``payouts.create`` requires.
    """
    type: str
    receive_kes: int
    fee_kes: int
    rate_kes_per_usdc: str
    expires_at: str
    pay_kes: int | None = None
    send_kes: int | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Quote":
        return cls(
            type=str(d.get("type", "")), receive_kes=int(d.get("receive_kes", 0) or 0),
            fee_kes=int(d.get("fee_kes", 0) or 0), rate_kes_per_usdc=str(d.get("rate_kes_per_usdc", "")),
            expires_at=str(d.get("expires_at", "")), pay_kes=_opt_int(d.get("pay_kes")),
            send_kes=_opt_int(d.get("send_kes")), raw=d,
        )


#: Webhook event types (models/dbmodels/webhook_event.go).
EVENT_TYPES = ("charge.paid", "charge.settled", "charge.failed", "payout.expired", "payout.cancelled")
#: Delivery states of a webhook event.
EVENT_STATUSES = ("pending", "delivered", "abandoned")


@dataclass(frozen=True)
class Event:
    """One webhook delivery: what we sent (or will send), where it stands, and why it failed.

    Delivery is AT-LEAST-ONCE. ``id`` is stable across every attempt and across a replay, and it
    is your dedupe key — a receiver that keys on it sees exactly-once; one that does not
    double-counts.

    Exactly one of ``charge_id`` and ``payout_id`` is set. ``last_error`` is from a closed
    vocabulary (``http_503``, ``timeout``, ``no_callback_url``, ...), never a raw error string.
    ``payload`` is the signed body, already decoded.
    """
    id: str
    type: str
    status: str
    created_at: str
    attempts: int
    charge_id: str | None = None
    payout_id: str | None = None
    next_attempt_at: str | None = None
    last_attempt_at: str | None = None
    delivered_at: str | None = None
    last_error: str = ""
    payload: Any = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Event":
        return cls(
            id=str(d.get("id", "")), type=str(d.get("type", "")), status=str(d.get("status", "")),
            created_at=str(d.get("created_at", "")), attempts=int(d.get("attempts", 0) or 0),
            charge_id=d.get("charge_id"), payout_id=d.get("payout_id"),
            next_attempt_at=d.get("next_attempt_at"), last_attempt_at=d.get("last_attempt_at"),
            delivered_at=d.get("delivered_at"), last_error=str(d.get("last_error", "") or ""),
            payload=d.get("payload"), raw=d,
        )


#: The seven payout states (models/dbmodels/payout.go)::
#:
#:     quoted ──► held ──► dispatched ──► paid
#:        │        │            └──────► failed
#:        │        ├──► cancelled
#:        │        └──► expired
#:        └──► expired
#:
#: ``paid``, ``failed``, ``cancelled`` and ``expired`` are all terminal: a retry is a NEW payout,
#: never this one moving again.
PAYOUT_STATES = ("quoted", "held", "dispatched", "paid", "failed", "cancelled", "expired")
#: The four states a payout can never leave.
PAYOUT_TERMINAL_STATES = ("paid", "failed", "cancelled", "expired")


@dataclass(frozen=True)
class EIP712Domain:
    """One EIP-712 domain to sign under."""
    name: str
    version: str
    chain_id: int
    verifying_contract: str

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "EIP712Domain":
        return cls(
            name=str(d.get("name", "")), version=str(d.get("version", "")),
            chain_id=int(d.get("chain_id", 0) or 0),
            verifying_contract=str(d.get("verifying_contract", "")),
        )


@dataclass(frozen=True)
class PayoutQuote:
    """A single-use payout quote: the price, plus exactly what to sign.

    ``amount_kes`` LANDS on the beneficiary; ``send_kes`` leaves your wallet; ``value_wei`` is
    ``send_kes`` in wei and is the number the permit must be for. Sign a transfer with
    ``from`` = your address, ``to`` = ``treasury_address``, this ``value_wei`` exactly, and a
    deadline in the future and no later than ``deadline``.

    BOTH domains are published because they differ: sign the EIP-2612 permit under
    ``permit_domain`` (the token's) and the Relay intent under ``relay_domain`` (the
    forwarder's). Signing the permit under the wrong one produces a signature the chain rejects
    with nothing to read.
    """
    quote_id: str
    amount_kes: int
    fee_kes: int
    send_kes: int
    currency: str
    beneficiary_phone: str
    beneficiary_name: str
    expires_at: str
    value_wei: str
    treasury_address: str
    deadline: int
    permit_domain: EIP712Domain | None = None
    relay_domain: EIP712Domain | None = None
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "PayoutQuote":
        b = d.get("beneficiary") or {}
        e = d.get("eip712") or {}
        return cls(
            quote_id=str(d.get("quote_id", "")), amount_kes=int(d.get("amount_kes", 0) or 0),
            fee_kes=int(d.get("fee_kes", 0) or 0), send_kes=int(d.get("send_kes", 0) or 0),
            currency=str(d.get("currency", "KES")),
            beneficiary_phone=str(b.get("phone", "")), beneficiary_name=str(b.get("name", "")),
            expires_at=str(d.get("expires_at", "")),
            # A STRING, deliberately. int() here would be fine in Python but round-trips through
            # JSON as a number and loses the exact decimal the server compares against.
            value_wei=str(d.get("value_wei", "")),
            treasury_address=str(d.get("treasury_address", "")), deadline=int(d.get("deadline", 0) or 0),
            permit_domain=EIP712Domain.from_dict(e["permit"]) if isinstance(e.get("permit"), dict) else None,
            relay_domain=EIP712Domain.from_dict(e["relay"]) if isinstance(e.get("relay"), dict) else None,
            raw=d,
        )


@dataclass(frozen=True)
class Payout:
    """A merchant payout. ``status`` is one of :data:`PAYOUT_STATES`.

    ``message`` is Kakitu's sentence about what is happening now, and is the only place a hold is
    explained: a ``held`` payout has NOT been sent and is waiting for a person to release or
    cancel it. That is a normal outcome, not an error.
    """
    id: str
    status: str
    amount_kes: int
    fee_kes: int
    send_kes: int
    currency: str
    beneficiary_phone: str
    beneficiary_name: str
    created_at: str
    message: str = ""
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    @property
    def is_terminal(self) -> bool:
        """True for paid, failed, cancelled and expired. A retry is a NEW payout."""
        return self.status in PAYOUT_TERMINAL_STATES

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Payout":
        b = d.get("beneficiary") or {}
        return cls(
            id=str(d.get("id", "")), status=str(d.get("status", "")),
            amount_kes=int(d.get("amount_kes", 0) or 0), fee_kes=int(d.get("fee_kes", 0) or 0),
            send_kes=int(d.get("send_kes", 0) or 0), currency=str(d.get("currency", "KES")),
            beneficiary_phone=str(b.get("phone", "")), beneficiary_name=str(b.get("name", "")),
            created_at=str(d.get("created_at", "")), message=str(d.get("message", "") or ""), raw=d,
        )
