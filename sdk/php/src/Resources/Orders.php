<?php

declare(strict_types=1);

namespace Kakitu\Resources;

use InvalidArgumentException;
use Kakitu\Kakitu;

/** Your own ramp orders — deposits and withdrawals (GET /v1/orders/{id}). */
final class Orders
{
    public function __construct(private Kakitu $client)
    {
    }

    /**
     * Fetch one of your orders.
     *
     * An order belonging to somebody else, one that does not exist, and one this API does not
     * expose are ONE answer with one set of words (`order_not_found`): the API never confirms
     * that another caller's id is real.
     *
     * `status` is a small closed set — awaiting_payment, completed, failed, refunding, refunded
     * — and anything the server has no public name for arrives as `processing`, so a new
     * internal pipeline step can never leak a word into your switch. `expires_at` is present
     * only while the order is awaiting payment.
     *
     * @return array<string,mixed>
     */
    public function get(string $id): array
    {
        if (trim($id) === '') {
            throw new InvalidArgumentException('An order id is required.');
        }
        return $this->client->request('GET', '/v1/orders/' . rawurlencode($id));
    }
}
