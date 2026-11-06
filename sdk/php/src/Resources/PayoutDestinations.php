<?php

declare(strict_types=1);

namespace Kakitu\Resources;

use InvalidArgumentException;
use Kakitu\Kakitu;

/**
 * Where your cash-outs may go, and the lock that holds you to that list.
 *
 * GET|POST /v1/payout-destinations, DELETE /v1/payout-destinations/{id}, POST .../lock
 *
 * None of these moves money, so none takes an Idempotency-Key. Anything that WIDENS where money
 * can go (a new destination, turning the lock off) waits out the cooling-off and raises an event
 * and an alarm at once; anything that narrows it is immediate. The lock controls cash-outs only:
 * it does not stop KSHS transfers to other wallets.
 */
final class PayoutDestinations
{
    public function __construct(private Kakitu $client)
    {
    }

    /**
     * Every saved place, and whether the lock binds: `{data: [...], payout_locked: bool,
     * payout_unlocks_at?: string}`. Each place has `status` `cooling_off` until `active_at`, and a
     * locked merchant can pay only an `active` one.
     *
     * @return array<string,mixed>
     */
    public function list(): array
    {
        return $this->client->request('GET', '/v1/payout-destinations');
    }

    /**
     * Save a place. $destination is the place alone, with no name:
     * `Beneficiary::till(...)->destination()`, or `['type' => 'till', 'till' => '123456']`.
     * Saving a place twice returns the first row with its clock untouched.
     *
     * @param array<string,string> $destination
     * @return array<string,mixed>
     */
    public function save(array $destination): array
    {
        return $this->client->request('POST', '/v1/payout-destinations', [], $destination);
    }

    /**
     * Remove a place, at once.
     *
     * @return array<string,mixed>
     */
    public function remove(string $id): array
    {
        if (trim($id) === '') {
            throw new InvalidArgumentException('A destination id is required.');
        }
        return $this->client->request('DELETE', '/v1/payout-destinations/' . rawurlencode($id));
    }

    /**
     * Lock (at once) or ask to unlock (after the cooling-off). Answers
     * `{payout_locked: bool, payout_unlocks_at?: string}`.
     *
     * @return array<string,mixed>
     */
    public function setLock(bool $locked): array
    {
        return $this->client->request('POST', '/v1/payout-destinations/lock', [], ['locked' => $locked]);
    }
}
