"""The resources added for the rest of the developer API: idempotency where the server demands
it and nowhere else, the one cursor pager, and the shapes that carry caller-produced signatures
the SDK must never invent.
"""
import json

import httpx
import pytest

from kakitu import PAYOUT_STATES, Kakitu
from kakitu.errors import (
    EventNotFoundError, OrderNotFoundError, PayoutLimitExceededError, PayoutNotFoundError,
    PayoutQuoteNotFoundError, PayoutsDisabledError,
)
from kakitu.pagination import Page, auto_paginate

KEY = "0x" + "11" * 32  # obvious placeholder test key


def make(handler, **kw):
    return Kakitu(private_key=KEY, base_url="https://api.test",
                  http_client=httpx.Client(transport=httpx.MockTransport(handler)), **kw)


@pytest.fixture(autouse=True)
def nosleep(monkeypatch):
    import kakitu.client as cl, kakitu.signing as sg
    monkeypatch.setattr(cl.time, "sleep", lambda _s: None)
    monkeypatch.setattr(sg.time, "sleep", lambda _s: None)


def recorder(body, status=200):
    """A handler that records every request and always answers the same body."""
    seen = []

    def h(req):
        seen.append(req)
        return httpx.Response(status, json=body)

    return h, seen


#: A transfer the CALLER signed. The SDK carries these bytes through untouched.
SIGNED = dict(from_address="0xMe", to="0xYou", value_wei="1000000000000000000000",
              deadline=1758240600, v=27, r="0x" + "11" * 32, s="0x" + "22" * 32,
              iv=28, ir="0x" + "33" * 32, is_="0x" + "44" * 32)


# --------------------------------------------------------------- idempotency

def test_methods_that_require_a_key_send_a_generated_one():
    for call in (
        lambda c: c.charges.create(amount=500, phone="0712345678", reference="o-1"),
        lambda c: c.transfers.create(**SIGNED),
        lambda c: c.payouts.create(quote_id="pq_1", **SIGNED),
    ):
        h, seen = recorder({})
        call(make(h))
        key = seen[0].headers.get("idempotency-key")
        assert key and len(key) == 36, f"{seen[0].url} sent no generated key"


def test_methods_that_require_a_key_honour_the_caller_s_own():
    h, seen = recorder({})
    c = make(h)
    c.charges.create(amount=1, phone="p", reference="r", idempotency_key="mine-c")
    c.transfers.create(idempotency_key="mine-t", **SIGNED)
    c.payouts.create(quote_id="q", idempotency_key="mine-p", **SIGNED)
    assert [r.headers["idempotency-key"] for r in seen] == ["mine-c", "mine-t", "mine-p"]


def test_no_key_is_sent_where_the_server_mounts_none():
    """The whole point of the `idempotent` flag: these are POSTs, and they must NOT carry a key."""
    # One body that every parser on this path tolerates; only the headers are under test.
    h, seen = recorder({"address": "0xA", "business_name": "B", "state": "pending"})
    c = make(h)
    c.quotes.create(type="deposit", amount_kes=1000, phone="0712345678")
    c.payouts.quote(amount_kes=1000, beneficiary_phone="254712345678", beneficiary_name="A N")
    c.events.replay("ev-1")
    c.merchants.register(business_name="B", contact_email="a@b.co")
    assert [r.url.path for r in seen] == [
        "/v1/quotes", "/v1/payouts/quote", "/v1/events/ev-1/replay", "/v1/merchants"]
    for r in seen:
        assert "idempotency-key" not in r.headers, f"{r.url.path} must not send a key"


def test_reads_never_send_a_key():
    h, seen = recorder({"data": [], "next_cursor": None})
    c = make(h)
    c.balances.retrieve()
    c.limits.retrieve()
    c.orders.get("o-1")
    c.payouts.get("p-1")
    c.events.list()
    c.payouts.list()
    c.charges.list()
    assert len(seen) == 7
    for r in seen:
        assert "idempotency-key" not in r.headers


# ---------------------------------------------------------------- pagination

