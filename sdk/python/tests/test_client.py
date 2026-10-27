import httpx
import pytest

import kakitu
from kakitu import Kakitu
from kakitu.errors import AuthenticationError, KakituError, RateLimitedError
from kakitu.webhooks import WebhookVerificationError, compute_signature, verify_webhook

KEY = "0x" + "11" * 32  # obvious placeholder test key


def make(handler, **kw):
    c = Kakitu(private_key=KEY, base_url="https://api.test", http_client=httpx.Client(transport=httpx.MockTransport(handler)), **kw)
    return c


@pytest.fixture(autouse=True)
def nosleep(monkeypatch):
    import kakitu.client as cl, kakitu.signing as sg
    monkeypatch.setattr(cl.time, "sleep", lambda _s: None)
    monkeypatch.setattr(sg.time, "sleep", lambda _s: None)


ME = {"address": "0xA", "business_name": "Duka", "contact_email": "a@b.co", "contact_phone": "",
      "callback_url": "", "state": "pending", "daily_cap_kes": 0, "per_charge_max_kes": 0}

CHARGE = {"id": "ch_1", "reference": "order-1", "amount": 500, "currency": "KES",
          "status": "pending", "created_at": "2026-10-25T10:00:00Z", "paid_at": None,
          "settled_at": None}


def test_me_is_signed_and_parsed():
    seen = {}
    def h(req):
        seen.update(req.headers)
        return httpx.Response(200, json=ME)
    m = make(h).merchants.me()
    assert m.state == "pending"
    assert {"x-kakitu-address", "x-kakitu-timestamp", "x-kakitu-signature"} <= set(seen)
    assert "idempotency-key" not in seen


def test_register_sends_no_key_by_default_but_honours_an_explicit_one():
    # POST /v1/merchants is an upsert and the server mounts NO idempotency on it, so the SDK
    # sends no key. An explicit one is still passed through for a caller who wants it.
    keys = []
    def h(req):
        keys.append(req.headers.get("idempotency-key"))
        return httpx.Response(201, json=ME)
    c = make(h)
    c.merchants.register(business_name="Duka", contact_email="a@b.co")
    c.merchants.register(business_name="Duka", contact_email="a@b.co", idempotency_key="mine-1")
    assert keys == [None, "mine-1"]


def test_retry_5xx_keeps_same_key_and_resigns():
    # On a route that DOES require a key: one key for the whole call, reused by every retry —
    # that is what makes the retry safe — but a fresh signature each time, because the server
    # refuses an identical signed request as a replay.
    calls = []
    def h(req):
        calls.append((req.headers["idempotency-key"], req.headers["x-kakitu-signature"]))
        return httpx.Response(503, json={"error": {"code": "rail_unavailable", "message": "x", "request_id": "r"}}) if len(calls) < 3 else httpx.Response(201, json=CHARGE)
    make(h).charges.create(amount=500, phone="0712345678", reference="order-1")
    assert len(calls) == 3
    assert len({c[0] for c in calls}) == 1, "the idempotency key must not change between retries"
    assert len({c[1] for c in calls}) == 3, "each attempt must be signed afresh"


def test_no_retry_on_4xx():
    n = []
    def h(req):
        n.append(1)
        return httpx.Response(400, json={"error": {"code": "invalid_request", "message": "bad", "request_id": "rid1"}})
    with pytest.raises(kakitu.InvalidRequestError) as e:
        make(h).merchants.me()
    assert len(n) == 1 and e.value.code == "invalid_request" and e.value.request_id == "rid1"


def test_429_rate_limited_retried_but_daily_cap_not():
    n = []
    def h(req):
        n.append(1)
        return httpx.Response(429, json={"error": {"code": "rate_limited", "message": "slow", "request_id": "r"}})
    with pytest.raises(RateLimitedError):
        make(h, max_retries=2).merchants.me()
    assert len(n) == 3
    n.clear()
    def h2(req):
        n.append(1)
        return httpx.Response(429, json={"error": {"code": "daily_cap_exceeded", "message": "cap", "request_id": "r"}})
    with pytest.raises(kakitu.LimitExceededError):
        make(h2).merchants.me()
    assert len(n) == 1


def test_auth_middleware_envelope_parsed():
    def h(req):
        return httpx.Response(401, json={"error": "unauthorized", "reason": "replay"})
    with pytest.raises(AuthenticationError) as e:
        make(h).merchants.me()
    assert e.value.code == "unauthorized" and e.value.reason == "replay"


def test_unknown_code_is_base_error():
    def h(req):
        return httpx.Response(418, json={"error": {"code": "teapot", "message": "m", "request_id": "r"}})
    with pytest.raises(KakituError) as e:
        make(h).merchants.me()
    assert e.value.code == "teapot"


def test_query_signed_as_sent():
    from kakitu.signing import build_message
    from eth_account import Account
    from eth_account.messages import encode_defunct
    def h(req):
        ts = req.headers["x-kakitu-timestamp"]
        msg = build_message("GET", req.url.raw_path.decode(), ts)
        assert req.url.raw_path == b"/v1/charges?status=paid&limit=5"
        rec = Account.recover_message(encode_defunct(text=msg), signature=req.headers["x-kakitu-signature"])
        assert rec == req.headers["x-kakitu-address"]
        return httpx.Response(200, json={"data": []})
    assert make(h).charges.list(status="paid", limit=5) == []


def test_repr_hides_key():
    assert "11" * 32 not in repr(make(lambda r: httpx.Response(200, json=ME)))


def test_webhook_verify():
    body = b'{"id":"ev_1"}'
    hdr = compute_signature("shhh", 1700000000, body)
    assert verify_webhook(body, hdr, "shhh", now=1700000100)
    with pytest.raises(WebhookVerificationError):
        verify_webhook(body + b" ", hdr, "shhh", now=1700000100)
    with pytest.raises(WebhookVerificationError):
        verify_webhook(body, hdr, "shhh", now=1700009999)
    with pytest.raises(WebhookVerificationError):
        verify_webhook(body, "garbage", "shhh")
