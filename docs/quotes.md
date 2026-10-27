---
sidebar_position: 8
title: Quotes
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Quotes

A quote is a **price**: what a payment in or out would cost right now, and what would land. Asking for one creates no order, no charge and no transfer, and commits you to nothing.

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

## No Idempotency-Key

**This is the one `POST` in the API that does not take an `Idempotency-Key`**, and sending one is pointless rather than wrong. Every other money-moving `POST` requires a key because a timeout must not mean a second charge. A quote moves no money, so there is nothing to protect: ask twice and you get two prices, which is the correct answer.

## The request

<Tabs groupId="lang">
<TabItem value="curl" label="cURL" default>

```bash
# A deposit: amount_kes is what the PAYER is asked to pay.
kakitu POST /v1/quotes '{"type":"deposit","amount_kes":1000,"phone":"254700000001"}'

# A withdrawal: amount_kes is what must LAND, and beneficiary is required.
kakitu POST /v1/quotes \
  '{"type":"withdrawal","amount_kes":500,"beneficiary":{"channel":"mpesa","number":"254712345678","reference":"inv-77"}}'
```

No `Idempotency-Key` on either one: a quote creates nothing, so there is nothing to protect.
Sending one is pointless rather than wrong.

```bash
# rate_kes_per_usdc is a JSON STRING. -r keeps the digits; tonumber throws precision away.
kakitu POST /v1/quotes '{"type":"deposit","amount_kes":1000,"phone":"254700000001"}' \
  | jq -r '.rate_kes_per_usdc'
```

</TabItem>
<TabItem value="ts" label="TypeScript">

```ts title="quote.mjs"
// node quote.mjs - needs kakitu.mjs from the Authentication page beside it.
import { Wallet } from "ethers";
import { call } from "./kakitu.mjs";

const wallet = new Wallet(process.env.KAKITU_PRIVATE_KEY);

// NO Idempotency-Key on this route. call() does not send one, and that is correct here:
// a quote creates no order, no charge and no transfer, so a retry costs you a second price.
const deposit = await call(wallet, "POST", "/v1/quotes", {
  type: "deposit",
  amount_kes: 1000,            // what the PAYER is asked to pay
  phone: "254700000001",
});

const withdrawal = await call(wallet, "POST", "/v1/quotes", {
  type: "withdrawal",
  amount_kes: 500,             // what must LAND; we price backwards from here
  beneficiary: { channel: "mpesa", number: "254712345678", reference: "inv-77" },
});

// rate_kes_per_usdc is a STRING. A typed client that declares it `number` fails on this
// route; keep the string, or parse it with a decimal library.
console.log(deposit.body.pay_kes, deposit.body.receive_kes, deposit.body.rate_kes_per_usdc);
console.log(withdrawal.body.send_kes, withdrawal.body.receive_kes, withdrawal.body.expires_at);

// There is no quote_id here. Nothing on this page can be handed back to us - for a price you
// can act on, use POST /v1/payouts/quote.
console.log("quote_id" in deposit.body);   // false
```

</TabItem>
<TabItem value="py" label="Python">

```python title="quote.py"
# python quote.py - needs kakitu.py from the Authentication page beside it.
import os
from decimal import Decimal

from eth_account import Account
from kakitu import call

account = Account.from_key(os.environ["KAKITU_PRIVATE_KEY"])

# NO Idempotency-Key on this route. call() sends none, and that is correct here: a quote
# creates no order, no charge and no transfer, so a retry costs you a second price.
_, deposit = call(account, "POST", "/v1/quotes", {
    "type": "deposit",
    "amount_kes": 1000,          # what the PAYER is asked to pay
    "phone": "254700000001",
})

_, withdrawal = call(account, "POST", "/v1/quotes", {
    "type": "withdrawal",
    "amount_kes": 500,           # what must LAND; we price backwards from here
    "beneficiary": {"channel": "mpesa", "number": "254712345678", "reference": "inv-77"},
})

# rate_kes_per_usdc is a str. Decimal(...) it; a model that declares it float is wrong.
print(deposit["pay_kes"], deposit["receive_kes"], Decimal(deposit["rate_kes_per_usdc"]))
print(withdrawal["send_kes"], withdrawal["receive_kes"], withdrawal["expires_at"])

# There is no quote_id here. Nothing on this page can be handed back to us - for a price you
# can act on, use POST /v1/payouts/quote.
print("quote_id" in deposit)   # False
```

</TabItem>
<TabItem value="php" label="PHP">

