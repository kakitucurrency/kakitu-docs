"""What the developer pitch added, as the SDK carries it: a payment reference, typed payout
destinations, approve-first requests, saved destinations and the lock, and the event types that
announce them. Shapes are the server's (controller/v1_payout_c.go, v1_payout_destinations_c.go,
repository/payout_event.go, transfer_notify.go)."""
import json

import httpx
import pytest

from kakitu import (
    CODES, EVENT_TYPES, PAYOUT_STATES, PAYOUT_TERMINAL_STATES, Beneficiary, Kakitu,
)
from kakitu.errors import (
    PayoutApprovalError, PayoutDestinationError, PayoutOpenRequestsExceededError,
)

KEY = "0x" + "11" * 32
SIGNED = dict(from_address="0xMe", to="0xYou", value_wei="1000", deadline=1_758_240_600,
              v=27, r="0x" + "11" * 32, s="0x" + "22" * 32, iv=28, ir="0x" + "33" * 32, is_="0x" + "44" * 32)


def make(body=None, status=200):
    seen = []

    def h(req):
        seen.append(req)
        return httpx.Response(status, json=body if body is not None else {})

    return Kakitu(private_key=KEY, base_url="https://api.test",
                  http_client=httpx.Client(transport=httpx.MockTransport(h))), seen


def sent(req):
    return json.loads(req.content)


@pytest.fixture(autouse=True)
def nosleep(monkeypatch):
    import kakitu.client as cl, kakitu.signing as sg
    monkeypatch.setattr(cl.time, "sleep", lambda _s: None)
    monkeypatch.setattr(sg.time, "sleep", lambda _s: None)


def test_a_reference_rides_on_the_transfer_and_is_absent_without_one():
    c, seen = make({"id": "0xabc", "status": "confirmed"})
    c.transfers.create(reference="ORD-1042", **SIGNED)
    c.transfers.create(**SIGNED)
    assert sent(seen[0])["reference"] == "ORD-1042"
    assert "reference" not in sent(seen[1])


@pytest.mark.parametrize("b,wire", [
    (Beneficiary.phone("254712345678", "Jane"), {"phone": "254712345678", "name": "Jane"}),
    (Beneficiary.till("123456", "Jane Stores"), {"type": "till", "till": "123456", "name": "Jane Stores"}),
    (Beneficiary.paybill("400200", "INV-77", "Landlord"),
     {"type": "paybill", "paybill": "400200", "account": "INV-77", "name": "Landlord"}),
    (Beneficiary.bank("0123456789", "01", "Jane"),
     {"type": "bank", "account": "0123456789", "bank_code": "01", "name": "Jane"}),
])
def test_each_beneficiary_type_goes_on_the_wire_with_only_its_own_fields(b, wire):
    c, seen = make({})
    c.payouts.quote(amount_kes=1000, beneficiary=b)
    assert sent(seen[0])["beneficiary"] == wire


def test_the_old_phone_only_call_still_works_unchanged():
    c, seen = make({})
    c.payouts.quote(amount_kes=1000, beneficiary_phone="254712345678", beneficiary_name="A N")
    assert sent(seen[0])["beneficiary"] == {"phone": "254712345678", "name": "A N"}


def test_a_quote_needs_one_way_of_naming_the_beneficiary():
    c, _ = make({})
    with pytest.raises(ValueError):
        c.payouts.quote(amount_kes=1000)
    with pytest.raises(ValueError):
        c.payouts.quote(amount_kes=1000, beneficiary=Beneficiary.till("123456", "x"),
                        beneficiary_phone="254712345678", beneficiary_name="x")


def test_a_beneficiary_refuses_a_field_that_is_not_its_own():
    with pytest.raises(ValueError):
        Beneficiary("till", name="x", till="123456", phone="254712345678")


def test_a_request_goes_to_requests_with_a_generated_key_and_a_quote_can_name_it():
    c, seen = make({"id": "p-1", "status": "pending_approval"}, 202)
    p = c.payouts.request(amount_kes=9000, beneficiary=Beneficiary.phone("254712345678", "J W"))
    assert seen[0].url.path == "/v1/payouts/requests"
    assert len(seen[0].headers["Idempotency-Key"]) == 36
    assert p.status == "pending_approval"
    c.payouts.quote(amount_kes=9000, beneficiary=Beneficiary.phone("254712345678", "J W"), payout_id="p-1")
    assert sent(seen[1])["payout_id"] == "p-1"


def test_a_typed_beneficiary_comes_back_whole_and_an_approval_has_an_expiry():
    c, _ = make({"id": "p-1", "status": "approved", "amount_kes": 9000, "fee_kes": 0, "send_kes": 0,
                 "currency": "KES", "created_at": "2026-11-07T00:00:00Z",
                 "approval_expires_at": "2026-11-08T00:00:00Z",
                 "beneficiary": {"type": "till", "till": "123456", "name": "Jane Stores"}})
    p = c.payouts.get("p-1")
    assert p.approval_expires_at == "2026-11-08T00:00:00Z"
    assert p.beneficiary == {"type": "till", "till": "123456", "name": "Jane Stores"}
    assert p.beneficiary_type == "till" and p.beneficiary_phone == ""


def test_saved_destinations_and_the_lock_use_the_routes_the_server_mounts_with_no_key():
    c, seen = make({"data": [], "payout_locked": False})
    c.payout_destinations.list()
    c.payout_destinations.save(Beneficiary.till("123456", "ignored").destination())
    c.payout_destinations.remove("d-1")
    c.payout_destinations.set_lock(True)
    assert [(r.method, r.url.path) for r in seen] == [
        ("GET", "/v1/payout-destinations"), ("POST", "/v1/payout-destinations"),
        ("DELETE", "/v1/payout-destinations/d-1"), ("POST", "/v1/payout-destinations/lock")]
    assert sent(seen[1]) == {"type": "till", "till": "123456"}
    assert sent(seen[3]) == {"locked": True}
    assert all("Idempotency-Key" not in r.headers for r in seen)


def test_the_closed_sets_match_the_server():
    assert set(EVENT_TYPES) == {
        "charge.paid", "charge.settled", "charge.failed", "transfer.received",
        "payout.approved", "payout.rejected", "payout.expired", "payout.cancelled", "payout.paid",
        "payout.failed", "payout_destination.added", "payout_destination.removed", "payout_lock.changed"}
    assert set(PAYOUT_STATES) == {
        "quoted", "pending_approval", "approved", "rejected", "held", "dispatched", "paid", "failed",
        "cancelled", "expired"}
    assert set(PAYOUT_TERMINAL_STATES) == {"paid", "failed", "cancelled", "rejected", "expired"}
    assert len(CODES) == 42


@pytest.mark.parametrize("code,status,cls", [
    ("payout_approval_required", 409, PayoutApprovalError),
    ("payout_not_approved", 409, PayoutApprovalError),
    ("payout_approval_mismatch", 409, PayoutApprovalError),
    ("payout_destination_locked", 403, PayoutDestinationError),
    ("payout_destination_not_found", 404, PayoutDestinationError),
    ("payout_destinations_full", 409, PayoutDestinationError),
    ("payout_open_requests_exceeded", 429, PayoutOpenRequestsExceededError),
])
def test_the_new_codes_raise_their_own_exceptions(code, status, cls):
    c, _ = make({"error": {"code": code, "message": "m", "request_id": "r"}}, status)
    with pytest.raises(cls) as e:
        c.payouts.get("p-1")
    assert e.value.code == code
