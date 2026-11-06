<?php

declare(strict_types=1);

namespace Kakitu;

/**
 * The ten states of a merchant payout (models/dbmodels/payout.go). This is Kakitu's own
 * vocabulary, deliberately NOT a rail's: the fiat partners' words differ from each other and
 * are not part of a public contract.
 *
 *     pending_approval ──► approved ──► (you sign) ──► dispatched ──► paid
 *            │                │                              └─────► failed
 *            └──► rejected ◄──┤
 *                             └──► expired
 *
 *     quoted ──► held ──► dispatched      (a payout at or below your hold threshold)
 *        │         ├──► cancelled
 *        └─► expired └──► expired
 *
 * A payout ABOVE `hold_above_kes` starts at pending_approval: a person decides before anything is
 * signed. See Payouts::request().
 *
 * Switch on these, never on the `message`:
 *
 *     if ($payout['status'] === PayoutState::HELD) { ... }
 */
final class PayoutState
{
    /** Priced, nothing signed, nothing moved. */
    public const QUOTED = 'quoted';
    /** You asked a person; nothing is signed, priced or counted. No clock runs on the decision. */
    public const PENDING_APPROVAL = 'pending_approval';
    /** A person said yes. Quote with `payout_id`, sign, and submit before `approval_expires_at`. */
    public const APPROVED = 'approved';
    /** Terminal. A person said no. Nothing was signed or sent. Do not ask again. */
    public const REJECTED = 'rejected';
    /**
     * Signed and accepted, deliberately NOT sent. Every payout is accepted into this state —
     * there is no quoted -> dispatched arrow — because this is the moment the hold decision is
     * taken. A payout over your `hold_above_kes` stays here until a person releases it. That is
     * a normal, expected outcome and not an error.
     */
    public const HELD = 'held';
    /** Handed to the withdraw worker; the money is leaving. */
    public const DISPATCHED = 'dispatched';
    /** Terminal. The beneficiary has the money. */
    public const PAID = 'paid';
    /** Terminal. A retry is a NEW payout, never this one moving again. */
    public const FAILED = 'failed';
    /** Terminal. An operator refused a held payout. */
    public const CANCELLED = 'cancelled';
    /**
     * Terminal. Nothing was sent and nothing can be: either a quote lapsed with nothing signed,
     * or a HELD payout's signed permit passed its deadline while it waited for a person. The
     * second is the ordinary end of a hold, not an edge case — the permit window is minutes and
     * a human is not — and the answer to it is to sign again, which is a NEW payout.
     */
    public const EXPIRED = 'expired';

    /** @return list<string> every published state */
    public static function all(): array
    {
        return [
            self::QUOTED, self::PENDING_APPROVAL, self::APPROVED, self::REJECTED, self::HELD,
            self::DISPATCHED, self::PAID, self::FAILED, self::CANCELLED, self::EXPIRED,
        ];
    }

    /** @return list<string> the five a payout can never leave */
    public static function terminal(): array
    {
        return [self::PAID, self::FAILED, self::CANCELLED, self::REJECTED, self::EXPIRED];
    }

    /** True for paid, failed, cancelled, rejected and expired. A retry is a NEW payout. */
    public static function isTerminal(string $state): bool
    {
        return in_array($state, self::terminal(), true);
    }
}
