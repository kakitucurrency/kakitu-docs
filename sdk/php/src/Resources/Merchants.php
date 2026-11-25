<?php

declare(strict_types=1);

namespace Kakitu\Resources;

use Kakitu\Kakitu;

/** Your merchant record. POST /v1/merchants, GET /v1/merchants/me, POST /v1/merchants/me/webhook-secret. */
final class Merchants
{
    public function __construct(private Kakitu $client)
    {
    }

    /**
     * POST /v1/merchants: update an existing merchant's contact email, phone and callback URL.
     *
     * It does not make a merchant: becoming one is the application at https://kakitu.org/merchant
     * and Kakitu's approval. A wallet with no merchant record gets merchant_not_registered (404).
     *
     * Every field is optional: business_name (if sent, must equal the stored name),
     * contact_email (cannot be cleared), contact_phone, callback_url (public https URL on port
     * 443). An omitted field keeps its stored value; an explicit "" clears contact_phone or
     * callback_url. Unknown fields are refused.
     *
     * The first call from an approved merchant that sets a callback_url carries `webhook_secret`,
     * once. If that answer is lost, call rotateWebhookSecret().
     *
     * @param array{business_name?: string, contact_email?: string, contact_phone?: string, callback_url?: string} $params
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
     * POST /v1/merchants/me/webhook-secret: make a new webhook secret and receive it, once. The old
     * one stops signing at once. Approved merchants only (merchant_not_approved, 403).
     *
     * Not resent after a network error: a first request that lands late would void the secret the
     * resend returned. If it fails that way, call it again.
     *
     * @return array{webhook_secret: string}
     */
    public function rotateWebhookSecret(): array
    {
        return $this->client->request('POST', '/v1/merchants/me/webhook-secret', [], null, ['resend_on_network_error' => false]);
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
