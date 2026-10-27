<?php

declare(strict_types=1);

namespace Kakitu\Resources;

use InvalidArgumentException;
use Kakitu\Kakitu;
use Kakitu\Pagination;

/**
 * Merchant payouts: sending KES to somebody else.
 *
 * POST /v1/payouts/quote, POST /v1/payouts, GET /v1/payouts/{id}, GET /v1/payouts
 *
 * TWO STEPS, AND THEY ARE NOT INTERCHANGEABLE. quote() mints a SINGLE-USE quote id and tells you
 * exactly what to sign; create() spends it. A quote from Quotes::create() is not one of these
 * and is refused here, deliberately: that route has no merchant, no approval and no payout cap
 * behind it.
 *
 * THIS SDK DOES NOT SIGN THE PAYOUT, AND CANNOT. create() takes the transfer YOU signed with
 * your own wallet key, under the two EIP-712 domains the quote published. See {@see Transfers}.
 */
final class Payouts
{
    public function __construct(private Kakitu $client)
    {
    }

    /**
     * Price a payout and get back exactly what to sign.
     *
     * Fields: amount_kes (what LANDS on the beneficiary, not what leaves your wallet — that is
     * `send_kes`), beneficiary{phone, name}. The phone is a Kenyan mobile as 2547xxxxxxxx and
     * the name is the person being PAID: it is what their M-Pesa statement shows, and it is
     * never filled in from your own profile.
     *
     * NO Idempotency-Key is sent, and the server mounts none: a quote creates no payout and
     * moves no money.
     *
     * Your daily payout cap is checked HERE, at quote time, so you learn you are over budget
     * before signing anything.
     *
     * The response carries the price plus: value_wei (a decimal STRING — the permit must be for
     * exactly this), treasury_address (sign `to` as this), deadline (the LATEST that will be
     * accepted; earlier is fine) and eip712{permit, relay}.
     *
     * BOTH domains are published because they differ: sign the EIP-2612 permit under
     * eip712.permit (the token's) and the Relay intent under eip712.relay (the forwarder's).
     * Signing the permit under the forwarder's domain produces a signature the chain rejects
     * with nothing to read, so neither is left to be guessed.
     *
     * @param array{amount_kes: int, beneficiary: array{phone: string, name: string}} $params
     * @return array<string,mixed>
     */
    public function quote(array $params): array
    {
        return $this->client->request('POST', '/v1/payouts/quote', [], $params);
    }

    /**
     * Confirm a payout with the quote you signed.
     *
     * $quoteId comes from quote() and is single use; it also expires. $transfer is that quote
     * signed with YOUR OWN key — from, to, value_wei, deadline, the EIP-2612 permit (v, r, s)
     * and the EIP-712 Relay intent (iv, ir, is). This SDK produces none of those.
     *
     * Everything the quote fixed is enforced before a row is written: `from` must be your own
     * wallet, `to` the quote's treasury_address, `value_wei` the quote's exactly, and `deadline`
     * in the future and no later than the quote's.
     *
     * An Idempotency-Key is REQUIRED and one is generated unless you pass your own.
     *
     * Answers HTTP 202. A payout over your `hold_above_kes` (see {@see Limits}) comes back with
     * status `held` and has NOT been sent: a person will release or cancel it. THAT IS A NORMAL
     * OUTCOME, NOT AN ERROR — poll get() for where it ends up.
     *
     * @param array{from: string, to: string, value_wei: string, deadline: int, v: int, r: string, s: string, iv: int, ir: string, is: string} $transfer
     * @param array{idempotency_key?: string} $options
     * @return array<string,mixed>
     */
    public function create(string $quoteId, array $transfer, array $options = []): array
    {
        if (trim($quoteId) === '') {
            throw new InvalidArgumentException('A quote_id from payouts->quote() is required.');
        }
        Transfers::assertSignedTransfer($transfer);
        return $this->client->request(
            'POST',
            '/v1/payouts',
            [],
            ['quote_id' => $quoteId, 'transfer' => $transfer],
            $options + ['idempotent' => true],
        );
    }

    /**
     * Fetch one of your payouts.
     *
     * A payout belonging to another merchant, one that does not exist, and an id that is not a
     * UUID at all are ONE answer with one set of words (`payout_not_found`).
     *
     * `status` is one of {@see \Kakitu\PayoutState}. `message` is Kakitu's sentence about what is
     * happening now, and is the only place a hold is explained.
     *
     * @return array<string,mixed>
     */
    public function get(string $id): array
    {
        if (trim($id) === '') {
            throw new InvalidArgumentException('A payout id is required.');
        }
        return $this->client->request('GET', '/v1/payouts/' . rawurlencode($id));
    }

    /**
     * One page of your payouts, newest first. Filters: status (see {@see \Kakitu\PayoutState}),
     * created_after (RFC 3339), limit (1-100, default 20), cursor.
     *
     * A status outside the closed set is refused with `invalid_request` rather than returning an
     * empty page, which for a typo would be a lie about somebody's money.
     *
     * @param array<string,scalar> $filters
     * @return array<string,mixed>
     */
    public function list(array $filters = []): array
    {
        return $this->client->request('GET', '/v1/payouts', $filters);
    }

    /**
     * Walks every page, yielding one payout at a time.
     *
     * @param array<string,scalar> $filters
     * @return \Generator<int, array<string,mixed>>
     */
    public function autoPagingIterator(array $filters = []): \Generator
    {
        return Pagination::autoPage(fn (array $f): array => $this->list($f), $filters);
    }
}
