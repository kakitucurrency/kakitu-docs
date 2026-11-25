<?php

declare(strict_types=1);

namespace Kakitu\Resources;

use Kakitu\Kakitu;

/** Your merchant record. Live endpoints: POST /v1/merchants, GET /v1/merchants/me. */
final class Merchants
{
    public function __construct(private Kakitu $client)
    {
    }

    /**
     * POST /v1/merchants: update an existing merchant's contact email, phone and callback URL.
     *
     * It does not make a merchant: becoming one is the application at https://kakitu.org/merchant
     * and Kakitu's approval. A wallet with no merchant record gets merchant_not_registered (404). business_name must be
     * the name you applied with: it is frozen.
     *
     * Accepted fields: business_name (required, max 100), contact_email (required),
     * contact_phone, callback_url (public https URL on port 443). An omitted optional field
     * keeps its stored value; an explicit "" clears it. Unknown fields are refused.
     *
     * @param array{business_name: string, contact_email: string, contact_phone?: string, callback_url?: string} $params
     * @param array{idempotency_key?: string} $options
     * @return array<string,mixed>
     */
    public function update(array $params, array $options = []): array
    {
        return $this->client->request('POST', '/v1/merchants', [], $params, $options);
    }

    /**
     * @deprecated The route no longer registers anybody. Use update(); this is the same call.
     *
     * @param array{business_name: string, contact_email: string, contact_phone?: string, callback_url?: string} $params
     * @param array{idempotency_key?: string} $options
     * @return array<string,mixed>
     */
    public function register(array $params, array $options = []): array
    {
        return $this->update($params, $options);
    }

    /**
     * Read your own merchant record (state: pending / approved / ...).
     * Throws MerchantException with code merchant_not_registered if this wallet has no merchant record.
     *
     * @return array{address: string, business_name: string, contact_email: string, contact_phone: string, callback_url: string, state: string, daily_cap_kes: int, per_charge_max_kes: int}
     */
    public function me(): array
    {
        return $this->client->request('GET', '/v1/merchants/me');
    }
}
