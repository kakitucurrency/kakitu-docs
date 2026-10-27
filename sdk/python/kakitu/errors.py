"""Typed exceptions. Switch on ``exc.code`` (or catch a subclass); never match message text."""
from __future__ import annotations

from typing import Any


class KakituError(Exception):
    """Base class. ``code`` is the API's stable error code; ``message`` is for humans."""

    def __init__(self, code: str, message: str, request_id: str | None = None,
                 status: int | None = None, reason: str | None = None) -> None:
        self.code = code
        self.message = message
        self.request_id = request_id
        self.status = status
        self.reason = reason
        super().__init__(f"{code}: {message}" + (f" (request_id={request_id})" if request_id else ""))


class InvalidRequestError(KakituError): ...
class AuthenticationError(KakituError):
    """401. ``reason`` is one of missing_auth_headers, bad_timestamp, timestamp_out_of_range,
    bad_signature, replay, auth_unavailable (the auth layer's own vocabulary)."""
class MerchantNotRegisteredError(KakituError): ...
class MerchantNotApprovedError(KakituError): ...
class MerchantSuspendedError(KakituError): ...
class MerchantNameFrozenError(KakituError): ...
class IdempotencyError(KakituError):
    """idempotency_key_required / _invalid / _reuse / _in_progress / _acted / idempotency_unavailable."""
class RequestTooLargeError(KakituError): ...
class AmountError(KakituError):
    """amount_below_minimum / amount_above_maximum."""
class LimitExceededError(KakituError):
    """daily_cap_exceeded / payer_velocity_exceeded (HTTP 429 but NOT transient: not retried)."""
class RateLimitedError(KakituError): ...
class ChargeNotFoundError(KakituError): ...
class ReferenceReusedError(KakituError): ...
class RailUnavailableError(KakituError): ...
class OrderNotFoundError(KakituError): ...
class EventNotFoundError(KakituError): ...
class PayoutNotFoundError(KakituError):
    """404. Its own code, not order_not_found: a payout is not an order, and an integrator
    holding a payout id must not be sent looking for one."""
class PayoutQuoteNotFoundError(KakituError):
    """404. The ONE answer for a payout quote that does not exist, has expired, has already
    been spent, or belongs to someone else. They are deliberately indistinguishable."""
class PayoutsDisabledError(KakituError):
    """403. Payouts are off for you. Which switch is off — the global one or yours — is
    deliberately not published."""
class PayoutLimitExceededError(KakituError):
    """429 payout_daily_cap_exceeded. NOT daily_cap_exceeded: the payout budget is a separate
    setting on a separate counter, so raising the collection cap changes nothing here."""
class PayoutAmountError(KakituError):
    """400 payout_amount_above_maximum. Not a 429: waiting does not help, a smaller payout does."""
class ProfileRequiredError(KakituError):
    """409. The wallet has not given Kakitu the details a ramp needs yet."""
class IdentityVerificationRequiredError(KakituError):
    """403. This amount needs the customer's identity checked first."""
class InternalError(KakituError): ...
class KakituConnectionError(KakituError):
    """Network failure after all retries. code is 'connection_error'."""


_BY_CODE: dict[str, type[KakituError]] = {
    "invalid_request": InvalidRequestError,
    "unauthorized": AuthenticationError,
    "merchant_not_registered": MerchantNotRegisteredError,
    "merchant_not_approved": MerchantNotApprovedError,
    "merchant_suspended": MerchantSuspendedError,
    "merchant_name_frozen": MerchantNameFrozenError,
    "idempotency_key_required": IdempotencyError,
    "idempotency_key_invalid": IdempotencyError,
    "idempotency_key_reuse": IdempotencyError,
    "idempotency_key_in_progress": IdempotencyError,
    "idempotency_key_acted": IdempotencyError,
    "idempotency_unavailable": IdempotencyError,
    "request_too_large": RequestTooLargeError,
    "amount_below_minimum": AmountError,
    "amount_above_maximum": AmountError,
    "daily_cap_exceeded": LimitExceededError,
    "payer_velocity_exceeded": LimitExceededError,
    "rate_limited": RateLimitedError,
    "charge_not_found": ChargeNotFoundError,
    "reference_reused": ReferenceReusedError,
    "rail_unavailable": RailUnavailableError,
    "order_not_found": OrderNotFoundError,
    "event_not_found": EventNotFoundError,
    "payouts_disabled": PayoutsDisabledError,
    "payout_daily_cap_exceeded": PayoutLimitExceededError,
    "payout_amount_above_maximum": PayoutAmountError,
    "payout_not_found": PayoutNotFoundError,
    "payout_quote_not_found": PayoutQuoteNotFoundError,
    "profile_required": ProfileRequiredError,
    "identity_verification_required": IdentityVerificationRequiredError,
    "internal": InternalError,
}

#: The closed set of codes the server can return (apiv1/errors.go).
CODES = frozenset(_BY_CODE)


def error_from_response(status: int, body: Any, header_request_id: str | None) -> KakituError:
    """Build the right exception from a parsed JSON body (or None if unparseable).

    Two envelopes exist on the server. ``/v1`` handlers answer
    ``{"error":{"code","message","request_id"}}``; the auth middleware (which runs first)
    answers ``{"error":"unauthorized","reason":"..."}`` with no request_id.
    """
    err = body.get("error") if isinstance(body, dict) else None
    if isinstance(err, dict):
        code = str(err.get("code") or "unknown")
        message = str(err.get("message") or "")
        rid = err.get("request_id") or header_request_id
        return _BY_CODE.get(code, KakituError)(code, message, rid, status)
    if isinstance(err, str):
        reason = str(body.get("reason") or "") if isinstance(body, dict) else ""
        hint = ""
        if reason == "timestamp_out_of_range":
            hint = " Your system clock differs from the server's by more than 120 seconds; sync it (NTP)."
        elif reason == "bad_signature":
            hint = " The signature did not match the claimed address; check the private key."
        return _BY_CODE.get(err, KakituError)(err, f"{reason or err}.{hint}".strip(), header_request_id, status, reason or None)
    return KakituError("unknown", f"Unexpected HTTP {status} response.", header_request_id, status)