```php title="quote.php"
<?php
// php quote.php - needs kakitu.php from the Authentication page beside it.
declare(strict_types=1);
require __DIR__ . '/kakitu.php';

$key = getenv('KAKITU_PRIVATE_KEY');

// NO Idempotency-Key on this route. kakitu_call() sends none, and that is correct here: a
// quote creates no order, no charge and no transfer, so a retry costs you a second price.
[, $deposit] = kakitu_call($key, 'POST', '/v1/quotes', [
    'type' => 'deposit',
    'amount_kes' => 1000,        // what the PAYER is asked to pay
    'phone' => '254700000001',
]);

[, $withdrawal] = kakitu_call($key, 'POST', '/v1/quotes', [
    'type' => 'withdrawal',
    'amount_kes' => 500,         // what must LAND; we price backwards from here
    'beneficiary' => ['channel' => 'mpesa', 'number' => '254712345678', 'reference' => 'inv-77'],
]);

// rate_kes_per_usdc is a string. Leave it one, or use bcmath. (float) loses precision.
echo $deposit['pay_kes'], ' ', $deposit['receive_kes'], ' ', $deposit['rate_kes_per_usdc'], PHP_EOL;
echo $withdrawal['send_kes'], ' ', $withdrawal['receive_kes'], ' ', $withdrawal['expires_at'], PHP_EOL;

// There is no quote_id here. Nothing on this page can be handed back to us - for a price you
// can act on, use POST /v1/payouts/quote.
var_dump(array_key_exists('quote_id', $deposit));   // false
```

</TabItem>
</Tabs>

| Field | Type | Rules |
|---|---|---|
| `type` | string, required | `deposit` or `withdrawal`. Anything else: `invalid_request`. |
| `amount_kes` | integer, required | Whole shillings, at least 1. What it means depends on `type` — see below. |
| `phone` | string | The payer's number, for a deposit. |
| `beneficiary` | object | **Required for a withdrawal.** `{ "channel": …, "number": …, "reference": … }`. |

**`amount_kes` is the number you care about, and it sits on a different side of the fee for each type.**

- For a **deposit** it is what the payer is asked to pay.
- For a **withdrawal** it is the shillings that must **land**. We price backwards from there and tell you the KSHS it would cost.

That is deliberate: you almost always know the amount somebody must receive, not the amount before a fee you have not been told yet.

**Unknown fields are refused** with `invalid_request`. A misspelt key fails loudly instead of being quietly ignored and changing your price. The body is limited to 4 KiB (`request_too_large`, 413).

## The response

A deposit:

```json
HTTP 200
{
  "type": "deposit",
  "pay_kes": 1000,
  "receive_kes": 970,
  "fee_kes": 30,
  "rate_kes_per_usdc": "125",
  "expires_at": "2026-10-26T09:02:00Z"
}
```

A withdrawal:

```json
HTTP 200
{
  "type": "withdrawal",
  "send_kes": 515,
  "receive_kes": 500,
  "fee_kes": 15,
  "rate_kes_per_usdc": "125",
  "expires_at": "2026-10-26T09:02:00Z"
}
```

| Field | Meaning |
|---|---|
| `pay_kes` | Deposit only: the shillings the payer is asked for. |
| `send_kes` | Withdrawal only: the KSHS that would be sent. |
| `receive_kes` | What lands. Deposit: the KSHS credited. Withdrawal: the shillings paid out. |
| `fee_kes` | The difference, in shillings. |
| `rate_kes_per_usdc` | The rate used, as a decimal string. |
| `expires_at` | When this price stops being the price. |

### There is no quote id

**A quote from this endpoint is a number you show somebody, not a reservation.** There is no id in the response and nothing here can be handed back to us.

That is not an oversight: the only id a quote has internally belongs to the pricing partner, and no partner identifier goes over this API. For the same reason nothing in the response names a rail, a treasury address or an amount to sign.

If you want a price you can **act on**, that is [`POST /v1/payouts/quote`](./payouts#post-v1payoutsquote). It issues an id of its own, in its own namespace, and that id is the only thing `POST /v1/payouts` accepts. A quote from this page cannot be spent there, and neither can one from the wallet app's `/ramp/*` routes — both are refused exactly as an id that never existed.

## Errors

| `code` | HTTP | When |
|---|---|---|
| `invalid_request` | 400 | Bad JSON, an unknown field, a `type` that is not `deposit` or `withdrawal`, `amount_kes` below 1, a missing `beneficiary` on a withdrawal, or a phone or beneficiary that is not valid for this wallet. |
| `request_too_large` | 413 | The body is over 4 KiB. |
| `unauthorized` | 401 | The request was not signed. |
| `amount_below_minimum` | 400 | Under the band. `GET /v1/limits` shows it. |
| `amount_above_maximum` | 400 | Over the band. |
| `profile_required` | 409 | This wallet has no profile yet. It must be completed before a quote can be priced. |
| `identity_verification_required` | 403 | This amount needs the customer's identity verified first. |
| `rate_limited` | 429 | Too many requests from this wallet. |
| `rail_unavailable` | 503 | Pricing is temporarily unavailable. Retry shortly. |
| `internal` | 500 | Something went wrong on our side. Quote the `request_id`; do not retry in a loop. |

A `500` here is worth treating differently from a `503`. `rail_unavailable` means try again shortly. `internal` can mean our own arithmetic disagreed with itself, and retrying that gets the same answer faster.

## What a quote does not tell you

The band from [`GET /v1/limits`](./limits) is cached and can be minutes old. **A quote is live.** If the two disagree, the quote is right — it is the thing that decides whether an amount is accepted.