def test_auto_paginate_walks_a_two_page_response():
    pages = [Page([1, 2], "cur-2"), Page([3], None)]
    seen = []

    def fetch(cursor):
        seen.append(cursor)
        return pages[len(seen) - 1]

    assert list(auto_paginate(fetch)) == [1, 2, 3]
    assert seen == [None, "cur-2"], "the second page must ask for the first page's next_cursor"


def test_auto_paginate_stops_instead_of_looping_on_a_repeated_cursor():
    n = iter(range(100))
    assert list(auto_paginate(lambda _c: Page([next(n)], "same"))) == [0, 1]


@pytest.mark.parametrize("path,walk", [
    ("/v1/charges", lambda c: c.charges.auto_paging_iter(limit=2)),
    ("/v1/events", lambda c: c.events.auto_paging_iter(limit=2)),
    ("/v1/payouts", lambda c: c.payouts.auto_paging_iter(limit=2)),
])
def test_every_list_pages_the_same_way(path, walk):
    seen = []
    bodies = [
        {"data": [{"id": "a"}, {"id": "b"}], "next_cursor": "op-aque=="},
        {"data": [{"id": "c"}], "next_cursor": None},
    ]

    def h(req):
        seen.append(req)
        return httpx.Response(200, json=bodies[min(len(seen) - 1, 1)])

    rows = list(walk(make(h)))
    assert [r.id for r in rows] == ["a", "b", "c"]
    assert [r.url.raw_path.decode() for r in seen] == [
        f"{path}?limit=2", f"{path}?limit=2&cursor=op-aque%3D%3D"]


def test_list_returns_a_page_that_is_also_a_list():
    h, _ = recorder({"data": [{"id": "p1", "status": "held"}], "next_cursor": "c2"})
    page = make(h).payouts.list(status="held", limit=1)
    assert isinstance(page, list) and len(page) == 1
    assert page[0].status == "held"
    assert page.next_cursor == "c2" and page.has_more is True


def test_last_page_has_no_cursor():
    h, _ = recorder({"data": [], "next_cursor": None})
    page = make(h).events.list()
    assert page == [] and page.next_cursor is None and page.has_more is False


# ------------------------------------------ the caller's signatures, carried

def test_transfer_body_is_the_signed_request_verbatim():
    h, seen = recorder({"id": "0xabc", "status": "pending"})
    t = make(h).transfers.create(**SIGNED)
    assert (t.id, t.status) == ("0xabc", "pending")
    body = json.loads(seen[0].content)
    # `from` and `is` are Python keywords on this side and plain field names on the wire.
    assert body == {"from": "0xMe", "to": "0xYou", "value_wei": "1000000000000000000000",
                    "deadline": 1758240600, "v": 27, "r": "0x" + "11" * 32, "s": "0x" + "22" * 32,
                    "iv": 28, "ir": "0x" + "33" * 32, "is": "0x" + "44" * 32}
    # A string, not a number: through a float this is 1e+21 and the signature will not verify.
    assert isinstance(body["value_wei"], str)


def test_payout_confirm_nests_the_signed_transfer_under_transfer():
    h, seen = recorder({"id": "po_1", "status": "held", "message": "held for review"}, status=202)
    p = make(h).payouts.create(quote_id="pq_9", **SIGNED)
    assert p.status == "held" and p.is_terminal is False
    body = json.loads(seen[0].content)
    assert body["quote_id"] == "pq_9"
    assert body["transfer"]["is"] == "0x" + "44" * 32
    assert "transfer" in body and set(body) == {"quote_id", "transfer"}


# ---------------------------------------------------------------- the shapes

