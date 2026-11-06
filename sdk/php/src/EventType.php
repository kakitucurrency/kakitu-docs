<?php

declare(strict_types=1);

namespace Kakitu;

/**
 * The webhook event types and delivery statuses (models/dbmodels/webhook_event.go).
 *
 * Both are CLOSED sets the `events.list()` filters are validated against: a typo is refused with
 * `invalid_request` rather than quietly matching nothing, so "why is my list empty" is answered
 * instead of hunted.
 *
 * `payout.expired` is the one to watch — it is the event that says money did NOT go out and the
 * merchant must sign again.
 */
final class EventType
{
    public const CHARGE_PAID = 'charge.paid';
    public const CHARGE_SETTLED = 'charge.settled';
    public const CHARGE_FAILED = 'charge.failed';
    /** KSHS arrived at your address on chain. `transfer.reference` is the payer's claim, not proof. */
    public const TRANSFER_RECEIVED = 'transfer.received';
    /** A person said yes to a request. QUOTE AND SIGN IT NOW, before `approval_expires_at`. */
    public const PAYOUT_APPROVED = 'payout.approved';
    /** A person said no. DO NOT ask again: nothing was signed or sent. */
    public const PAYOUT_REJECTED = 'payout.rejected';
    /** NOT SENT. Sign and submit a NEW payout. */
    public const PAYOUT_EXPIRED = 'payout.expired';
    /** NOT SENT. A person refused it. Do not submit it again. */
    public const PAYOUT_CANCELLED = 'payout.cancelled';
    /** The beneficiary has the money. */
    public const PAYOUT_PAID = 'payout.paid';
    /** It did not reach the beneficiary. A retry is a NEW payout. */
    public const PAYOUT_FAILED = 'payout.failed';
    // About YOUR OWN payout controls. If you did not make the change, somebody else holds your key.
    public const PAYOUT_DESTINATION_ADDED = 'payout_destination.added';
    public const PAYOUT_DESTINATION_REMOVED = 'payout_destination.removed';
    public const PAYOUT_LOCK_CHANGED = 'payout_lock.changed';

    /** Not yet delivered; due when next_attempt_at has passed. */
    public const STATUS_PENDING = 'pending';
    /** Your endpoint answered 2xx. */
    public const STATUS_DELIVERED = 'delivered';
    /** Attempts exhausted; kept for the audit trail and for replay. */
    public const STATUS_ABANDONED = 'abandoned';

    /** @return list<string> */
    public static function all(): array
    {
        return [
            self::CHARGE_PAID, self::CHARGE_SETTLED, self::CHARGE_FAILED, self::TRANSFER_RECEIVED,
            self::PAYOUT_APPROVED, self::PAYOUT_REJECTED, self::PAYOUT_EXPIRED, self::PAYOUT_CANCELLED,
            self::PAYOUT_PAID, self::PAYOUT_FAILED,
            self::PAYOUT_DESTINATION_ADDED, self::PAYOUT_DESTINATION_REMOVED, self::PAYOUT_LOCK_CHANGED,
        ];
    }

    /** @return list<string> */
    public static function statuses(): array
    {
        return [self::STATUS_PENDING, self::STATUS_DELIVERED, self::STATUS_ABANDONED];
    }
}
