<?php

declare(strict_types=1);

namespace Kakitu\Resources;

use Kakitu\Kakitu;

/** Prices for deposits and withdrawals (POST /v1/quotes). */
final class Quotes
{
    public function __construct(private Kakitu $client)
    {
    }

    /**
     * Ask what something would cost.
     *
     * Fields: type ("deposit" or "withdrawal"), amount_kes (whole shillings, at least 1), phone
     * (a deposit), beneficiary{channel, number, reference} (REQUIRED for a withdrawal).
     *
     * NO Idempotency-Key is sent, and the server mounts none on this route: a quote creates no
     * order, no charge and no transfer, so it is not a write.
     *
     * THIS IS NOT A PAYOUT QUOTE. The result carries no id and nothing here can be redeemed. To
     * price and then SEND a merchant payout use Payouts::quote(), which mints the single-use
     * quote id Payouts::create() requires — an id from this route is refused there, on purpose.
     *
     * Returns the price: type, pay_kes (deposit) or send_kes (withdrawal), receive_kes, fee_kes,
     * rate_kes_per_usdc (a decimal string) and expires_at.
     *
     * @param array{type: string, amount_kes: int, phone?: string, beneficiary?: array<string,string>} $params
     * @return array<string,mixed>
     */
    public function create(array $params): array
    {
        return $this->client->request('POST', '/v1/quotes', [], $params);
    }
}
