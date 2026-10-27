# Kakitu Python SDK

Accept M-Pesa payments through the Kakitu developer API. Kakitu authenticates by **signing every request with your wallet key**, not with a bearer token. This SDK does the signing for you, so you never build a signature, a timestamp or a body hash yourself.

## 60-second quickstart

```bash
pip install -e .   # Python 3.10+
export KAKITU_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE   # placeholder: use a secret store in production
```

```python
from kakitu import Kakitu, MerchantNameFrozenError

client = Kakitu()  # reads KAKITU_PRIVATE_KEY; or Kakitu(private_key="0xYOUR_PRIVATE_KEY_HERE")

merchant = client.merchants.register(
    business_name="Mama Njeri Duka",
    contact_email="owner@example.com",
)
print(merchant.state)          # "pending" until a Kakitu operator approves you
print(client.merchants.me())   # read it back
```

Your wallet **address** (derived from the key) is your API credential. Keep the private key out of source control, logs and chat.

## What's covered

| Resource | Methods |
| --- | --- |
| `client.merchants` | `register`, `me` |
| `client.charges` | `create`, `get`, `list`, `auto_paging_iter` |
| `client.transfers` | `create` |
| `client.balances` | `retrieve` |
| `client.orders` | `get` |
| `client.limits` | `retrieve` |
| `client.quotes` | `create` |
| `client.events` | `list`, `auto_paging_iter`, `replay` |
| `client.payouts` | `quote`, `create`, `get`, `list`, `auto_paging_iter` |

```python
charge = client.charges.create(amount=500, phone="0712345678", reference="order-1042")
balances = client.balances.retrieve()          # balances.usdc_amount is a STRING
price = client.quotes.create(type="deposit", amount_kes=1000, phone="0712345678")
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

## Payouts

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

The quote id is **single use** and expires. States are in `kakitu.PAYOUT_STATES`: `quoted`, `held`, `dispatched`, `paid`, `failed`, `cancelled`, `expired`. The last four are terminal (`payout.is_terminal`) and a retry is a **new** payout. `client.limits.retrieve().payout` tells you `hold_above_kes`, `max_kes` and `daily_cap_kes` up front, so you never learn them by being refused.

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
- **Idempotency**: a key is sent only where the server requires one — `charges.create`, `transfers.create`, `payouts.create` — and **never** on `quotes.create`, `payouts.quote` or `events.replay`, which mount no idempotency at all, nor on `merchants.register`, which is an upsert. The generated key lives only in memory and is reused across every automatic retry; pass `idempotency_key="..."` (stored, derived from your order id) so a retry after a crash is safe too. An explicit key is honoured on any method.
- **Retries**: exponential backoff on 5xx, network errors and `rate_limited` (429). Never on 4xx. `daily_cap_exceeded` and `payer_velocity_exceeded` are 429s but are limits, not blips, so they raise immediately. Every retry is re-signed with a fresh timestamp, and the same idempotency key.
- **Replay guard**: the server rejects two identical requests in the same second, so the SDK waits for the next second rather than send one.
- **Clock**: the server accepts timestamps within 120 seconds. If you see `timestamp_out_of_range`, sync your clock.

## Webhooks

```python
from kakitu import verify_webhook, WebhookVerificationError
verify_webhook(raw_body_bytes, request.headers["Kakitu-Signature"], "YOUR_WEBHOOK_SECRET")
```

Header `Kakitu-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`. Pass the **raw** body bytes, not parsed-and-re-serialised JSON: re-marshalling reorders keys and you would verify a different string than the one signed.

Delivery is **at-least-once**. `Kakitu-Event-Id` (and `id` in the payload) is stable across every attempt and across a replay — dedupe on it or you will double-count. Types are in `kakitu.EVENT_TYPES`.

When an endpoint was down and events were abandoned, `client.events.list(status="abandoned")` shows them and `client.events.replay(id)` puts one back in the queue with a fresh budget. Replay answers HTTP 202: nothing has been delivered when it returns, and the event id does not change.

## Why eth-account

The server verifies signatures with go-ethereum's `personal_sign` recovery. `eth-account` is the reference Python implementation of the same EIP-191 scheme, deterministic (RFC 6979) and widely audited, so signatures are byte-identical to Go's. The tests assert exactly that against vectors generated by the server's own `cmd/kakitu-vectors`. Dependencies are pinned (`eth-account==0.14.0`, `httpx==0.28.1`).

## Tests

```bash
pip install -e ".[test]" && pytest
```
