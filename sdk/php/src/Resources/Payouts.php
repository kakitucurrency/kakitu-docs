<?php

declare(strict_types=1);

namespace Kakitu\Resources;

use InvalidArgumentException;
use Kakitu\Kakitu;
use Kakitu\Pagination;

/**
 * Merchant payouts: sending KES to somebody else.
 *
 * POST /v1/payouts/requests, POST /v1/payouts/quote, POST /v1/payouts, GET /v1/payouts/{id},
 * GET /v1/payouts
 *
 * ABOVE YOUR `hold_above_kes` A PERSON DECIDES BEFORE YOU SIGN: request() asks, you receive the
 * `payout.approved` event (or `payout.rejected`), then quote() with that `payout_id`, sign, and
 * create() before `approval_expires_at`.
 *
 * A beneficiary is a phone, a till, a paybill or a bank account: see {@see Beneficiary}.
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
     * Ask a person to approve a payout BEFORE anything is signed. Needed above your
     * `hold_above_kes`. Nothing is priced, signed or counted against your budget: the answer is
     * status `pending_approval`, and you will receive `payout.approved` (with
     * `approval_expires_at`) or `payout.rejected`.
     *
     * Fields: amount_kes and beneficiary, as for quote(). An Idempotency-Key is REQUIRED and one is
     * generated unless you pass your own.
     *
     * @param array{amount_kes: int, beneficiary: array<string,string>} $params
     * @param array{idempotency_key?: string} $options
     * @return array<string,mixed>
     */
    public function request(array $params, array $options = []): array
    {
        return $this->client->request('POST', '/v1/payouts/requests', [], $params, $options + ['idempotent' => true]);
    }

    /**
     * Price a payout and get back exactly what to sign.
     *
     * Fields: amount_kes (what LANDS on the beneficiary, not what leaves your wallet — that is
     * `send_kes`), beneficiary (`Beneficiary::...->toArray()`; the old `{phone, name}` still
     * works) and, for a payout above `hold_above_kes`, payout_id: the request a person approved,
     * with the same amount and beneficiary. The name is the person being PAID: it is what their
     * M-Pesa statement shows, and it is never filled in from your own profile.
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
     * @param array{amount_kes: int, beneficiary: array<string,string>, payout_id?: string} $params
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
     * Answers HTTP 202. Nothing has reached the beneficiary yet: poll get() for the outcome,
     * `dispatched` and then `paid` or `failed`. A payout above your `hold_above_kes` (see
     * {@see Limits}) must have been approved first: see request().
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
