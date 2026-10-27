<?php

declare(strict_types=1);

namespace Kakitu;

/**
 * The ONE pagination contract of the Kakitu API.
 *
 * /v1/charges, /v1/events and /v1/payouts page identically (the server's controller/v1_cursor.go):
 * an OPAQUE keyset `cursor`, a `limit` from 1 to 100 that defaults to 20, and a `next_cursor`
 * that is null on the last page.
 *
 * The cursor is opaque by contract: pass `next_cursor` back unchanged and nothing else. Do not
 * parse one, build one, or carry one from one list to another — a cursor minted by one list
 * decodes to a plausible-but-wrong position in another, and the page it returns is quietly
 * incomplete.
 *
 * This class exists so there is exactly one pager in this SDK. Three near-identical copies is
 * how one of them stops following `next_cursor` and returns page one for ever.
 */
final class Pagination
{
    /**
     * Walks every page and yields the rows one at a time.
     *
     * It follows `next_cursor` until the server returns null, so it makes as many requests as
     * there are pages: each is signed, counts against your rate limit, and happens lazily as you
     * consume the generator. `break` out of the loop and no further page is fetched.
     *
     * A `next_cursor` the server repeats verbatim ends the walk rather than looping for ever.
     *
     * @param callable(array<string,scalar>): array<string,mixed> $fetch takes the filters (with
     *        `cursor` already set) and returns one `{data, next_cursor}` page
     * @param array<string,scalar> $filters the caller's filters; any `cursor` in it is ignored
     * @return \Generator<int, array<string,mixed>>
     */
    public static function autoPage(callable $fetch, array $filters = []): \Generator
    {
        unset($filters['cursor']);
        $seen = [];
        while (true) {
            $page = $fetch($filters);
            foreach (($page['data'] ?? []) as $row) {
                yield $row;
            }
            $next = $page['next_cursor'] ?? null;
            if (!is_string($next) || $next === '' || isset($seen[$next])) {
                return;
            }
            $seen[$next] = true;
            $filters['cursor'] = $next;
        }
    }

    /**
     * Collects every page into one array. Convenient for a small, bounded list; for anything
     * that could be large prefer autoPage(), which holds one page in memory at a time.
     *
     * @param callable(array<string,scalar>): array<string,mixed> $fetch
     * @param array<string,scalar> $filters
     * @return list<array<string,mixed>>
     */
    public static function all(callable $fetch, array $filters = []): array
    {
        return iterator_to_array(self::autoPage($fetch, $filters), false);
    }
}
