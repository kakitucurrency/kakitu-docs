<?php

declare(strict_types=1);

namespace Kakitu\Resources;

use InvalidArgumentException;
use Kakitu\Kakitu;
use Kakitu\Pagination;

/**
 * Webhook deliveries: what we sent, where it stands, and a way to ask for it again.
 *
 * GET /v1/events, POST /v1/events/{id}/replay
 *
 * These exist because delivery is at-least-once and best-effort, not guaranteed. An endpoint
 * that was down for a day has events marked `abandoned`; you can see that, read what we tried to
 * send, fix your side and ask for it again — without opening a support ticket. Together with the
 * event id being the dedupe key, this is the whole of your recovery story.
 */
final class Events
{
    public function __construct(private Kakitu $client)
    {
    }

    /**
     * One page of your webhook events, newest first.
     *
     * Filters: type (see {@see \Kakitu\EventType}), status (pending / delivered / abandoned),
     * charge_id, limit (1-100, default 20), cursor. A value outside the closed sets is refused
     * with `invalid_request` rather than quietly matching nothing, so "why is my list empty" is
     * answered instead of hunted.
     *
     * Each row carries `payload` as decoded JSON (the signed body verbatim), `last_error` from a
     * closed vocabulary (http_503, timeout, no_callback_url, ...) and never a raw error string,
     * and exactly one of `charge_id` / `payout_id`.
     *
     * @param array<string,scalar> $filters
     * @return array<string,mixed>
     */
    public function list(array $filters = []): array
    {
        return $this->client->request('GET', '/v1/events', $filters);
    }

    /**
     * Walks every page, yielding one event at a time.
     *
     * @param array<string,scalar> $filters
     * @return \Generator<int, array<string,mixed>>
     */
    public function autoPagingIterator(array $filters = []): \Generator
    {
        return Pagination::autoPage(fn (array $f): array => $this->list($f), $filters);
    }

    /**
     * Put one event back in the delivery queue with a fresh 24h budget, whatever state it was in
     * — abandoned after a day of failures, or delivered and simply lost on your side.
     *
     * NO Idempotency-Key is sent, and the server mounts none: replay is idempotent by
     * construction, since requeuing an already-requeued event sets the same row to the same
     * state.
     *
     * It answers HTTP 202. Nothing has been delivered when this returns: the worker picks the
     * row up on its next tick, and what comes back is the QUEUED state, not a delivery receipt.
     *
     * The event id DOES NOT CHANGE on a replay, which is the point — a receiver that dedupes on
     * it, as the at-least-once contract requires, can tell this is one it may already have seen.
     *
     * @return array<string,mixed>
     */
    public function replay(string $id): array
    {
        if (trim($id) === '') {
            throw new InvalidArgumentException('An event id is required.');
        }
        return $this->client->request('POST', '/v1/events/' . rawurlencode($id) . '/replay');
    }
}
