<?php

declare(strict_types=1);

namespace Kakitu\Resources;

use Kakitu\Kakitu;

/** Your own KSHS and USDC balances on Base (GET /v1/balances). */
final class Balances
{
    public function __construct(private Kakitu $client)
    {
    }

    /**
     * Read your own balances from the chain. An address with no history holds zero, which the
     * chain reports as zero: that is an answer, not an error.
     *
     * `kshs.amount_kes` is a whole number of shillings. `usdc.amount` is a decimal STRING — keep
     * it one; through a float it is a different number. Both carry `network` ("base"), stated
     * because a customer has already lost money sending a token to a Kakitu address on the
     * wrong chain.
     *
     * @return array{kshs: array{amount_kes: int, network: string}, usdc: array{amount: string, network: string}}
     */
    public function retrieve(): array
    {
        /** @var array{kshs: array{amount_kes: int, network: string}, usdc: array{amount: string, network: string}} */
        return $this->client->request('GET', '/v1/balances');
    }
}
