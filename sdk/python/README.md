# Kakitu Python SDK

A client for the Kakitu developer API.

**Not published.** `kakitu` is not on PyPI: `pip install kakitu` does not work. Install it from this repository (below), or sign requests directly with the complete signers on [Authentication](https://developer.kakitu.org/docs/authentication).

**Status:** merchants apply at [kakitu.org/merchant](https://kakitu.org/merchant) and Kakitu approves them; no API call makes a merchant. Take payment today with a KSHS transfer and a `reference`, and read it with `client.transfers.list`. `charges.create` is not available (coming back as a KSHS payment request), and the payout-sending calls and `payout_destinations.save` are not available (coming back, paid through KCB). See [what is live](https://developer.kakitu.org/docs/going-live#what-is-live).

**Server-side signing is coming soon.** This SDK signs with a hex private key. There is no safe way yet to get the key of a wallet made in the Kakitu app onto a server: the app and the extension do not export one. **Never type your 12 words into a script or tool to work one out.** See [the quickstart](https://developer.kakitu.org/docs/quickstart#server-side-signing).

Kakitu authenticates by **signing every request with your wallet key**, not with a bearer token. This SDK does the signing for you, so you never build a signature, a timestamp or a body hash yourself.

## Quickstart

```bash
# Python 3.10+. Straight from git:
pip install "kakitu @ git+https://github.com/kakitucurrency/kakitu-docs#subdirectory=sdk/python"
# or, from a checkout, inside sdk/python:
pip install -e .
export KAKITU_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE   # placeholder: use a secret store in production
```

```python
from kakitu import Kakitu

client = Kakitu()  # reads KAKITU_PRIVATE_KEY; or Kakitu(private_key="0xYOUR_PRIVATE_KEY_HERE")

print(client.merchants.me().state)   # "pending" until Kakitu approves your kakitu.org/merchant application

# Your payments, newest first, with each payer's reference (the payer's claim, not proof)
for t in client.transfers.auto_paging_iter(limit=100):
    if t.direction == "in":
        print(t.tx_hash, t.amount_kes, t.reference)

# Once approved: contact details and callback URL. This does not make a merchant.
client.merchants.update(business_name="Mama Njeri Duka",   # exactly as you applied
                        contact_email="owner@example.com",
                        callback_url="https://example.com/kakitu/webhook")
```

`merchants.register` is a deprecated alias of `merchants.update`; the route no longer registers anybody. Your wallet **address** (derived from the key) is your API credential. Keep the private key out of source control, logs and chat.

## What's covered

| Resource | Methods |
| --- | --- |
| `client.merchants` | `update` (`register` is a deprecated alias), `me` |
| `client.charges` | `get`, `list`, `auto_paging_iter` (past charges); `create` is not available |
| `client.transfers` | `create`, `list`, `auto_paging_iter` (`GET /transfers`) |
| `client.balances` | `retrieve` |
| `client.orders` | `get` |
| `client.limits` | `retrieve` |
| `client.quotes` | `create`: not available today |
| `client.events` | `list`, `auto_paging_iter`, `replay` |
| `client.payouts` | `get`, `list`, `auto_paging_iter` (past payouts); `request`, `quote`, `create` are not available |
| `client.payout_destinations` | `list`, `remove`, `set_lock`; `save` answers `payouts_disabled` while payouts are off |

```python
balances = client.balances.retrieve()          # balances.usdc_amount is a STRING
page = client.transfers.list(limit=50)         # page.next_before is None on the last page
```

## You sign the money; the SDK signs the request

Two different signatures live in this API, and confusing them is the single most common mistake.

The `X-Kakitu-Signature` this SDK adds to **every** request authenticates *you to the API*. It authorises nothing on chain.

`transfers.create` and `payouts.create` move KSHS out of your wallet, and that needs a signature **you** produce with your own wallet key over on-chain structured data:

- `v` / `r` / `s` — an **EIP-2612 permit**, signed under the **token's** EIP-712 domain.
- `iv` / `ir` / `is_` — an **EIP-712 `Relay(owner,to,value,deadline,nonce)` intent**, signed under the **forwarder's** domain.

**This SDK does not and cannot produce them.** Kakitu holds no keys and signs nothing on your behalf; it only pays the gas. Build both with your own signing stack (`eth_account`, web3.py, a KMS) and pass them in:

```python
transfer = client.transfers.create(
    from_address=client.address, to="0xRecipient",
    value_wei="1000000000000000000000",      # a STRING, always
    deadline=int(time.time()) + 300,
    v=v, r=r, s=s,          # EIP-2612 permit, under the TOKEN domain
    iv=iv, ir=ir, is_=is_,  # EIP-712 Relay intent, under the FORWARDER domain
)
```

`is_` carries a trailing underscore only because `is` is a Python keyword; it goes on the wire as `is`. `from_address` likewise goes out as `from`.

`value_wei` is a **string** and must stay one: through a float `"1000000000000000000000"` becomes `1e+21` and the signature will not verify.

## Payouts (not available)

**Payouts are not available today**: they are coming back, paid through KCB. While they are off, `payouts.quote` and `payouts.request` raise `PayoutsDisabledError` and `payouts.create` raises `PayoutQuoteNotFoundError`. The shape below is the API as it stood and will change.

```python
quote = client.payouts.quote(
    amount_kes=5000,                     # what LANDS on the beneficiary, not what leaves you
    beneficiary_phone="254712345678",
    beneficiary_name="A Mwangi",         # the person PAID; their M-Pesa statement shows this
)
# ...sign quote.value_wei / quote.treasury_address / quote.deadline with your own key, using
#    quote.permit_domain for the permit and quote.relay_domain for the intent...
payout = client.payouts.create(quote_id=quote.quote_id, from_address=client.address,
                               to=quote.treasury_address, value_wei=quote.value_wei,
                               deadline=quote.deadline, v=v, r=r, s=s, iv=iv, ir=ir, is_=is_)

if payout.status == "held":
    # NORMAL, not an error: above your hold_above_kes, a person reviews it before it is sent.
    # Poll client.payouts.get(payout.id) for the outcome.
    ...
```

The quote id is **single use** and expires. The ten states are in `kakitu.PAYOUT_STATES`: `quoted`, `pending_approval`, `approved`, `rejected`, `held`, `dispatched`, `paid`, `failed`, `cancelled`, `expired`. Five are terminal (`paid`, `failed`, `cancelled`, `rejected`, `expired`; `payout.is_terminal`), and a retry is a **new** payout. `client.limits.retrieve().payout` tells you `hold_above_kes`, `max_kes` and `daily_cap_kes` up front, so you never learn them by being refused.

## Pagination

`charges`, `events` and `payouts` page identically: an opaque `cursor`, `limit` 1-100 (default 20), and `next_cursor` that is `None` on the last page. Pass `next_cursor` back unchanged — never parse one, build one, or carry one from one list to another.

```python
for payout in client.payouts.auto_paging_iter(status="held"):
    print(payout.id)          # follows next_cursor for you, one page at a time

page = client.payouts.list(limit=50)   # or hold the cursor yourself
print(len(page), page.next_cursor)     # a Page IS a list, and carries the cursor
```

Each page is a separate signed request against your rate limit, fetched lazily; stop iterating and no further page is requested.

## Errors

Every failure raises a `KakituError` subclass with `.code`, `.message`, `.request_id` (quote the request id to support). Switch on `code`, never on message text:

```python
from kakitu import KakituError
try:
    client.merchants.me()
except KakituError as e:
    if e.code == "merchant_not_registered":
        ...
```

Codes are a closed set (`kakitu.errors.CODES`). Auth failures (HTTP 401) carry `.reason` (`replay`, `bad_signature`, `timestamp_out_of_range`, ...).

The payout codes are **not** the collection ones. `PayoutLimitExceededError` (`payout_daily_cap_exceeded`) is a different budget from `LimitExceededError` (`daily_cap_exceeded`), on a different setting and a different counter — asking an operator to raise your collection cap changes nothing. `PayoutAmountError` is a 400: waiting does not help, a smaller payout does. `PayoutsDisabledError` deliberately does not say whether the global switch or yours is off.

## What happens automatically

- **Signing**: EIP-191 `personal_sign` over `"{METHOD} {path}{?query} {timestamp} {sha256(body)}"`, signed against the exact bytes sent.
- **Idempotency**: a key is sent only where the server requires one — `charges.create`, `transfers.create`, `payouts.create`, `payouts.request` — and **never** on `quotes.create`, `payouts.quote` or `events.replay`, which mount no idempotency at all, nor on `merchants.update`, which moves no money. The generated key lives only in memory and is reused across every automatic retry; pass `idempotency_key="..."` (stored, derived from your order id) so a retry after a crash is safe too. An explicit key is honoured on any method.
- **Retries**: exponential backoff on 5xx, network errors and `rate_limited` (429). Never on 4xx. `daily_cap_exceeded` and `payer_velocity_exceeded` are 429s but are limits, not blips, so they raise immediately. Every retry is re-signed with a fresh timestamp, and the same idempotency key.
- **Replay guard**: the server rejects two identical requests in the same second, so the SDK waits for the next second rather than send one.
- **Clock**: the server accepts timestamps within 120 seconds. If you see `timestamp_out_of_range`, sync your clock.

## Webhooks

```python
from kakitu import verify_webhook, WebhookVerificationError
verify_webhook(raw_body_bytes, request.headers["Kakitu-Signature"], "YOUR_WEBHOOK_SECRET")
```

Header `Kakitu-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`. Pass the **raw** body bytes, not parsed-and-re-serialised JSON: re-marshalling reorders keys and you would verify a different string than the one signed.

Delivery is **at-least-once**. `Kakitu-Event-Id` (and `id` in the payload) is stable across every attempt and across a replay — dedupe on it or you will double-count. The thirteen types are in `kakitu.EVENT_TYPES`; `transfer.received` is the one that matters today. A `payload` read back from `client.events.list` is the same JSON value as the delivery but not the same bytes, so verify signatures on deliveries only.

When an endpoint was down and events were abandoned, `client.events.list(status="abandoned")` shows them and `client.events.replay(id)` puts one back in the queue with a fresh budget. Replay answers HTTP 202: nothing has been delivered when it returns, and the event id does not change.

## Why eth-account

The server verifies signatures with go-ethereum's `personal_sign` recovery. `eth-account` is the reference Python implementation of the same EIP-191 scheme, deterministic (RFC 6979) and widely audited, so signatures are byte-identical to Go's. The tests assert exactly that against vectors generated by the server's own `cmd/kakitu-vectors`. Dependencies are pinned (`eth-account==0.14.0`, `httpx==0.28.1`).

## Tests

```bash
pip install -e ".[test]" && pytest
```
