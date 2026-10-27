<?php

declare(strict_types=1);

namespace Kakitu\Resources;

use InvalidArgumentException;
use Kakitu\Kakitu;
use Kakitu\Pagination;

/**
 * Charges: an M-Pesa prompt on a payer's phone, settled to your wallet.
 *
 * POST /v1/charges, GET /v1/charges/{id}, GET /v1/charges?reference=&status=&created_after=&limit=&cursor=
 */
final class Charges
{
    public function __construct(private Kakitu $client)
    {
    }

    /**
     * Create a charge.
     *
     * Fields: amount (whole KES), phone (the payer's M-Pesa number), reference (your own order
     * id, unique per merchant — reusing one gives `reference_reused`).
     *
     * An Idempotency-Key is REQUIRED on this route and a fresh UUID is sent for you, reused by
     * every automatic retry. That key lives only in memory, so pass your own in
     * $options['idempotency_key'] — derived from your order id and stored — if a retry after a
     * crash or restart must also be safe.
     *
     * @param array<string,mixed> $params
     * @param array{idempotency_key?: string} $options
     * @return array<string,mixed>
     */
    public function create(array $params, array $options = []): array
    {
        return $this->client->request('POST', '/v1/charges', [], $params, $options + ['idempotent' => true]);
    }

    /**
     * Fetch one charge by id.
     *
     * @return array<string,mixed>
     */
    public function get(string $id): array
    {
        if (trim($id) === '') {
            throw new InvalidArgumentException('A charge id is required.');
        }
        return $this->client->request('GET', '/v1/charges/' . rawurlencode($id));
    }

    /**
     * One page of charges, newest first. Filters: reference, status, created_after (RFC 3339),
     * limit (1-100, default 20), cursor.
     *
     * Returns `{"data": [...], "next_cursor": ...}`; `next_cursor` is null on the last page and
     * is opaque — pass it back unchanged. Use autoPagingIterator() to walk every page.
     *
     * @param array<string,scalar> $filters
     * @return array<string,mixed>
     */
    public function list(array $filters = []): array
    {
        return $this->client->request('GET', '/v1/charges', $filters);
    }

    /**
     * Walks every page, yielding one charge at a time. See {@see Pagination::autoPage()}.
     *
     * @param array<string,scalar> $filters
     * @return \Generator<int, array<string,mixed>>
     */
    public function autoPagingIterator(array $filters = []): \Generator
    {
        return Pagination::autoPage(fn (array $f): array => $this->list($f), $filters);
    }
}
