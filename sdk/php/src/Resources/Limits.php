<?php

declare(strict_types=1);

namespace Kakitu\Resources;

use Kakitu\Kakitu;

/** The withdrawal band, and — for a merchant — your own payout limits (GET /v1/limits). */
final class Limits
{
    public function __construct(private Kakitu $client)
    {
    }

    /**
     * Read the current limits.
     *
     * `withdrawal` is the band (min_kes, max_kes, source: "live" or "estimated"). It is CACHED
     * and refreshed on a timer, so it can be up to `max_staleness_seconds` out of date — the
     * response says so rather than pretend to be live, and a quote, not this band, is what
     * decides whether an amount is accepted.
     *
     * `payout` is present ONLY for a caller that is a registered merchant, and is the one to
     * read before you build a payout flow:
     *
     *   enabled              may you pay out at all (one fact: whether the global switch or
     *                        yours is off is deliberately not published)
     *   max_kes              above this, a single payout is a 400
     *   daily_cap_kes        above this, today's payouts are a 429
     *   hold_above_kes       above this, a payout is ACCEPTED and HELD for a person to review.
     *                        That is a normal outcome, not an error — knowing the number lets
     *                        you warn someone BEFORE asking them to sign, rather than after.
     *   remaining_today_kes  a snapshot, and NULL when the counter could not be read. Null is
     *                        not zero: a budget that cannot be read is not an empty one.
     *
     * @return array<string,mixed>
     */
    public function retrieve(): array
    {
        return $this->client->request('GET', '/v1/limits');
    }
}
