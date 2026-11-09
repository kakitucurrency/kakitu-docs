---
sidebar_position: 7
title: Payouts
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Payouts

:::warning Payouts are off until an operator switches them on for you
Payouts are switched on for the platform (since 30 October 2026), but each merchant starts with its own payout switch off. Until we switch it on for yours, every route that prices or sends a payout answers `403 payouts_disabled`. To take your own takings out meanwhile, [cash out](./cash-out) from the Kakitu app.
:::

A payout sends shillings **out** — from your KSHS balance to an M-Pesa number, a till, a paybill or a bank account. You price it, you sign it with your own key, and we hand the signed result to the partner that pays the beneficiary.

It is the opposite direction from [collections](./collections), and it is deliberately not the same object with the sign flipped. A charge is money arriving; a payout is money leaving, and the permissions, the caps and the counters behind the two are separate from end to end.

## Payouts are off by default

**Read this before you write any of it.** There are two switches and both must be on: the platform's, which an operator controls for everybody (on today), and your merchant's own, which is off until an operator switches it on for you. While either is off, the two routes that price and send a payout — `POST /v1/payouts/quote` and `POST /v1/payouts` — answer an approved merchant with:

```json
HTTP 403
{
  "error": {
    "code": "payouts_disabled",
    "message": "This merchant is not switched on for payouts. Contact support to enable them.",
    "request_id": "…"
  }
}
```

Being `approved` is not enough. Approval lets you collect; it does not let you pay out. These are two decisions, taken by a person, and the second is not implied by the first — write to **kakitu@kakitu.org** and ask for payouts specifically.

