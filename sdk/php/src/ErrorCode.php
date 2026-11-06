<?php

declare(strict_types=1);

namespace Kakitu;

/**
 * The API's closed set of error codes (apiv1/errors.go). Switch on these, never on a message:
 * messages are for humans and may be reworded at any time.
 *
 *     catch (KakituException $e) {
 *         if ($e->errorCode === ErrorCode::REFERENCE_REUSED) { ... }
 *     }
 */
final class ErrorCode
{
    public const INVALID_REQUEST = 'invalid_request';
    public const UNAUTHORIZED = 'unauthorized';
    public const MERCHANT_NOT_REGISTERED = 'merchant_not_registered';
    public const MERCHANT_NOT_APPROVED = 'merchant_not_approved';
    public const MERCHANT_SUSPENDED = 'merchant_suspended';
    public const MERCHANT_NAME_FROZEN = 'merchant_name_frozen';
    public const IDEMPOTENCY_KEY_REQUIRED = 'idempotency_key_required';
    public const IDEMPOTENCY_KEY_INVALID = 'idempotency_key_invalid';
    public const IDEMPOTENCY_KEY_REUSE = 'idempotency_key_reuse';
    public const IDEMPOTENCY_KEY_IN_PROGRESS = 'idempotency_key_in_progress';
    public const IDEMPOTENCY_KEY_ACTED = 'idempotency_key_acted';
    public const IDEMPOTENCY_UNAVAILABLE = 'idempotency_unavailable';
    public const REQUEST_TOO_LARGE = 'request_too_large';
    public const AMOUNT_BELOW_MINIMUM = 'amount_below_minimum';
    public const AMOUNT_ABOVE_MAXIMUM = 'amount_above_maximum';
    public const DAILY_CAP_EXCEEDED = 'daily_cap_exceeded';
    public const PAYER_VELOCITY_EXCEEDED = 'payer_velocity_exceeded';
    public const RATE_LIMITED = 'rate_limited';
    public const CHARGE_NOT_FOUND = 'charge_not_found';
    public const REFERENCE_REUSED = 'reference_reused';
    public const RAIL_UNAVAILABLE = 'rail_unavailable';
    public const ORDER_NOT_FOUND = 'order_not_found';
    public const EVENT_NOT_FOUND = 'event_not_found';

    // The PAYOUT refusals are deliberately NOT the collection ones above, and must never be
    // folded into them: paying money OUT is a separate permission from collecting it IN, on a
    // separate setting and a separate counter. An integrator told DAILY_CAP_EXCEEDED when it is
    // the payout budget that ran out will ask an operator to raise the collection cap, which
    // changes nothing and leaves the real limit a mystery.
    public const PAYOUTS_DISABLED = 'payouts_disabled';
    public const PAYOUT_DAILY_CAP_EXCEEDED = 'payout_daily_cap_exceeded';
    /** 400, not 429: no amount of waiting makes this payout acceptable, only a smaller one. */
    public const PAYOUT_AMOUNT_ABOVE_MAXIMUM = 'payout_amount_above_maximum';
    public const PAYOUT_NOT_FOUND = 'payout_not_found';
    /** The ONE answer for a payout quote that does not exist, has expired, has already been
     * spent, or belongs to another merchant. They are deliberately indistinguishable. */
    public const PAYOUT_QUOTE_NOT_FOUND = 'payout_quote_not_found';
    /** 409. Over your hold threshold with no approval: Payouts::request() first. */
    public const PAYOUT_APPROVAL_REQUIRED = 'payout_approval_required';
    /** 409. Not yet decided, rejected, lapsed or already spent: read the payout. */
    public const PAYOUT_NOT_APPROVED = 'payout_not_approved';
    /** 409. The amount or beneficiary is not what a person approved: a new request. */
    public const PAYOUT_APPROVAL_MISMATCH = 'payout_approval_mismatch';
    /** 429. As many requests are open as you may have; a decision or a lapse frees a place. */
    public const PAYOUT_OPEN_REQUESTS_EXCEEDED = 'payout_open_requests_exceeded';
    /** 403. Not a saved destination that can be paid now: unsaved, cooling off or removed. */
    public const PAYOUT_DESTINATION_LOCKED = 'payout_destination_locked';
    public const PAYOUT_DESTINATION_NOT_FOUND = 'payout_destination_not_found';
    /** 409. You have as many saved as you may: remove one. */
    public const PAYOUT_DESTINATIONS_FULL = 'payout_destinations_full';
    public const PROFILE_REQUIRED = 'profile_required';
    /** 403. A paybill or bank is not open to this wallet. */
    public const BANK_UNAVAILABLE = 'bank_unavailable';
    /** 400. bank_code is not on the bank list. */
    public const UNKNOWN_BANK = 'unknown_bank';
    /** 422. The bank does not have this account. */
    public const ACCOUNT_NOT_FOUND = 'account_not_found';
    /** 400. The wallet does not hold the KSHS this payout burns. */
    public const INSUFFICIENT_BALANCE = 'insufficient_balance';
    public const IDENTITY_VERIFICATION_REQUIRED = 'identity_verification_required';
    public const INTERNAL = 'internal';

    // SDK-side codes (never sent by the server).
    public const CONNECTION_ERROR = 'connection_error';
    public const INVALID_RESPONSE = 'invalid_response';
    public const WEBHOOK_SIGNATURE_INVALID = 'webhook_signature_invalid';

    /** @return list<string> every code the server can send */
    public static function all(): array
    {
        return [
            self::INVALID_REQUEST, self::UNAUTHORIZED, self::MERCHANT_NOT_REGISTERED,
            self::MERCHANT_NOT_APPROVED, self::MERCHANT_SUSPENDED, self::MERCHANT_NAME_FROZEN,
            self::IDEMPOTENCY_KEY_REQUIRED, self::IDEMPOTENCY_KEY_INVALID, self::IDEMPOTENCY_KEY_REUSE,
            self::IDEMPOTENCY_KEY_IN_PROGRESS, self::IDEMPOTENCY_KEY_ACTED, self::IDEMPOTENCY_UNAVAILABLE,
            self::REQUEST_TOO_LARGE, self::AMOUNT_BELOW_MINIMUM, self::AMOUNT_ABOVE_MAXIMUM,
            self::DAILY_CAP_EXCEEDED, self::PAYER_VELOCITY_EXCEEDED, self::RATE_LIMITED,
            self::CHARGE_NOT_FOUND, self::REFERENCE_REUSED, self::RAIL_UNAVAILABLE,
            self::ORDER_NOT_FOUND, self::EVENT_NOT_FOUND, self::PAYOUTS_DISABLED,
            self::PAYOUT_DAILY_CAP_EXCEEDED, self::PAYOUT_AMOUNT_ABOVE_MAXIMUM,
            self::PAYOUT_NOT_FOUND, self::PAYOUT_QUOTE_NOT_FOUND, self::PAYOUT_APPROVAL_REQUIRED,
            self::PAYOUT_NOT_APPROVED, self::PAYOUT_APPROVAL_MISMATCH, self::PAYOUT_OPEN_REQUESTS_EXCEEDED,
            self::PAYOUT_DESTINATION_LOCKED, self::PAYOUT_DESTINATION_NOT_FOUND, self::PAYOUT_DESTINATIONS_FULL,
            self::PROFILE_REQUIRED, self::BANK_UNAVAILABLE, self::UNKNOWN_BANK, self::ACCOUNT_NOT_FOUND,
            self::INSUFFICIENT_BALANCE, self::IDENTITY_VERIFICATION_REQUIRED, self::INTERNAL,
        ];
    }
}
