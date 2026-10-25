"""Pins the signed string and signature against vectors produced by the Go server's own code
(go run ./cmd/kakitu-vectors). If these fail, nothing will authenticate."""
import json
import pathlib

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct

from kakitu.signing import Signer, build_message, signed_target

V = json.loads((pathlib.Path(__file__).parent / "fixtures" / "go_auth_vectors.json").read_text())
EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"


def _case(name):
    return next(c for c in V["cases"] if c["name"] == name)


def test_get_no_body_exact_string():
    assert build_message("GET", "/profile", 1758240000) == f"GET /profile 1758240000 {EMPTY}"


def test_get_with_query_exact_string():
    assert build_message("GET", "/kyc/state?country=KE&tier=basic", 1758240001) == (
        f"GET /kyc/state?country=KE&tier=basic 1758240001 {EMPTY}")


def test_post_with_body_exact_string():
    body = b'{"amount_kes":1000,"phone":"+254700000000"}'
    assert build_message("POST", "/ramp/deposit", 1758240002, body) == (
        "POST /ramp/deposit 1758240002 7a4c4c0f0333102cffe5a64621024fe6d094cbcc71d771c251a3600c43ac19a6")


@pytest.mark.parametrize("c", V["cases"], ids=lambda c: c["name"])
def test_matches_go_message_and_signature(c):
    s = Signer(V["private_key_hex"])
    assert s.address == V["address"]
    raw = c["path"] + ("?" + c["raw_query"] if c["raw_query"] else "")
    body = c["body"].encode()
    assert build_message(c["method"], signed_target(raw), c["timestamp"], body) == c["message"]
    h = s.sign(c["method"], raw, body, timestamp=c["timestamp"])
    assert h["X-Kakitu-Signature"] == c["signature"]  # byte-identical to Go (v = 27/28)
    assert h["X-Kakitu-Address"] == V["address"]
    assert h["X-Kakitu-Timestamp"] == str(c["timestamp"])
    rec = Account.recover_message(encode_defunct(text=c["message"]), signature=h["X-Kakitu-Signature"])
    assert rec == V["address"]


def test_empty_query_has_no_question_mark():
    assert signed_target("/v1/merchants/me?") == "/v1/merchants/me"


def test_repr_never_contains_key():
    s = Signer(V["private_key_hex"])
    assert V["private_key_hex"][2:] not in repr(s)


def test_bad_key_error_does_not_echo_key():
    with pytest.raises(ValueError) as e:
        Signer("not-a-key-SECRETMARKER")
    assert "SECRETMARKER" not in str(e.value)


def test_identical_request_same_second_is_not_resigned_identically(monkeypatch):
    import kakitu.signing as m
    t = iter([100.0, 100.2, 101.0, 101.0])
    monkeypatch.setattr(m.time, "time", lambda: next(t))
    monkeypatch.setattr(m.time, "sleep", lambda _s: None)
    s = Signer(V["private_key_hex"])
    a = s.sign("GET", "/v1/merchants/me")
    b = s.sign("GET", "/v1/merchants/me")
    assert a["X-Kakitu-Timestamp"] != b["X-Kakitu-Timestamp"]
