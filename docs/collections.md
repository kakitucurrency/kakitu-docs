---
sidebar_position: 5
title: Collections (coming soon)
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Collections (coming soon)

**`POST /v1/charges` is coming soon, rebuilt as a KSHS payment request.** Do not build on it today: new charges cannot be created. Take payment with a KSHS transfer and a `reference`, as below.

## Today: a transfer with a reference {#today}

Ask the payer to send KSHS to your address with your order number as the `reference`:

- **On a website**, the [Lipa na Kakitu button](./extension#lipa-na-kakitu-button) or a direct call to the extension's [`pay()`](./extension#pay-pay), with `to`, `amountKes` and `reference`.
- **On a phone or at a counter**, a [`kakitu:` link or QR code](./extension#pay-with-kakitu-on-a-phone) carrying the reference.
- **From another business's server**, a [`POST /v1/transfers`](./transfers) with a `reference`.

You are told by the signed [`transfer.received`](./events#transferreceived) webhook once you are an approved merchant with a `callback_url`; its `transfer.reference` carries your order number. Your dashboard at kakitu.org/merchant lists the same payments, and [`GET /transfers`](./transfers#get-transfers) reads them from your server. **A reference is the payer's claim, not proof**: check the amount and the recipient on chain and match each payment to exactly one order ([the rule](./extension#pay-pay)).

## What is coming {#what-is-coming}

A charge will become **a payment request in KSHS**: you create it with an amount and a reference, the payer approves it in the Kakitu app or the extension, and you are told when the transfer lands. No M-Pesa prompt is involved, and nothing about it costs the payer a fee. The request and webhook shapes will be published here before it opens.

## Past charges

Charges created before this change can still be read. `GET /v1/charges` and `GET /v1/charges/{id}` answer as below, and the [`charge.*` events](./events) that belong to them can still be listed and replayed. Each past charge carries `fee_kes` (what the collection cost) and `credited_kes` (what reached your wallet, `amount` less `fee_kes`), in whole shillings, or `null` if it was never paid.

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

## `GET /v1/charges/{id}`

Returns the charge. A charge that belongs to another merchant answers `404 charge_not_found`, the same as one that does not exist, and so does an id that is not well formed.

<Tabs groupId="lang">
<TabItem value="curl" label="cURL" default>

```bash
kakitu GET /v1/charges/a1f0c9d2-55b1-4f3e-8a0d-77c1e2b3a4d5
```

</TabItem>
<TabItem value="ts" label="TypeScript">

```ts title="get-charge.mjs"
import { Wallet } from "ethers";
import { call } from "./kakitu.mjs";

const wallet = new Wallet(process.env.KAKITU_PRIVATE_KEY);
const { status, body } = await call(wallet, "GET", `/v1/charges/${process.argv[2]}`);

// 404 charge_not_found covers three things at once: no such charge, somebody else's charge,
// and an id that is not well formed. Do not try to tell them apart.
if (status === 404) throw new Error("no such charge");
console.log(body.status, body.amount, body.settled_at);
```

</TabItem>
<TabItem value="py" label="Python">

```python title="get_charge.py"
import os
import sys

from eth_account import Account
from kakitu import call

account = Account.from_key(os.environ["KAKITU_PRIVATE_KEY"])
status, body = call(account, "GET", f"/v1/charges/{sys.argv[1]}")

# 404 charge_not_found covers three things at once: no such charge, somebody else's charge,
# and an id that is not well formed. Do not try to tell them apart.
if status == 404:
    raise SystemExit("no such charge")
print(body["status"], body["amount"], body["settled_at"])
```

</TabItem>
<TabItem value="php" label="PHP">

```php title="get-charge.php"
<?php
declare(strict_types=1);
require __DIR__ . '/kakitu.php';

[$status, $body] = kakitu_call(getenv('KAKITU_PRIVATE_KEY'), 'GET', '/v1/charges/' . $argv[1]);

// 404 charge_not_found covers three things at once: no such charge, somebody else's charge,
// and an id that is not well formed. Do not try to tell them apart.
if ($status === 404) {
    exit("no such charge\n");
}
echo $body['status'], ' ', $body['amount'], ' ', ($body['settled_at'] ?? 'null'), PHP_EOL;
```

</TabItem>
</Tabs>


## `GET /v1/charges`

Your own charges, newest first. No `Idempotency-Key`; it reads.

<Tabs groupId="lang">
<TabItem value="curl" label="cURL" default>

```bash
# The query is INSIDE the signed message, so pass the whole target as one quoted argument.
kakitu GET '/v1/charges?status=settled&created_after=2026-10-01T00:00:00Z&limit=50'

# Paging. next_cursor is opaque: hand it back unchanged, never a page number.
TARGET='/v1/charges?status=settled&limit=50'
while [ -n "$TARGET" ]; do
  PAGE=$(kakitu GET "$TARGET")
  jq -r '.data[] | [.id, .reference, .amount, .status] | @tsv' <<<"$PAGE"
  CURSOR=$(jq -r '.next_cursor // empty' <<<"$PAGE")
  # Sign the NEW target, not the old one.
  [ -n "$CURSOR" ] && TARGET="/v1/charges?status=settled&limit=50&cursor=$CURSOR" || TARGET=
done
```

</TabItem>
<TabItem value="ts" label="TypeScript">

```ts title="list-charges.mjs"
import { Wallet } from "ethers";
import { call } from "./kakitu.mjs";

const wallet = new Wallet(process.env.KAKITU_PRIVATE_KEY);

// No Idempotency-Key: it reads.
let target = "/v1/charges?status=settled&limit=50";
for (;;) {
  // The query string is part of the signed message, so sign the target you are about to send.
  const { body } = await call(wallet, "GET", target);
  for (const c of body.data) console.log(c.id, c.reference, c.amount, c.status);
  if (!body.next_cursor) break;                     // null on the last page
  // next_cursor is opaque - pass it back unchanged. One we did not issue is invalid_request.
  target = `/v1/charges?status=settled&limit=50&cursor=${encodeURIComponent(body.next_cursor)}`;
}
```

</TabItem>
<TabItem value="py" label="Python">

```python title="list_charges.py"
import os
from urllib.parse import quote

from eth_account import Account
from kakitu import call

account = Account.from_key(os.environ["KAKITU_PRIVATE_KEY"])

# No Idempotency-Key: it reads.
target = "/v1/charges?status=settled&limit=50"
while target:
    # The query string is part of the signed message, so sign the target you are about to send.
    _, body = call(account, "GET", target)
    for c in body["data"]:
        print(c["id"], c["reference"], c["amount"], c["status"])
    cursor = body["next_cursor"]                    # None on the last page
    # next_cursor is opaque - pass it back unchanged. One we did not issue is invalid_request.
    target = f"/v1/charges?status=settled&limit=50&cursor={quote(cursor)}" if cursor else None
```

</TabItem>
<TabItem value="php" label="PHP">

```php title="list-charges.php"
<?php
declare(strict_types=1);
require __DIR__ . '/kakitu.php';

$key = getenv('KAKITU_PRIVATE_KEY');

// No Idempotency-Key: it reads.
$target = '/v1/charges?status=settled&limit=50';
while ($target !== null) {
    // The query string is part of the signed message, so sign the target you will send.
    [, $body] = kakitu_call($key, 'GET', $target);
    foreach ($body['data'] as $c) {
        echo $c['id'], ' ', $c['reference'], ' ', $c['amount'], ' ', $c['status'], PHP_EOL;
    }
    $cursor = $body['next_cursor'];   // null on the last page
    // next_cursor is opaque - pass it back unchanged. One we did not issue is invalid_request.
    $target = $cursor === null
        ? null
        : '/v1/charges?status=settled&limit=50&cursor=' . rawurlencode($cursor);
}
```

</TabItem>
</Tabs>

| Parameter | Rules |
|---|---|
| `reference` | Your own identifier, matched exactly. |
| `status` | One of the statuses above. Anything else: `invalid_request`. |
| `created_after` | An RFC 3339 timestamp, for example `2026-10-25T00:00:00Z`. |
| `limit` | A whole number from 1 to 100. Default 20. |
| `cursor` | `next_cursor` from the previous page, unchanged. |

```json
{
  "data": [
    {
      "id": "a1f0c9d2-55b1-4f3e-8a0d-77c1e2b3a4d5",
      "reference": "order-1042",
      "amount": 500,
      "currency": "KES",
      "status": "settled",
      "created_at": "2026-10-25T12:00:00Z",
      "paid_at": "2026-10-25T12:00:41Z",
      "settled_at": "2026-10-25T12:01:03Z",
      "fee_kes": 15,
      "credited_kes": 485
    }
  ],
  "next_cursor": "MjAyNi0xMC0yNVQxMjowMDowMFouLg"
}
```

`next_cursor` is `null` on the last page. It is **an opaque string, not a page number**: charges arrive while you are paging, and an offset would show you the same row twice. Pass it back unchanged — a cursor we did not issue is `invalid_request`.

The list is scoped to your merchant in the query itself, not by a filter we remember to apply, so there is no shape of request that returns somebody else's charges.

## Status

| `status` | Meaning |
|---|---|
| `pending` | Created, nothing sent yet. |
| `prompted` | The payer's handset has been rung. |
| `paid` | The payer paid. |
| `settled` | Your wallet was credited on chain with `credited_kes`, which is `amount` less `fee_kes`. Final. |
| `failed` | The attempt did not complete. |
| `expired` | The charge ran out of time. |
| `cancelled` | Cancelled. Final. |

A charge only moves forward.