A merchant that is not approved gets `403 merchant_not_approved` first, before the switches are looked at. The two **read** routes, `GET /v1/payouts` and `GET /v1/payouts/{id}`, never answer `payouts_disabled`: see [who can call these](#who-can-call-these).

One code covers both switches on purpose. Which of the two is off is an operator's business, and an endpoint that told you would let anyone probe how the platform is configured.

## Who can call these

An **approved** merchant with payouts switched on. The refusals are the same ones the rest of the API uses: an unsigned request gets `401 unauthorized`, a wallet that never registered gets `404 merchant_not_registered`, a `pending` or `rejected` one gets `403 merchant_not_approved`, and a suspended one gets `403 merchant_suspended`.

`GET /v1/payouts/{id}` and `GET /v1/payouts` are the exception: they only need a signed request, and they scope by the signing address. A wallet that is not a merchant simply has no payouts — the single read answers `404 payout_not_found` and the list answers an empty page.

## Payout caps are not your collection caps

**A merchant approved to collect 100,000 a day is not thereby approved to pay out anything.** They are separate settings, on a separate counter, with their own error codes:

| Limit | `code` | HTTP |
|---|---|---|
| Payouts are switched off | `payouts_disabled` | 403 |
| The day's payout budget is spent | `payout_daily_cap_exceeded` | 429 |
| Over the largest single payout allowed | `payout_amount_above_maximum` | 400 |

None of these is `daily_cap_exceeded`, and they never will be. That code is the **collection** cap, and an integrator told `daily_cap_exceeded` when it is the payout budget that ran out goes and asks an operator to raise the collection number — which changes nothing, and leaves the real limit a mystery. Branch on the payout codes.

The daily payout budget resets at **midnight East Africa Time**, not UTC.

**You do not have to discover your own numbers by being refused.** [`GET /v1/limits`](./limits#payout-limits) publishes them: your per-payout maximum, your daily cap, what is left of today's budget, and the threshold above which a payout needs a person to [approve it first](#approve-first). They are read from the same place the refusals above read them, so they cannot disagree.

The budget is checked twice: at quote time, so you learn you are over it **before** you sign anything, and again when you confirm, which is the call that actually spends it — before the signed transfer is checked ([why that matters](#the-quote-is-single-use-and-yours-alone)). A payout that is accepted and then fails has still spent the day's budget — there is no refund path, because a counter that could be refunded is a counter that can be raced.

## The shape of it

Three calls, in this order, for a payout **at or below** your `hold_above_kes`:

```http
POST /v1/payouts/quote   price it, and get back exactly what to sign
POST /v1/payouts         send the quote id and the signed transfer
GET  /v1/payouts/{id}    read where it got to
```

**Above** `hold_above_kes` a person decides first, so there is one more call in front:

```http
POST /v1/payouts/requests   ask a person; nothing is signed or priced yet
                            ... you receive payout.approved ...
POST /v1/payouts/quote      the same, with the approved payout_id
POST /v1/payouts            the signature lands on the approved payout
```

And for afterwards, and for where your payouts may go:

```http
GET  /v1/payouts                       everything you have sent, newest first
GET  /v1/payout-destinations           the places you have saved, and whether the lock binds
POST /v1/payout-destinations           save a place
DELETE /v1/payout-destinations/{id}    remove one
POST /v1/payout-destinations/lock      lock, or ask to unlock
```

[Approve first](#approve-first) and [saved destinations and the lock](#saved-destinations-and-the-lock) are further down.
## Running these examples

Every example on this page is **signed**. An unsigned request is `401 unauthorized`, so a
shorter version would not be worth printing.

None of them writes a fourth signer. The TypeScript, Python and PHP snippets call the complete
programs on [Authentication](./authentication): save those three beside your script as
`kakitu.mjs`, `kakitu.py` and `kakitu.php`, and export `KAKITU_PRIVATE_KEY` before running
anything. cURL cannot sign by itself, so the shell examples make the same EIP-191 signature
through one helper function that calls Foundry's `cast`.

<details>
<summary><code>kakitu.sh</code> &mdash; the shell signer every cURL example on this page calls</summary>

```bash title="kakitu.sh"
# kakitu.sh - sign a Kakitu request from the shell and send it.
#   Needs curl, openssl and Foundry's `cast` (https://getfoundry.sh).
#   Keep the key in the environment or a secret store: KAKITU_PRIVATE_KEY=0x...
#   Never in a script, a ticket, or your shell history.
KAKITU_BASE_URL=${KAKITU_BASE_URL:-https://walletapi.kakitu.org}

# kakitu METHOD TARGET [BODY] [extra curl args...]
kakitu() {
  local method=$1 target=$2 body=${3-}
  shift $(( $# < 3 ? $# : 3 ))
  local ts hash addr sig
  ts=$(date +%s)                                   # seconds, within 120s of server time
  hash=$(printf '%s' "$body" | openssl dgst -sha256 | awk '{print $NF}')
  addr=$(cast wallet address --private-key "$KAKITU_PRIVATE_KEY")
  # `cast wallet sign` is EIP-191 personal_sign - the same thing the other three programs do.
  sig=$(cast wallet sign --private-key "$KAKITU_PRIVATE_KEY" "$method $target $ts $hash")
  # An array, not an unquoted ${body:+...}: that splits differently in bash and zsh.
  local args=(-sS -X "$method" "$KAKITU_BASE_URL$target"
    -H "X-Kakitu-Address: $addr"
    -H "X-Kakitu-Timestamp: $ts"
    -H "X-Kakitu-Signature: $sig")
  [ -n "$body" ] && args+=(-H "Content-Type: application/json" --data-raw "$body")
  curl "${args[@]}" "$@"
}
```

`source kakitu.sh` once per shell, then call `kakitu METHOD TARGET [BODY] [curl args...]`.
`TARGET` is the path plus `?query` when there is one, byte for byte as it will be sent: the
query string is inside the signed message, so quote it and change it nowhere else.

</details>


## POST /v1/payouts/quote

Signed request. **No `Idempotency-Key`**, because a quote creates no payout and moves no money.

```http
POST /v1/payouts/quote
Content-Type: application/json

{
  "amount_kes": 1000,
  "beneficiary": {
    "phone": "254712345678",
    "name": "Jane Wanjiru"
  }
}
```

| Field | Type | Rules |
|---|---|---|
| `payout_id` | string, optional | The id of a request a person has [approved](#approve-first). **Required** for a payout above your `hold_above_kes`, and then `amount_kes` and `beneficiary` must be what was approved. |
| `amount_kes` | integer, required | A whole number of shillings, at least 1. It is what **lands on the beneficiary**, not what leaves you. |
| `beneficiary.type` | string, optional | `phone` (the default), `till`, `paybill` or `bank`. See [where a payout can go](#where-a-payout-can-go). |
| `beneficiary.phone` | string | **Phone.** A Kenyan mobile number, `254` then `7` or `1` then eight digits: `^254[17]\d{8}$`. No `+`, no leading `0`. |
| `beneficiary.name` | string, required | The person or business being paid, 1 to 100 **bytes** after trimming (a non-ASCII letter takes two or more). See below. |

The other beneficiary fields are `till`, `paybill`, `account` and `bank_code`, in [the next section](#where-a-payout-can-go).

Unknown fields are refused with `invalid_request` rather than ignored. On a route that authorises money leaving, a mistyped field name must be a refusal and not an instruction that was silently dropped. The body is limited to 4 KiB (`request_too_large`, 413).

### Where a payout can go

`beneficiary.type` says which kind of place it is, and each type takes **exactly** its own fields. Give a field of another type, or a field with no `type` to go with it, and the body is `400 invalid_request`: it is refused, never guessed at. A body with a `phone` and no `type` still means phone, exactly as before types existed.

| `type` | Fields | Notes |
|---|---|---|
| `phone` (or none) | `phone` | An M-Pesa number. |
| `till` | `till` | A Buy Goods till number, 5 to 9 digits. A number that is not a till is refused at the quote, before anything is signed. |
| `paybill` | `paybill`, `account` | A paybill number (5 to 9 digits) and the account to credit (1 to 40 letters, digits, spaces, dots, underscores or dashes). **Open only once it is a [saved destination](#saved-destinations-and-the-lock) past its cooling-off.** Otherwise `403 bank_unavailable`. |
| `bank` | `account`, `bank_code` | A bank account. `bank_code` must be on the bank list (`unknown_bank`) and the bank must hold the account (`account_not_found`). **Open only once it is a saved destination past its cooling-off.** |

A bank is paid under the name **the bank gave** when you saved it, whatever `beneficiary.name` says: you cannot pay a bank account under a name it does not carry. A bank that later holds the account under a different name is refused with `account_not_found`; remove it and save it again to read the new name.

The answers carry the beneficiary back in the same shape you sent it. A phone payout's has no `type`, so test for `type` being absent, not for the string `"phone"`.

```json
{ "type": "till",    "till": "123456", "name": "Jane Stores" }
{ "type": "paybill", "paybill": "400200", "account": "INV-77", "name": "Landlord Ltd" }
{ "type": "bank",    "account": "0123456789", "bank_code": "01", "name": "Jane Wanjiru" }
```

### The beneficiary name is yours to supply

**It is what the recipient sees on their M-Pesa statement, and it is taken from this request — never from your own merchant profile.** If you are paying Jane, put Jane's name here. Leaving it to be filled in from the sender's profile is exactly how a recipient ends up looking at a stranger's name against money they were expecting, and it is not something we will guess for you. The name is required for every type, and so is the number: money must not leave without a place to send it to, and the recipient must not be shown the wrong person.

<Tabs groupId="lang">
<TabItem value="curl" label="cURL" default>

```bash
# NO Idempotency-Key on this route: a quote creates no payout and moves no money.
kakitu POST /v1/payouts/quote \
  '{"amount_kes":1000,"beneficiary":{"phone":"254712345678","name":"Jane Wanjiru"}}'
```

`amount_kes` is what LANDS on Jane. `send_kes` is what leaves you, and `value_wei` is that
same number in wei &mdash; the one the permit must be for. `beneficiary.name` is taken from
this request and never from your merchant profile.

</TabItem>
<TabItem value="ts" label="TypeScript">

```ts title="payout-quote.mjs"
import { Wallet } from "ethers";
import { call } from "./kakitu.mjs";

const wallet = new Wallet(process.env.KAKITU_PRIVATE_KEY);

// NO Idempotency-Key on this route: a quote creates no payout and moves no money, so call()
// from the Authentication page - which sends none - is exactly right here.
const { status, body: quote } = await call(wallet, "POST", "/v1/payouts/quote", {
  amount_kes: 1000,                                     // what LANDS on the beneficiary
  beneficiary: { phone: "254712345678", name: "Jane Wanjiru" },   // never from your profile
});

console.log(quote.quote_id);          // "pq_..." - opaque, single-use, yours alone
console.log(quote.send_kes);          // what leaves your wallet
console.log(quote.value_wei);         // send_kes in wei, a STRING. Sign this, exactly.
console.log(quote.treasury_address);  // the `to` of the transfer - NOT the beneficiary
console.log(quote.deadline);          // the LATEST deadline that will be accepted
```

</TabItem>
<TabItem value="py" label="Python">

```python title="payout_quote.py"
import os

from eth_account import Account
from kakitu import call

account = Account.from_key(os.environ["KAKITU_PRIVATE_KEY"])

# NO Idempotency-Key on this route: a quote creates no payout and moves no money, so call()
# from the Authentication page - which sends none - is exactly right here.
status, quote = call(account, "POST", "/v1/payouts/quote", {
    "amount_kes": 1000,                                  # what LANDS on the beneficiary
    "beneficiary": {"phone": "254712345678", "name": "Jane Wanjiru"},   # never from your profile
})

print(quote["quote_id"])           # "pq_..." - opaque, single-use, yours alone
print(quote["send_kes"])           # what leaves your wallet
print(quote["value_wei"])          # send_kes in wei, a str. Sign this, exactly.
print(quote["treasury_address"])   # the `to` of the transfer - NOT the beneficiary
print(quote["deadline"])           # the LATEST deadline that will be accepted
```

</TabItem>
<TabItem value="php" label="PHP">

```php title="payout-quote.php"
<?php
declare(strict_types=1);
require __DIR__ . '/kakitu.php';

// NO Idempotency-Key on this route: a quote creates no payout and moves no money, so
// kakitu_call() from the Authentication page - which sends none - is exactly right here.
[$status, $quote] = kakitu_call(getenv('KAKITU_PRIVATE_KEY'), 'POST', '/v1/payouts/quote', [
    'amount_kes' => 1000,                                 // what LANDS on the beneficiary
    'beneficiary' => ['phone' => '254712345678', 'name' => 'Jane Wanjiru'],  // never your profile
]);

echo $quote['quote_id'], PHP_EOL;           // "pq_..." - opaque, single-use, yours alone
echo $quote['send_kes'], PHP_EOL;           // what leaves your wallet
echo $quote['value_wei'], PHP_EOL;          // send_kes in wei, a string. Sign this, exactly.
echo $quote['treasury_address'], PHP_EOL;   // the `to` of the transfer - NOT the beneficiary
echo $quote['deadline'], PHP_EOL;           // the LATEST deadline that will be accepted
```

</TabItem>
</Tabs>

### The response

```json
HTTP 200
{
  "quote_id": "pq_4f3e8a0d77c1e2b3a4d5…",
  "amount_kes": 1000,
  "fee_kes": 25,
  "send_kes": 1025,
  "currency": "KES",
  "beneficiary": { "phone": "254712345678", "name": "Jane Wanjiru" },
  "expires_at": "2026-10-26T09:16:02Z",
  "value_wei": "1025000000000000000000",
  "treasury_address": "0x…",
  "deadline": 1761480300,
  "eip712": {
    "permit": { "name": "Kakitu", "version": "1", "chain_id": 8453, "verifying_contract": "0x…" },
    "relay":  { "name": "KakituForwarder", "version": "1", "chain_id": 8453, "verifying_contract": "0x…" }
  }
}
```

| Field | Meaning |
|---|---|
| `payout_id` | Present only when you quoted an [approved request](#approve-first): the payout your signature will land on. |
| `quote_id` | Ours: `pq_` and 64 hex characters. The only thing `POST /v1/payouts` accepts. Treat it as opaque. See [below](#the-quote-is-single-use-and-yours-alone). |
| `amount_kes` | What lands on the beneficiary. The number you asked for. |
| `fee_kes` | Kakitu's fee. |
| `send_kes` | What leaves your wallet. This is the number the permit must be for. |
| `expires_at` | When this price stops being the price. |
| `value_wei` | `send_kes` in the token's smallest unit, as a decimal string. Sign **this**, exactly. |
| `treasury_address` | The `to` of the transfer you sign. Not the beneficiary — the beneficiary is paid in shillings by the rail, off chain. |
| `deadline` | The **latest** deadline that will be accepted. An earlier one is fine. |
| `eip712` | Both domains you sign under, so neither has to be guessed. |

There is no rail name, no partner quote id and no order id in it, and there never will be.

### Signing it

A payout is signed exactly like a [transfer](./transfers#signing-a-transfer): the same two signatures, over the same two typed-data structures, with the same single nonce read before you sign. The permit authorises the forwarder to move `value_wei` of your KSHS; the intent names where it goes. Read that page once and this one needs no second explanation.

The only difference is that you do not choose the fields. `to` is the quote's `treasury_address`, `value_wei` is the quote's exactly, and `from` is your own address. The `eip712` block above gives you both domains rather than leaving you to assemble them from `GET /config`.

## POST /v1/payouts

Signed request. **`Idempotency-Key` is required** — without it, `400 idempotency_key_required` and nothing is sent. This is the call that authorises money leaving, and a route that does that does not run without run-once.

```http
POST /v1/payouts
Content-Type: application/json
Idempotency-Key: 8ab0f6c4-6c38-4f0e-9a7e-6b0a2f6b1d33

{
  "quote_id": "pq_4f3e8a0d77c1e2b3a4d5…",
  "transfer": {
    "from": "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
    "to": "0x…",
    "value_wei": "1025000000000000000000",
    "deadline": 1761480300,
    "v": 27, "r": "0x…", "s": "0x…",
    "iv": 28, "ir": "0x…", "is": "0x…"
  }
}
```

`transfer` is the same object `POST /v1/transfers` takes. Unknown fields are refused here too.

Four things about the signed transfer are checked against the quote before a row is written, and a mismatch in any of them is `invalid_request` with nothing sent:

- `from` must be your own wallet — the one that signed the HTTP request.
- `to` must be the quote's `treasury_address`.
- `value_wei` must be the quote's **exactly**. Not more, not less.
- `deadline` must be in the future and **no later than** the quote's. Earlier is your own business; later is a signature the rail would refuse after you had already signed it.

<Tabs groupId="lang">
<TabItem value="curl" label="cURL" default>

Needs `kakitu.sh` from the top of this page and `sign_transfer` from
[transfer.sh](./transfers#a-complete-example) &mdash; a payout is signed exactly as a transfer is.

```bash title="payout.sh"
# . ./kakitu.sh && . ./transfer.sh && . ./payout.sh

# 1. Price it. No Idempotency-Key: a quote creates nothing.
Q=$(kakitu POST /v1/payouts/quote \
     '{"amount_kes":1000,"beneficiary":{"phone":"254712345678","name":"Jane Wanjiru"}}')

# The quote names both EIP-712 domains, so neither has to be guessed. Check them rather
# than assume: a permit signed under the wrong domain fails silently.
jq -e --argjson c "$(kakitu_cfg)" \
  '.eip712.permit.verifying_contract == $c.kshs_contract
   and .eip712.relay.verifying_contract == $c.forwarder' <<<"$Q" >/dev/null \
  || { echo "the quote names contracts /config does not - stop here"; return 1; }

# 2. Sign EXACTLY what the quote says: to = treasury_address (not the beneficiary),
#    value_wei the quote's exactly, deadline no later than the quote's. 60s of headroom.
T=$(sign_transfer "$(jq -r .treasury_address <<<"$Q")" \
                  "$(jq -r .value_wei        <<<"$Q")" \
                  "$(( $(jq -r .deadline <<<"$Q") - 60 ))")

# 3. Confirm. Idempotency-Key is REQUIRED here: this is the call that authorises money leaving.
kakitu POST /v1/payouts \
  "$(jq -nc --arg q "$(jq -r .quote_id <<<"$Q")" --argjson t "$T" '{quote_id:$q, transfer:$t}')" \
  -H "Idempotency-Key: $(uuidgen)"
```

`202`. `"status":"dispatched"` means the money is leaving; read the outcome from
`GET /v1/payouts/{id}`, or wait for `payout.paid` or `payout.failed`. Branch on `status`, never on
`message`.

</TabItem>
<TabItem value="ts" label="TypeScript">

```ts title="payout.mjs"
// node payout.mjs - needs kakitu.mjs (Authentication) and transfer.mjs (Transfers) beside it.
import { randomUUID } from "node:crypto";
import { Wallet } from "ethers";
import { call, signedHeaders } from "./kakitu.mjs";
import { config, signTransfer } from "./transfer.mjs";

const BASE_URL = "https://walletapi.kakitu.org";
const wallet = new Wallet(process.env.KAKITU_PRIVATE_KEY);

// 1. Price it. No Idempotency-Key: a quote creates nothing.
const { body: quote } = await call(wallet, "POST", "/v1/payouts/quote", {
  amount_kes: 1000,
  beneficiary: { phone: "254712345678", name: "Jane Wanjiru" },
});

// 2. Sign it. A payout is signed exactly like a transfer - same two signatures, same single
// nonce - so signTransfer() from the Transfers page is reused unchanged. The quote hands you
// both EIP-712 domains, so nothing is guessed; only the RPC URL still comes from /config.
const cfg = {
  chain_id: quote.eip712.permit.chain_id,
  kshs_contract: quote.eip712.permit.verifying_contract,
  forwarder: quote.eip712.relay.verifying_contract,
  public_rpc_url: (await config()).public_rpc_url,
};
const transfer = await signTransfer(
  wallet,
  cfg,
  quote.treasury_address,          // the `to` is the TREASURY, not the beneficiary
  BigInt(quote.value_wei),         // the quote's value exactly - not more, not less
  BigInt(quote.deadline) - 60n,    // no later than the quote's; earlier is your business
);

// 3. Confirm. Idempotency-Key is REQUIRED: this is the call that authorises money leaving.
const raw = JSON.stringify({ quote_id: quote.quote_id, transfer });
const headers = await signedHeaders(wallet, "POST", "/v1/payouts", raw);
headers["Content-Type"] = "application/json";
headers["Idempotency-Key"] = randomUUID();

const res = await fetch(BASE_URL + "/v1/payouts", { method: "POST", headers, body: raw });
const out = await res.json();
console.log(res.status, out.status);   // 202, then "dispatched"

// Branch on status, never on message. "dispatched" is on its way: wait for the payout.paid
// or payout.failed event, or poll GET /v1/payouts/{id}. A retry after a failure is a NEW payout.
if (out.status !== "dispatched") console.log(out.message);
```

</TabItem>
<TabItem value="py" label="Python">

```python title="payout.py"
# python payout.py - needs kakitu.py (Authentication) and transfer.py (Transfers) beside it.
import json
import os
import uuid

import requests
from eth_account import Account
from kakitu import BASE_URL, call, signed_headers
from transfer import config, sign_transfer

account = Account.from_key(os.environ["KAKITU_PRIVATE_KEY"])

# 1. Price it. No Idempotency-Key: a quote creates nothing.
_, quote = call(account, "POST", "/v1/payouts/quote", {
    "amount_kes": 1000,
    "beneficiary": {"phone": "254712345678", "name": "Jane Wanjiru"},
})

# 2. Sign it. A payout is signed exactly like a transfer - same two signatures, same single
# nonce - so sign_transfer() from the Transfers page is reused unchanged. The quote hands you
# both EIP-712 domains, so nothing is guessed; only the RPC URL still comes from /config.
cfg = {
    "chain_id": quote["eip712"]["permit"]["chain_id"],
    "kshs_contract": quote["eip712"]["permit"]["verifying_contract"],
    "forwarder": quote["eip712"]["relay"]["verifying_contract"],
    "public_rpc_url": config()["public_rpc_url"],
}
transfer = sign_transfer(
    account,
    cfg,
    quote["treasury_address"],   # the `to` is the TREASURY, not the beneficiary
    int(quote["value_wei"]),     # the quote's value exactly - not more, not less
    quote["deadline"] - 60,      # no later than the quote's; earlier is your business
)

# 3. Confirm. Idempotency-Key is REQUIRED: this is the call that authorises money leaving.
raw = json.dumps({"quote_id": quote["quote_id"], "transfer": transfer},
                 separators=(",", ":")).encode()
headers = signed_headers(account, "POST", "/v1/payouts", raw)
headers["Content-Type"] = "application/json"
headers["Idempotency-Key"] = str(uuid.uuid4())

res = requests.post(BASE_URL + "/v1/payouts", headers=headers, data=raw, timeout=30)
out = res.json()
print(res.status_code, out["status"])   # 202, then "dispatched"

# Branch on status, never on message. "dispatched" is on its way: wait for the payout.paid
# or payout.failed event, or poll GET /v1/payouts/{id}. A retry after a failure is a NEW payout.
if out["status"] != "dispatched":
    print(out["message"])
```

</TabItem>
<TabItem value="php" label="PHP">

```php title="payout.php"
<?php
// php payout.php - needs kakitu.php (Authentication) and transfer.php (Transfers) beside it.
declare(strict_types=1);
require __DIR__ . '/transfer.php';   // which itself requires kakitu.php

$key = getenv('KAKITU_PRIVATE_KEY');

// 1. Price it. No Idempotency-Key: a quote creates nothing.
[, $quote] = kakitu_call($key, 'POST', '/v1/payouts/quote', [
    'amount_kes' => 1000,
    'beneficiary' => ['phone' => '254712345678', 'name' => 'Jane Wanjiru'],
]);

// 2. Sign it. A payout is signed exactly like a transfer - same two signatures, same single
// nonce - so kakitu_sign_transfer() from the Transfers page is reused unchanged. The quote
// hands you both EIP-712 domains; only the RPC URL still comes from /config.
$cfg = [
    'chain_id' => $quote['eip712']['permit']['chain_id'],
    'kshs_contract' => $quote['eip712']['permit']['verifying_contract'],
    'forwarder' => $quote['eip712']['relay']['verifying_contract'],
    'public_rpc_url' => kakitu_config()['public_rpc_url'],
];
$transfer = kakitu_sign_transfer(
    $key,
    $cfg,
    $quote['treasury_address'],   // the `to` is the TREASURY, not the beneficiary
    $quote['value_wei'],          // the quote's value exactly - not more, not less
    $quote['deadline'] - 60,      // no later than the quote's; earlier is your business
);

// 3. Confirm. Idempotency-Key is REQUIRED: this is the call that authorises money leaving.
[$status, $out] = kakitu_post($key, '/v1/payouts',
    ['quote_id' => $quote['quote_id'], 'transfer' => $transfer],
    ['Idempotency-Key' => bin2hex(random_bytes(16))]);

echo $status, ' ', $out['status'], PHP_EOL;   // 202, then "dispatched"

// Branch on status, never on message. "dispatched" is on its way: wait for the payout.paid
// or payout.failed event, or poll GET /v1/payouts/{id}. A retry after a failure is a NEW payout.
if ($out['status'] !== 'dispatched') {
    echo $out['message'], PHP_EOL;
}
```

</TabItem>
</Tabs>

### The quote is single-use and yours alone

**A quote id can be spent once, by the merchant it was minted for, and only before it expires.** Every other case — a quote that never existed, one that has already been confirmed, one that has lapsed, one belonging to another merchant — gets the same answer:

```json
HTTP 404
{
  "error": {
    "code": "payout_quote_not_found",
    "message": "That payout quote cannot be used: it does not exist, it has expired, or it has already been confirmed. Ask for a new quote at POST /v1/payouts/quote.",
    "request_id": "…"
  }
}
```

They are indistinguishable on purpose. An error that told them apart would say whether another merchant's quote id is real.

**The quote, and that much of the day's budget, are spent before your signature is checked.** `POST /v1/payouts` accepts the quote id first and only then compares the signed transfer with it. A transfer that does not match — wrong `from`, `to`, `value_wei` or `deadline` — is `400 invalid_request` with nothing sent, but the quote is used up and the amount counts against today's cap. Get a new quote, sign exactly what it says, and check your signing code before you retry in a loop.

**A quote id from anywhere else is refused the same way.** `POST /v1/quotes` issues no id at all — it prices a number for you to show somebody — and the wallet app's older `/ramp/*` quotes carry ids that mean nothing here. This route has its own ids in their own namespace, so a quote minted outside it is refused exactly as one that never existed. That is the whole reason this route exists instead of a `type: "payout"` on `/v1/quotes`: a quote obtained from a route with no merchant, no approval and no payout cap behind it must not be spendable at a confirm that has all three. It is also what stops one quote being replayed past the caps.

### The response

A payout answers **`202`**. Nothing has reached the beneficiary when this returns: poll [`GET /v1/payouts/{id}`](#get-v1payoutsid) for the outcome.

```json
HTTP 202
{
  "id": "7c2b18e4-0f2a-4a1b-9a44-1b2c3d4e5f60",
  "status": "dispatched",
  "amount_kes": 1000,
  "fee_kes": 25,
  "send_kes": 1025,
  "currency": "KES",
  "beneficiary": { "phone": "254712345678", "name": "Jane Wanjiru" },
  "created_at": "2026-10-26T09:14:02Z",
  "message": "This payout is on its way to the beneficiary. Poll GET /v1/payouts/{id} for the outcome."
}
```

`message` is our sentence about what is happening now. It is present for `pending_approval`, `approved`, `rejected`, `held` and `dispatched`, and absent otherwise. It is written for a person reading a log; **branch on `status`, never on `message`.**

## Approve first

**A payout above your `hold_above_kes` is decided by a person before you sign anything.** You ask, wait for the answer, and only then quote and sign. `hold_above_kes` is yours to read at [`GET /v1/limits`](./limits#payout-limits); "above" is strict, so a payout exactly at it goes straight through, and a threshold of zero sends everything to a person.

**With today's platform defaults this step does not come up.** On 9 November 2026 the platform's hold threshold was KES 20,000 and its largest single payout was also KES 20,000, so a payout above the threshold is refused as `payout_amount_above_maximum` before approval is considered. Approve-first applies once an operator gives your merchant a per-payout maximum above its hold threshold. Read both numbers at [`GET /v1/limits`](./limits#payout-limits); the amounts in the examples below are illustrative.

It is this way round because the other way cannot work. A signature you make today stops being relayable in about ten minutes, and the price behind it lives for about two; a person working a review queue works in minutes or hours. A request holds nothing that can go stale, so there is no clock on the person at all.

1. **Ask.** `POST /v1/payouts/requests` with the same body as a quote (`amount_kes` and `beneficiary`), and an `Idempotency-Key`. Nothing is priced, signed or counted against your budget. The answer is `202` with `"status": "pending_approval"`.

   ```json
   HTTP 202
   {
     "id": "7c2b18e4-0f2a-4a1b-9a44-1b2c3d4e5f60",
     "status": "pending_approval",
     "amount_kes": 9000,
     "fee_kes": 0,
     "send_kes": 0,
     "currency": "KES",
     "beneficiary": { "phone": "254712345678", "name": "Jane Wanjiru" },
     "created_at": "2026-11-07T09:00:02Z",
     "message": "This payout is waiting for a person to approve it. Nothing has been signed or sent, and there is no time limit on the decision. You will receive payout.approved or payout.rejected."
   }
   ```

   `fee_kes` and `send_kes` are `0` until you quote, because a request is priced when it is signed.

2. **Wait for the answer.** It arrives as a webhook: [`payout.approved`](./events#payoutapproved) or [`payout.rejected`](./events#payoutrejected). Or poll `GET /v1/payouts/{id}`: the status becomes `approved` (with `approval_expires_at`) or `rejected`.

3. **Quote with `payout_id`.** `POST /v1/payouts/quote` with the request's `payout_id` and the **same** `amount_kes` and `beneficiary`. They must match what was approved; a disagreement is `409 payout_approval_mismatch`, and the answer to wanting something different is a new request.

4. **Sign and submit** as for any payout, before `approval_expires_at`. The signature lands on that payout, and it dispatches.

If you quote or submit a payout above the threshold without an approval, you get `409 payout_approval_required` and the message says to ask at `/v1/payouts/requests`.

**`payout.rejected` means a person said no, and you must not ask again.** It can also follow `payout.approved`, if an operator takes the yes back before you have signed. Nothing was signed, nothing was sent and none of the day's budget was spent. **`payout.expired` after an approval means you did not sign in time.** Nothing was sent; make a new request.

**The day's budget is counted once, when you sign**, not when you ask. A request that waits, is rejected or lapses spends nothing.

You can have only so many requests waiting at once (20 by default). Past that, `429 payout_open_requests_exceeded`: a decision or a lapsed approval frees a place.

## Saved destinations and the lock

**You can hold your payouts to a list of places you name.** Every payout goes to a place; saved destinations are the places you have told us are yours. The **lock** says that only those places may be paid.

```http
GET    /v1/payout-destinations
POST   /v1/payout-destinations
DELETE /v1/payout-destinations/{id}
POST   /v1/payout-destinations/lock
```

None of these moves money, so none takes an `Idempotency-Key`. Saving the same place twice returns the first row with its clock untouched, and locking a lock that is already on changes nothing, so a retry costs nothing and raises nothing.

**Saving a place.** `POST /v1/payout-destinations` takes one place, in the beneficiary's own field names and **with no name**: a saved place has none of yours, and a bank's is the bank's to give.

```http
POST /v1/payout-destinations
Content-Type: application/json

{ "type": "till", "till": "123456" }
```

```json
HTTP 201
{
  "id": "c3d4e5f6-0a1b-4c2d-8e3f-a4b5c6d7e8f9",
  "type": "till",
  "till": "123456",
  "status": "cooling_off",
  "active_at": "2026-11-08T09:00:02Z",
  "created_at": "2026-11-07T09:00:02Z"
}
```

`201` for a new place, `200` for one already saved. A phone is `{"phone": "2547…"}`, a paybill is `{"type": "paybill", "paybill": "…", "account": "…"}` and a bank is `{"type": "bank", "account": "…", "bank_code": "…"}`. A bank is looked up at the save and its `holder_name` is stored and returned. You can keep up to 50 places; past that, `409 payout_destinations_full`.

**A new place waits before it can be paid.** `status` is `cooling_off` until `active_at`, which is `payout_cooling_off_hours` after the save (24 by default, never less than 1). Everything that **widens** where money can go waits like this, and raises an event and an alarm to us the moment it happens: [`payout_destination.added`](./events#payout_destinationadded-and-payout_destinationremoved) tells you. Everything that **narrows** it is immediate, so the owner, seeing that event, can always move first.

**Removing a place** is immediate. A payout already approved to a place that has since been removed can no longer be signed, and one already dispatched is out of reach.

**The lock.** Whether it binds is `payout_locked`. `POST /v1/payout-destinations/lock` with `{"locked": true}` binds at once, and cancels an unlock in progress. `{"locked": false}` leaves the lock on until `payout_unlocks_at`, `payout_cooling_off_hours` later.

```json
HTTP 200
{ "payout_locked": true, "payout_unlocks_at": "2026-11-08T09:00:02Z" }
```

`payout_unlocks_at` is present only while an unlock is pending. `GET /v1/payout-destinations` returns the list as `data` with the same two lock fields beside it.

**A locked merchant can pay only a saved destination whose `active_at` has passed.** Any other place is `403 payout_destination_locked`, and the answer deliberately does not say whether it was unsaved, cooling off or removed. The lock holds on the payout routes and on the wallet's own cash-out routes, which would otherwise go round it: `/ramp/withdraw/quote` is held to the same list, and a cash-out to USDC on Base is refused outright, because a Base address cannot be a saved destination. A saved place is still subject to every limit and to the approve-first rule: **a payout to your own saved destination still passes limits and holds.**

:::warning What the lock does and does not do
**The lock controls where your cash-outs can go.** It does **not** stop KSHS transfers to other wallets: [`POST /v1/transfers`](./transfers) and the app's send are not payouts and ignore it. It is a control on where shillings leave Kakitu, not protection against somebody who holds your key moving your KSHS on chain. Treat it as the first, not as the only.
:::

Locking, unlocking and changing the list all raise events ([`payout_lock.changed`](./events#payout_lockchanged), `payout_destination.added`, `payout_destination.removed`) so that a change you did not make is one you hear about. Reading the list and locking need only a registered merchant (a suspended owner can still lock, and must be able to cancel an unlock somebody asked for); saving a place and turning the lock off need an approved one.

## Status

| `status` | Terminal | Meaning |
|---|---|---|
| `quoted` | no | Priced, nothing signed, nothing moved. |
| `pending_approval` | no | You asked a person, over `hold_above_kes`. Nothing is signed or priced. Wait for `payout.approved` or `payout.rejected`. |
| `approved` | no | A person said yes. Quote with the `payout_id`, sign and submit before `approval_expires_at`. |
| `rejected` | **yes** | A person said no. Nothing was sent. **Do not ask again.** |
| `held` | no | Signed and accepted, not yet handed over. A payout at or below the threshold passes through this for an instant. |
| `dispatched` | no | Handed over. The money is leaving. `payout.paid` or `payout.failed` follows. |
| `paid` | **yes** | The beneficiary has the money. |
| `failed` | **yes** | It did not reach the beneficiary. A retry is a new payout. |
| `cancelled` | **yes** | A person refused a held payout. Nothing was sent. **Do not re-submit.** Kept for payouts already written; a refusal now ends as `rejected`. |
| `expired` | **yes** | Nothing was sent and nothing can be: an approval went unsigned past `approval_expires_at`, or a quote lapsed. **Ask again with a new payout.** |

The moves that exist, and no others:

```
pending_approval ──► approved ──► (you sign) ──► dispatched ──► paid
        │                │                            └──────► failed
        └──► rejected ◄──┤
                         └──► expired

quoted ──► held ──► dispatched
   │         ├──► cancelled
   │         └──► expired
   └──► expired
```

A payout that cannot be told apart from one that is still moving is never reported as failed: **a payout whose outcome is not known stays `dispatched`**, and you will not receive `payout.failed` for it. Confirm with the beneficiary, and ask support with the payout id if it has not resolved.

**All five terminal states really are final.** This is where a payout differs from a [charge](./collections#status) on purpose: a `failed` charge can still turn out to have been paid, because it is our projection of a partner's word about money coming in. A payout row is the **authority** for money going out, so re-opening one would let a late message send a second disbursement against a budget that was only ever charged once. A retry is always a **new payout**, never this one moving again, which also means the amount is counted against your cap again.

You will not normally see `quoted` or `held` from the API. A payout is created in `quoted` and moved to `held` inside the same request that dispatches it.

## GET /v1/payouts/\{id\}

Your own payout, by id. Signed request, no body, no `Idempotency-Key`.

<Tabs groupId="lang">
<TabItem value="curl" label="cURL" default>

```bash
kakitu GET /v1/payouts/7c2b18e4-0f2a-4a1b-9a44-1b2c3d4e5f60 | jq -r '.status'
```

</TabItem>
<TabItem value="ts" label="TypeScript">

```ts title="get-payout.mjs"
import { Wallet } from "ethers";
import { call } from "./kakitu.mjs";

const wallet = new Wallet(process.env.KAKITU_PRIVATE_KEY);
const { status, body } = await call(wallet, "GET", `/v1/payouts/${process.argv[2]}`);

// 404 payout_not_found covers three things at once: no such payout, another merchant's
// payout, and a string that is not a UUID. They are indistinguishable on purpose.
if (status === 404) throw new Error("no payout with that id");
console.log(body.status, body.amount_kes, body.send_kes, body.beneficiary.phone);
```

</TabItem>
<TabItem value="py" label="Python">

```python title="get_payout.py"
import os
import sys

from eth_account import Account
from kakitu import call

account = Account.from_key(os.environ["KAKITU_PRIVATE_KEY"])
status, body = call(account, "GET", f"/v1/payouts/{sys.argv[1]}")

# 404 payout_not_found covers three things at once: no such payout, another merchant's
# payout, and a string that is not a UUID. They are indistinguishable on purpose.
if status == 404:
    raise SystemExit("no payout with that id")
print(body["status"], body["amount_kes"], body["send_kes"], body["beneficiary"]["phone"])
```

</TabItem>
<TabItem value="php" label="PHP">

```php title="get-payout.php"
<?php
declare(strict_types=1);
require __DIR__ . '/kakitu.php';

[$status, $body] = kakitu_call(getenv('KAKITU_PRIVATE_KEY'), 'GET', '/v1/payouts/' . $argv[1]);

// 404 payout_not_found covers three things at once: no such payout, another merchant's
// payout, and a string that is not a UUID. They are indistinguishable on purpose.
if ($status === 404) {
    exit("no payout with that id\n");
}
echo $body['status'], ' ', $body['amount_kes'], ' ', $body['send_kes'], PHP_EOL;
```

</TabItem>
</Tabs>


```json
HTTP 200
{
  "id": "7c2b18e4-0f2a-4a1b-9a44-1b2c3d4e5f60",
  "status": "paid",
  "amount_kes": 1000,
  "fee_kes": 25,
  "send_kes": 1025,
  "currency": "KES",
  "beneficiary": { "phone": "254712345678", "name": "Jane Wanjiru" },
  "created_at": "2026-10-26T09:14:02Z"
}
```

**Another merchant's payout is indistinguishable from one that does not exist.** A payout that is not yours, an id that has never existed, and a string that is not a UUID at all are one answer with one set of words:

```json
HTTP 404
{ "error": { "code": "payout_not_found", "message": "No payout with that id.", "request_id": "…" } }
```

Anything else would make this endpoint a way of asking whether somebody else's payout id is real. It is `payout_not_found` and not `order_not_found` because you are holding a payout id, and an integrator should not be sent off to look for an order.

## GET /v1/payouts

Your own payouts, newest first. Signed request, no body, no `Idempotency-Key`; it reads.

**It exists so that losing a payout id is not the same as losing sight of the money.** `POST /v1/payouts` hands back an id, and before this route that id was the only handle on it — one crash between our response and your own commit, or one dropped log line, and you had no way to find out what you had sent.

<Tabs groupId="lang">
<TabItem value="curl" label="cURL" default>

```bash
# The query is INSIDE the signed message, so pass the whole target as one quoted argument.
kakitu GET '/v1/payouts?status=dispatched&created_after=2026-10-01T00:00:00Z&limit=50'

# Paging. The same opaque cursor GET /v1/charges issues - one pager works for both.
TARGET='/v1/payouts?status=dispatched&limit=50'
while [ -n "$TARGET" ]; do
  PAGE=$(kakitu GET "$TARGET")
  jq -r '.data[] | [.id, .status, .amount_kes, .send_kes] | @tsv' <<<"$PAGE"
  CURSOR=$(jq -r '.next_cursor // empty' <<<"$PAGE")
  [ -n "$CURSOR" ] && TARGET="/v1/payouts?status=dispatched&limit=50&cursor=$CURSOR" || TARGET=
done
```

</TabItem>
<TabItem value="ts" label="TypeScript">

```ts title="list-payouts.mjs"
import { Wallet } from "ethers";
import { call } from "./kakitu.mjs";

const wallet = new Wallet(process.env.KAKITU_PRIVATE_KEY);

// No Idempotency-Key: it reads. And no merchant lookup in front of it - an unregistered
// wallet gets an empty page here, not 404 merchant_not_registered as GET /v1/charges does.
let target = "/v1/payouts?status=dispatched&limit=50";
for (;;) {
  const { body } = await call(wallet, "GET", target);   // the query is part of the signature
  for (const p of body.data) console.log(p.id, p.status, p.amount_kes, p.send_kes);
  if (!body.next_cursor) break;                         // null on the last page
  target = `/v1/payouts?status=dispatched&limit=50&cursor=${encodeURIComponent(body.next_cursor)}`;
}
```

</TabItem>
<TabItem value="py" label="Python">

```python title="list_payouts.py"
import os
from urllib.parse import quote

from eth_account import Account
from kakitu import call

account = Account.from_key(os.environ["KAKITU_PRIVATE_KEY"])

# No Idempotency-Key: it reads. And no merchant lookup in front of it - an unregistered
# wallet gets an empty page here, not 404 merchant_not_registered as GET /v1/charges does.
target = "/v1/payouts?status=dispatched&limit=50"
while target:
    _, body = call(account, "GET", target)   # the query is part of the signature
    for p in body["data"]:
        print(p["id"], p["status"], p["amount_kes"], p["send_kes"])
    cursor = body["next_cursor"]             # None on the last page
    target = f"/v1/payouts?status=dispatched&limit=50&cursor={quote(cursor)}" if cursor else None
```

</TabItem>
<TabItem value="php" label="PHP">

```php title="list-payouts.php"
<?php
declare(strict_types=1);
require __DIR__ . '/kakitu.php';

$key = getenv('KAKITU_PRIVATE_KEY');

// No Idempotency-Key: it reads. And no merchant lookup in front of it - an unregistered
// wallet gets an empty page here, not 404 merchant_not_registered as GET /v1/charges does.
$target = '/v1/payouts?status=dispatched&limit=50';
while ($target !== null) {
    [, $body] = kakitu_call($key, 'GET', $target);   // the query is part of the signature
    foreach ($body['data'] as $p) {
        echo $p['id'], ' ', $p['status'], ' ', $p['amount_kes'], ' ', $p['send_kes'], PHP_EOL;
    }
    $cursor = $body['next_cursor'];                  // null on the last page
    $target = $cursor === null
        ? null
        : '/v1/payouts?status=dispatched&limit=50&cursor=' . rawurlencode($cursor);
}
```

</TabItem>
</Tabs>

| Parameter | Rules |
|---|---|
| `status` | One of the ten [statuses](#status). Anything else: `invalid_request`. |
| `created_after` | An RFC 3339 timestamp, for example `2026-10-25T00:00:00Z`. Exclusive. |
| `limit` | A whole number from 1 to 100. Default 20. |
| `cursor` | `next_cursor` from the previous page, unchanged. |

```json
{
  "data": [
    {
      "id": "7c2b18e4-0f2a-4a1b-9a44-1b2c3d4e5f60",
      "status": "dispatched",
      "amount_kes": 2000,
      "fee_kes": 25,
      "send_kes": 2025,
      "currency": "KES",
      "beneficiary": { "phone": "254712345678", "name": "Jane Wanjiru" },
      "created_at": "2026-10-26T09:14:02Z",
      "message": "This payout is on its way to the beneficiary. Poll GET /v1/payouts/{id} for the outcome."
    }
  ],
  "next_cursor": "MjAyNi0xMC0yNlQwOToxNDowMloucy4u"
}
```

### The paging is [`GET /v1/charges`](./collections#get-v1charges)'s, exactly

The same opaque `(created_at, id)` cursor, the same 1-to-100 `limit` defaulting to 20, the same `data` / `next_cursor` body. If you have already written a pager for charges, it works here unchanged — that is the point of them being identical rather than merely similar.

`next_cursor` is `null` on the last page. It is **an opaque string, not a page number**: payouts arrive while you are paging, and an offset would show you the same row twice. Pass it back unchanged — a cursor we did not issue is `invalid_request`, never a silently different page.

An empty result is `{"data": [], "next_cursor": null}`.

### There is no `reference` filter

A payout has no merchant-supplied reference. That is a charge field: you name a charge, but a payout is priced from a quote and identified by the id we return. Keep your own mapping from your reference to that id — this list will not do it for you.

### A bad `status` is a `400`, not an empty page

```json
HTTP 400
{ "error": { "code": "invalid_request", "message": "status is not a payout status. See the status field of any payout for the values.", "request_id": "…" } }
```

An empty page reads as "you have no payouts like that", and for a typo'd status that is a lie about somebody's money.

### It does not need a registered merchant

This route is scoped by the **signing address**, in the query itself, and there is no merchant lookup in front of it. A wallet that never registered gets an empty page, not `404 merchant_not_registered`.

That is a real difference from [`GET /v1/charges`](./collections#get-v1charges), which *does* answer `merchant_not_registered`. Do not write one handler for both and expect the same refusal. The scope is in the `WHERE` clause either way, so neither returns somebody else's rows.

### `message` is where a wait is explained

Each element is the **same object** `GET /v1/payouts/{id}` returns, `message` included — present only while a payout is `pending_approval`, `approved`, `rejected`, `held` or `dispatched`, absent otherwise.

Read it. **That sentence is where a wait is explained to you**, and a payout that was accepted and then does not move looks like an outage until something says a person is going to look at it. It is written for a human reading a log: display it, log it, but **branch on `status`, never on `message`.**

## Errors

### POST /v1/payouts/quote

| `code` | HTTP | When |
|---|---|---|
| `unauthorized` | 401 | The request was not signed. |
| `merchant_not_registered` | 404 | This wallet has not registered. |
| `merchant_not_approved` | 403 | Registered, not yet approved. |
| `merchant_suspended` | 403 | The merchant is suspended. |
| `payouts_disabled` | 403 | Payouts are not switched on for this merchant. |
| `payout_daily_cap_exceeded` | 429 | The day's payout budget is spent. Resets at midnight EAT. |
| `payout_amount_above_maximum` | 400 | Over the largest single payout allowed for this merchant. |
| `invalid_request` | 400 | A malformed body, an unknown field, an `amount_kes` below 1, a name that is not valid, or a beneficiary that is not exactly one valid destination (a till with a phone, a number that is not a till, a phone that is not a Kenyan mobile). |
| `request_too_large` | 413 | The body is over 4 KiB. |
| `amount_below_minimum` | 400 | Under the rail's band. [`GET /v1/limits`](./limits) shows it. |
| `amount_above_maximum` | 400 | Over the rail's band. |
| `profile_required` | 409 | This wallet has no profile yet: a phone number and name, which the cash-out partner needs on every order. There is no `/v1` route for it; save one with `POST /profile` or in the Kakitu app. See [Cash out](./cash-out#2-a-profile-once). |
| `identity_verification_required` | 403 | This amount needs identity verification first. |
| `payout_approval_required` | 409 | Above your `hold_above_kes` with no approved request. Ask at `POST /v1/payouts/requests`. |
| `payout_not_approved` | 409 | The `payout_id` is not approved: undecided, rejected, lapsed or already used. `GET /v1/payouts/{id}` shows which. |
| `payout_approval_mismatch` | 409 | The amount or beneficiary is not what a person approved. A new request. |
| `payout_destination_locked` | 403 | You are locked to your saved destinations and this is not one that can be paid now. |
| `bank_unavailable` | 403 | A paybill or bank that is not a saved destination past its cooling-off, or a kind of destination not available now. Nothing was quoted. |
| `unknown_bank` | 400 | `bank_code` is not a bank we can pay. |
| `account_not_found` | 422 | The bank does not hold that account, or no longer under the name it was saved with. |
| `insufficient_balance` | 400 | Your wallet does not hold the KSHS this payout burns. Nothing was quoted. |
| `account_blocked` | 403 | Kakitu has blocked your wallet, or money in it is on hold. Nothing was quoted. Contact support. |
| `rate_limited` | 429 | Too many requests, or too many bank account lookups, from this wallet. |
| `rail_unavailable` | 503 | Pricing is temporarily unavailable, payout capacity is short right now, or we could not count your budget or check your wallet. Nothing was priced. Retry shortly, or with a smaller amount. |
| `internal` | 500 | Something went wrong on our side. Quote the `request_id`. |

`payout_amount_above_maximum` is a `400` and not a `429` for a reason: no amount of waiting makes that payout acceptable, only a smaller one. `payout_daily_cap_exceeded` is a `429` because tomorrow it will work.

### POST /v1/payouts/requests

`unauthorized`, `merchant_not_registered`, `merchant_not_approved`, `merchant_suspended`, `payouts_disabled`, `invalid_request` and `request_too_large` as above, plus:

| `code` | HTTP | When |
|---|---|---|
| `idempotency_key_required` | 400 | No `Idempotency-Key`. Nothing was added. |
| `payout_open_requests_exceeded` | 429 | You already have as many requests waiting as you may. A decision or a lapsed approval frees a place. |
| `invalid_request` | 400 | Also: this amount does not need approval. Quote it at `/v1/payouts/quote` and sign that. |

### POST /v1/payout-destinations

| `code` | HTTP | When |
|---|---|---|
| `invalid_request` | 400 | The body is not exactly one valid destination. |
| `payout_destinations_full` | 409 | You have as many saved as you may (50). Remove one. |
| `unknown_bank`, `account_not_found`, `bank_unavailable` | 400, 422, 403 | A bank that is not on the list, does not hold the account, or is not available. |
| `merchant_not_approved`, `merchant_suspended` | 403 | Saving needs an approved merchant. |

`DELETE /v1/payout-destinations/{id}` answers `404 payout_destination_not_found` for a place that does not exist, one that is not yours and an id that is not a UUID, in the same words. `GET` needs only a registered merchant.

### POST /v1/payouts

Everything above, plus:

| `code` | HTTP | When |
|---|---|---|
| `idempotency_key_required` | 400 | No `Idempotency-Key`. Nothing was sent. |
| `payout_quote_not_found` | 404 | The quote cannot be used. See [above](#the-quote-is-single-use-and-yours-alone). |
| `invalid_request` | 400 | The signed transfer does not match the quote, or the body is malformed. **Nothing was sent.** |
| `payout_not_approved` | 409 | This payout cannot be signed now: not approved, rejected, lapsed, already sent, or its destination was removed after the approval. |
| `account_blocked` | 403 | Kakitu has blocked your wallet, or money in it is on hold. **Nothing was sent.** |
| `idempotency_key_acted` | 409 | The payout was submitted and we cannot tell what became of it. **Do not send it again.** |

The general idempotency rules — replays, mismatched bodies, the 24-hour window — are on the [Collections](./collections#idempotency) page and apply here unchanged.

### GET /v1/payouts/\{id\}

| `code` | HTTP | When |
|---|---|---|
| `unauthorized` | 401 | The request was not signed. |
| `payout_not_found` | 404 | No payout with that id, or it is not yours. |
| `rail_unavailable` | 503 | Temporarily unavailable. Retry shortly. |
| `internal` | 500 | Something went wrong on our side. |

### GET /v1/payouts

| `code` | HTTP | When |
|---|---|---|
| `unauthorized` | 401 | The request was not signed. |
| `invalid_request` | 400 | An unknown `status`, a `created_after` that is not RFC 3339, a `limit` outside 1–100, or a `cursor` we did not issue. |
| `rate_limited` | 429 | Too many requests from this wallet. |
| `rail_unavailable` | 503 | Temporarily unavailable. Retry shortly. |
| `internal` | 500 | Something went wrong on our side. |

**No `merchant_not_registered` and no `payouts_disabled`.** Reading what you have already sent is not paying out, so an unregistered caller and a merchant with payouts switched off both get a `200` — an empty page in the first case, and in the second whatever was sent before the switch moved.

Every code on this page is from the closed set in [Errors](./errors).

## The one answer that is not "retry"

Almost every refusal above happens before anything is handed over, and says so. Your `Idempotency-Key` is released and a corrected retry with the same key is right.

**`409 idempotency_key_acted` is the exception.** It means the payout was handed to the rail and we could not record what came back. The money may be on its way.

**Do not send it again — not with this key, and not with a new one.** The message carries the payout id; read `GET /v1/payouts/{id}` and see where it got to, or ask support with the `request_id`. A `503` on this route always means nothing was sent; this `409` always means it may have been. The two readings are never mixed into one status, which is the same ruling [transfers](./transfers#the-two-answers-that-are-not-retry) makes and for the same reason.

The key is held deliberately. Freeing a key after money may have moved makes the retry send it a second time; holding one only costs you a new key.
