---
sidebar_position: 9
title: Orders
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Orders

An order is one movement of money between shillings and KSHS for your own wallet: a **deposit** (shillings in, KSHS credited) or a **withdrawal** (KSHS sent, shillings paid out).

**This API does not create orders.** There is no `POST /v1/orders`. Orders are created by Kakitu's own deposit and withdrawal flows for the wallet that owns them; this endpoint is how you read one you already have an id for. Collections are a different thing entirely and have their own ids — see [Collections](./collections).

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

## GET /v1/orders/\{id\}

Signed request, no body, no `Idempotency-Key`.

<Tabs groupId="lang">
<TabItem value="curl" label="cURL" default>

```bash
kakitu GET /v1/orders/6f1b7a66-7e5c-4a2e-9f3e-6d9a4a1c2b30
```

A `404` here says nothing about whether the id is real &mdash; see below.

</TabItem>
<TabItem value="ts" label="TypeScript">

```ts title="order.mjs"
// node order.mjs 6f1b7a66-... - needs kakitu.mjs from the Authentication page beside it.
import { Wallet } from "ethers";
import { call } from "./kakitu.mjs";

const wallet = new Wallet(process.env.KAKITU_PRIVATE_KEY);
const { status, body } = await call(wallet, "GET", `/v1/orders/${process.argv[2]}`);

if (status === 404) {
  // order_not_found. It does not exist, it is not yours, the id is malformed, or it is an
  // order this API does not expose. One answer for all four: do not branch on it.
  throw new Error("no such order");
}
// expires_at is present only while status is "awaiting_payment".
console.log(body.type, body.status, body.amount_kes, body.receive_kes, body.fee_kes);
```

</TabItem>
<TabItem value="py" label="Python">

```python title="order.py"
# python order.py 6f1b7a66-... - needs kakitu.py from the Authentication page beside it.
import os
import sys

from eth_account import Account
from kakitu import call

account = Account.from_key(os.environ["KAKITU_PRIVATE_KEY"])
status, body = call(account, "GET", f"/v1/orders/{sys.argv[1]}")

if status == 404:
    # order_not_found. It does not exist, it is not yours, the id is malformed, or it is an
    # order this API does not expose. One answer for all four: do not branch on it.
    raise SystemExit("no such order")

# expires_at is present only while status is "awaiting_payment" - use .get().
print(body["type"], body["status"], body["amount_kes"], body["receive_kes"], body["fee_kes"])
print(body.get("expires_at"))
```

</TabItem>
<TabItem value="php" label="PHP">

```php title="order.php"
<?php
// php order.php 6f1b7a66-... - needs kakitu.php from the Authentication page beside it.
declare(strict_types=1);
require __DIR__ . '/kakitu.php';

[$status, $body] = kakitu_call(getenv('KAKITU_PRIVATE_KEY'), 'GET', '/v1/orders/' . $argv[1]);

if ($status === 404) {
    // order_not_found. It does not exist, it is not yours, the id is malformed, or it is an
    // order this API does not expose. One answer for all four: do not branch on it.
    exit("no such order\n");
}
// expires_at is present only while status is "awaiting_payment".
echo $body['type'], ' ', $body['status'], ' ', $body['amount_kes'], PHP_EOL;
echo $body['expires_at'] ?? '(not awaiting payment)', PHP_EOL;
```

</TabItem>
</Tabs>

The response:

```json
HTTP 200
{
  "id": "6f1b7a66-7e5c-4a2e-9f3e-6d9a4a1c2b30",
  "type": "deposit",
  "status": "completed",
  "amount_kes": 1000,
  "receive_kes": 970,
  "fee_kes": 30,
  "created_at": "2026-10-26T08:55:12Z"
}
```

| Field | Meaning |
|---|---|
| `id` | The order's id. |
| `type` | `deposit` or `withdrawal`. |
| `status` | One of the six below. |
| `amount_kes` | Deposit: the shillings paid in. Withdrawal: the KSHS sent. |
| `receive_kes` | Deposit: the KSHS received. Withdrawal: the shillings paid out. |
| `fee_kes` | The difference. |
| `created_at` | When the order was created. |
| `expires_at` | **Only present while the order is `awaiting_payment`.** A deadline on an order nobody is waiting for would be noise. |

## Status

| `status` | Meaning |
|---|---|
| `awaiting_payment` | Waiting for the money to arrive. |
| `processing` | In flight. Nothing for you to do. |
| `completed` | Done. |
| `failed` | It did not complete. |
| `refunding` | Being reversed. |
| `refunded` | Reversed. |

These six are the whole set. Internally an order walks through far more steps than this — minting, funding, burning and others — and none of them appears here. A step that is not one of the six reads as `processing`, including any step added in future. That is on purpose: an integrator should never have to learn our pipeline's vocabulary, and a step we forget to translate must not leak as a raw string.

## What is not in the response

No reference, no phone number, no transaction hash, no partner name, no partner status, no partner order id, no failure text. Some of it is the payer's, some of it is a partner's, and none of it is yours to be given by us. If you need to reconcile against your own records, use the id.

## Errors

| `code` | HTTP | When |
|---|---|---|
| `unauthorized` | 401 | The request was not signed. |
| `order_not_found` | 404 | No order with that id. |
| `rail_unavailable` | 503 | Order lookup is temporarily unavailable. |
| `internal` | 500 | Something went wrong on our side. |

**`order_not_found` is one answer for four situations**: the order does not exist, it belongs to another wallet, the id is not a well-formed id at all, or it is an order this API does not expose (an order behind a merchant collection, for instance). Same status, same code, same sentence, deliberately. An error that told them apart would turn this endpoint into a way of asking whether somebody else's order id is real.
