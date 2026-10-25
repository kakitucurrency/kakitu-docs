<?php

declare(strict_types=1);

namespace Kakitu\Resources;

use InvalidArgumentException;
use Kakitu\Kakitu;

/**
 * Charges: an M-Pesa prompt on a payer's phone, settled to your wallet.
 *
 * NOT YET AVAILABLE. The /v1/charges endpoints are still being written on the server. This
 * class follows the published plan (POST /v1/charges, GET /v1/charges/{id},
 * GET /v1/charges?reference=&status=&created_after=&limit=&cursor=) but those routes do not
 * exist yet, so every call will fail until they ship, and field names below are provisional.
 * Parameters are passed through untouched, so nothing here needs to change when they land.
 */
final class Charges
{
    public function __construct(private Kakitu $client)
    {
    }

    /**
     * NOT YET AVAILABLE. Create a charge. Sends an automatic Idempotency-Key (a fresh UUID);
     * pass your own in $options['idempotency_key'] (for example derived from your order id) so
     * that retrying after a crash or timeout can never charge the payer twice.
     *
     * Provisional fields: amount (KES), phone (payer's M-Pesa number), reference (your order id,
     * unique per merchant).
     *
     * @param array<string,mixed> $params
     * @param array{idempotency_key?: string} $options
     * @return array<string,mixed>
     */
    public function create(array $params, array $options = []): array
    {
        return $this->client->request('POST', '/v1/charges', [], $params, $options);
    }

    /**
     * NOT YET AVAILABLE. Fetch one charge by id.
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
     * NOT YET AVAILABLE. List charges. Planned filters: reference, status, created_after, limit, cursor.
     *
     * @param array<string,scalar> $filters
     * @return array<string,mixed>
     */
    public function list(array $filters = []): array
    {
        return $this->client->request('GET', '/v1/charges', $filters);
    }
}