def test_payout_quote_parses_both_eip712_domains():
    h, _ = recorder({
        "quote_id": "pq_1", "amount_kes": 5000, "fee_kes": 50, "send_kes": 5050, "currency": "KES",
        "beneficiary": {"phone": "254712345678", "name": "A Mwangi"},
        "expires_at": "2026-10-25T10:05:00Z", "value_wei": "5050000000000000000000",
        "treasury_address": "0xTreasury", "deadline": 1758240600,
        "eip712": {
            "permit": {"name": "KSHS", "version": "1", "chain_id": 8453, "verifying_contract": "0xTok"},
            "relay": {"name": "Forwarder", "version": "1", "chain_id": 8453, "verifying_contract": "0xFwd"},
        },
    })
    q = make(h).payouts.quote(amount_kes=5000, beneficiary_phone="254712345678", beneficiary_name="A Mwangi")
    assert q.value_wei == "5050000000000000000000" and isinstance(q.value_wei, str)
    # The two domains differ, which is exactly why both are published.
    assert q.permit_domain.verifying_contract == "0xTok"
    assert q.relay_domain.verifying_contract == "0xFwd"
    assert q.beneficiary_name == "A Mwangi"


def test_limits_payout_block_keeps_null_distinct_from_zero():
    h, _ = recorder({
        "withdrawal": {"min_kes": 50, "max_kes": 150000, "source": "live"},
        "payout": {"enabled": True, "max_kes": 70000, "daily_cap_kes": 500000,
                   "hold_above_kes": 20000, "remaining_today_kes": None, "note": "n"},
        "max_staleness_seconds": 300, "note": "n",
    })
    lim = make(h).limits.retrieve()
    assert lim.payout.hold_above_kes == 20000
    # None means "could not be read", NOT an empty budget.
    assert lim.payout.remaining_today_kes is None


def test_limits_has_no_payout_block_for_a_plain_wallet():
    h, _ = recorder({"withdrawal": {"min_kes": 50, "max_kes": 1000, "source": "estimated"},
                     "max_staleness_seconds": 300, "note": "n"})
    assert make(h).limits.retrieve().payout is None


def test_balances_keeps_usdc_as_a_string():
    h, _ = recorder({"kshs": {"amount_kes": 4200, "network": "base"},
                     "usdc": {"amount": "12.345678", "network": "base"}})
    b = make(h).balances.retrieve()
    assert b.kshs_amount_kes == 4200 and b.usdc_amount == "12.345678"


def test_event_replay_returns_the_queued_event_with_the_same_id():
    h, seen = recorder({"id": "ev-7", "type": "charge.paid", "status": "pending", "attempts": 0,
                        "created_at": "2026-10-25T10:00:00Z", "charge_id": "ch_1",
                        "payout_id": None, "payload": {"id": "ev-7"}}, status=202)
    e = make(h).events.replay("ev-7")
    # The id does NOT change on a replay: that is what lets a receiver dedupe.
    assert e.id == "ev-7" and e.status == "pending" and e.attempts == 0
    assert e.payload == {"id": "ev-7"} and e.payout_id is None


def test_ids_are_escaped_into_the_path():
    h, seen = recorder({})
    make(h).orders.get("o1/../admin")
    assert seen[0].url.raw_path.decode() == "/v1/orders/o1%2F..%2Fadmin"


def test_payout_states_are_the_seven_the_server_publishes():
    assert PAYOUT_STATES == ("quoted", "held", "dispatched", "paid", "failed", "cancelled", "expired")


# -------------------------------------------------------------- error codes

@pytest.mark.parametrize("code,status,exc", [
    ("order_not_found", 404, OrderNotFoundError),
    ("event_not_found", 404, EventNotFoundError),
    ("payout_not_found", 404, PayoutNotFoundError),
    ("payout_quote_not_found", 404, PayoutQuoteNotFoundError),
    ("payouts_disabled", 403, PayoutsDisabledError),
    ("payout_daily_cap_exceeded", 429, PayoutLimitExceededError),
])
def test_the_new_codes_get_their_own_exception(code, status, exc):
    h, _ = recorder({"error": {"code": code, "message": "m", "request_id": "r"}}, status=status)
    with pytest.raises(exc) as e:
        make(h).payouts.get("p-1")
    assert e.value.code == code


def test_payout_daily_cap_is_not_retried_as_a_rate_limit():
    """429, but its own budget on its own counter: retrying cannot change the answer."""
    h, seen = recorder({"error": {"code": "payout_daily_cap_exceeded", "message": "m", "request_id": "r"}},
                       status=429)
    with pytest.raises(PayoutLimitExceededError):
        make(h).payouts.get("p-1")
    assert len(seen) == 1
