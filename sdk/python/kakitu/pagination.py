"""The ONE pagination contract of the Kakitu API.

``/v1/charges``, ``/v1/events`` and ``/v1/payouts`` page identically (the server's
``controller/v1_cursor.go``): an **opaque** keyset ``cursor``, a ``limit`` from 1 to 100 that
defaults to 20, and a ``next_cursor`` that is ``None`` on the last page.

The cursor is opaque by contract: pass ``next_cursor`` back unchanged and nothing else. Do not
parse one, build one, or carry one from one list to another — a cursor minted by one list
decodes to a plausible-but-wrong position in another, and the page it returns is quietly
incomplete.

This module exists so there is exactly one pager in this SDK. Three near-identical copies is how
one of them stops following ``next_cursor`` and returns page one for ever.
"""
from __future__ import annotations

from typing import Any, Callable, Iterator, TypeVar

T = TypeVar("T")


class Page(list):  # type: ignore[type-arg]
    """One page of a cursor-paged list.

    It **is** a list of the page's items, so ``for row in page``, ``len(page)``, ``page[0]`` and
    ``page == []`` all work. It also carries the cursor:

        page = client.payouts.list(status="held")
        for p in page: ...
        if page.next_cursor:
            page = client.payouts.list(status="held", cursor=page.next_cursor)

    Most callers want ``auto_paging_iter()`` on the resource instead, which does that loop.
    """

    #: Opaque. Pass back as ``cursor`` for the next page; ``None`` means this was the last page.
    next_cursor: str | None

    def __init__(self, items: list[Any], next_cursor: str | None = None) -> None:
        super().__init__(items)
        self.next_cursor = next_cursor

    @property
    def has_more(self) -> bool:
        return self.next_cursor is not None

    @classmethod
    def from_response(cls, body: Any, parse: Callable[[dict[str, Any]], T]) -> "Page":
        """Builds a page from the server's ``{"data": [...], "next_cursor": ...}`` envelope.

        A bare list (no envelope) is accepted as a single, final page so an older or stubbed
        response does not blow up — it simply has no next cursor.
        """
        if isinstance(body, dict):
            return cls([parse(i) for i in (body.get("data") or [])], body.get("next_cursor") or None)
        return cls([parse(i) for i in (body or [])], None)


def auto_paginate(fetch_page: Callable[[str | None], Page]) -> Iterator[Any]:
    """Walks every page and yields the items one at a time.

    It follows ``next_cursor`` until the server returns ``None``, so it makes as many requests as
    there are pages: each is signed, counts against your rate limit, and happens lazily as you
    consume the iterator. Stop iterating and no further page is fetched.

    A ``next_cursor`` the server repeats verbatim ends the walk rather than looping for ever.
    """
    cursor: str | None = None
    seen: set[str] = set()
    while True:
        page = fetch_page(cursor)
        yield from page
        nxt = page.next_cursor
        if not nxt or nxt in seen:
            return
        seen.add(nxt)
        cursor = nxt
