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
    public const PAYOUT_EXPIRED = 'payout.expired';
    public const PAYOUT_CANCELLED = 'payout.cancelled';

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
            self::CHARGE_PAID, self::CHARGE_SETTLED, self::CHARGE_FAILED,
            self::PAYOUT_EXPIRED, self::PAYOUT_CANCELLED,
        ];
    }

    /** @return list<string> */
    public static function statuses(): array
    {
        return [self::STATUS_PENDING, self::STATUS_DELIVERED, self::STATUS_ABANDONED];
    }
}
