/**
 * The ONE pagination contract of the Kakitu API.
 *
 * /v1/charges, /v1/events and /v1/payouts page identically (controller/v1_cursor.go): an opaque
 * keyset `cursor`, a `limit` from 1 to 100 that defaults to 20, and a `next_cursor` that is
 * `null` on the last page. The cursor is opaque by contract — pass `next_cursor` back unchanged
 * and nothing else. Do not parse it, build one, or carry one from one list to another.
 *
 * This file exists so there is exactly one pager in this SDK. Three near-identical copies is how
 * one of them quietly stops following `next_cursor` and starts returning page one for ever.
 */

/** One page of a cursor-paged list. `next_cursor` is null on the last page. */
export interface Page<T> {
  data: T[];
  /** Opaque. Pass it back as `cursor` to fetch the next page; null means this was the last. */
  next_cursor: string | null;
}

/** Filters every cursor-paged list accepts. */
export interface PageParams {
  /** 1-100. The server defaults to 20; values outside the range are refused with `invalid_request`. */
  limit?: number;
  /** The previous page's `next_cursor`, unchanged. */
  cursor?: string;
}

/**
 * Walks every page of a list and yields the items one at a time.
 *
 * It follows `next_cursor` until the server returns null, so it makes as many requests as there
 * are pages: each one is signed, counts against your rate limit, and happens lazily as you
 * consume the iterator. Break out of the loop and no further page is fetched.
 *
 * A page that comes back empty while still advertising a `next_cursor` is followed (the server
 * can filter a page to nothing); a `next_cursor` the server repeats verbatim stops the walk
 * rather than looping for ever.
 */
export async function* autoPaginate<T>(
  fetchPage: (cursor: string | undefined) => Promise<Page<T>>,
): AsyncGenerator<T, void, undefined> {
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (;;) {
    const page = await fetchPage(cursor);
    for (const item of page.data ?? []) yield item;
    const next = page.next_cursor;
    if (!next || seen.has(next)) return;
    seen.add(next);
    cursor = next;
  }
}
