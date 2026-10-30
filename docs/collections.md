---
sidebar_position: 5
title: Collections
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Collections

A collection (a *charge*) asks a payer's phone to approve an M-Pesa payment. When they pay, your merchant wallet is credited in KSHS.

**You are credited less than `amount`.** `amount` is what the payer is asked for. Our payment partner converts those shillings to USDC at its rate and takes its fee, and we mint KSHS against the USDC that arrives, at our rate net of the mint spread (`mint_spread_bps` in [`GET /config`](https://walletapi.kakitu.org/config)). The KSHS minted to you is the credit: never more than `amount`, and usually a little less. Neither the charge nor its webhook carries the credited figure today; read it from the mint `Transfer` to your address on chain. See [Pricing, limits and settlement](./pricing).

:::warning Collections are not open yet
Collections are switched off for every merchant. `POST /v1/charges` answers `503 rail_unavailable`
and nobody is prompted. This page documents the final shapes so you can build against them; to
be paid today, accept KSHS directly (see the [quickstart](./quickstart#2-take-a-payment)).
:::

## Operator approval is required

**Collections only work for an approved merchant.** A `pending`, `rejected` or `suspended` merchant is refused (`merchant_not_approved` or `merchant_suspended`, both 403) before anything else happens.

The reason is plain: a collection **rings a stranger's handset with a real M-Pesa PIN prompt**. That prompt is issued by our payment partner. We pass your `business_name` to the partner as the account-holder name, and the prompt **may** show it, but what the prompt displays is the partner's decision: the payer must be able to recognise the amount and the moment, not only a name. Without a human check, the endpoint would be a phishing tool. So a Kakitu operator reviews every merchant first. See [Going live](./going-live).

Collections must also be switched on for the platform by an operator. While they are off, `POST /v1/charges` answers `503 rail_unavailable` before anything is written: no handset is rung, no charge row exists, and the `reference` stays free.

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

## `POST /v1/charges`

Requires `Idempotency-Key` (below).

| Field | Type | Rules |
|---|---|---|
| `amount` | integer, required | Whole KES, greater than zero. Subject to the minimum the rail will collect and your per-charge maximum. |
| `phone` | string, required | The payer's Kenyan mobile number. Normalised once, then used for everything. |
| `reference` | string, required | Your own identifier. At most 128 characters. Unique per merchant. |

<Tabs groupId="lang">
<TabItem value="curl" label="cURL" default>

```bash
# Idempotency-Key is REQUIRED here. Without it: 400 idempotency_key_required, and no handset
# is rung. Keep the key: resending the SAME key after a timeout returns the original answer.
KEY=$(uuidgen)
kakitu POST /v1/charges \
  '{"amount":500,"phone":"254700000001","reference":"order-1042"}' \
  -H "Idempotency-Key: $KEY"
```

`201`, and `status` is `prompted` when the rail says the push went out, `pending` when it
accepted the order but could not confirm the prompt. On a timeout, send it again with
`$KEY` unchanged &mdash; the stored answer comes back with `Idempotent-Replayed: true`.

</TabItem>
<TabItem value="ts" label="TypeScript">

```ts title="charge.mjs"
// node charge.mjs - needs kakitu.mjs from the Authentication page beside it.
import { randomUUID } from "node:crypto";
import { Wallet } from "ethers";
import { signedHeaders } from "./kakitu.mjs";

const BASE_URL = "https://walletapi.kakitu.org";
const wallet = new Wallet(process.env.KAKITU_PRIVATE_KEY);

// call() on the Authentication page sends no Idempotency-Key, and this route REQUIRES one,
// so build the request here instead.
export async function createCharge(body, key = randomUUID()) {
  const raw = JSON.stringify(body);                 // serialise ONCE, sign and send this string
  const headers = await signedHeaders(wallet, "POST", "/v1/charges", raw);
  headers["Content-Type"] = "application/json";
  // REQUIRED. Without it: 400 idempotency_key_required and no handset is rung.
  headers["Idempotency-Key"] = key;
  const res = await fetch(BASE_URL + "/v1/charges", { method: "POST", headers, body: raw });
  return { status: res.status, replayed: res.headers.get("Idempotent-Replayed") === "true",
           body: await res.json() };
}

const key = randomUUID();   // keep it: a retry must reuse THIS key, not a fresh one
const out = await createCharge({ amount: 500, phone: "254700000001", reference: "order-1042" }, key);
console.log(out.status, out.body.id, out.body.status);   // 201 ... "prompted" or "pending"
```

</TabItem>
<TabItem value="py" label="Python">

```python title="charge.py"
# python charge.py - needs kakitu.py from the Authentication page beside it.
import json
import os
import uuid

import requests
from eth_account import Account
from kakitu import BASE_URL, signed_headers

account = Account.from_key(os.environ["KAKITU_PRIVATE_KEY"])


# call() on the Authentication page sends no Idempotency-Key, and this route REQUIRES one,
# so build the request here instead.
def create_charge(payload, key=None):
    key = key or str(uuid.uuid4())
    raw = json.dumps(payload, separators=(",", ":")).encode()   # serialise ONCE, sign and send this
    headers = signed_headers(account, "POST", "/v1/charges", raw)
    headers["Content-Type"] = "application/json"
    # REQUIRED. Without it: 400 idempotency_key_required and no handset is rung.
    headers["Idempotency-Key"] = key
    res = requests.post(BASE_URL + "/v1/charges", headers=headers, data=raw, timeout=30)
    return res.status_code, res.headers.get("Idempotent-Replayed") == "true", res.json()


key = str(uuid.uuid4())   # keep it: a retry must reuse THIS key, not a fresh one
status, replayed, body = create_charge(
    {"amount": 500, "phone": "254700000001", "reference": "order-1042"}, key)
print(status, body["id"], body["status"])   # 201 ... "prompted" or "pending"
```

</TabItem>
<TabItem value="php" label="PHP">

```php title="charge.php"
<?php
// php charge.php - needs kakitu.php from the Authentication page beside it.
declare(strict_types=1);
require __DIR__ . '/kakitu.php';

// kakitu_call() on the Authentication page sends no Idempotency-Key, and this route REQUIRES
// one, so build the request here instead.
function create_charge(string $privateKeyHex, array $payload, string $key): array
{
    $raw = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);  // encode ONCE
    $headers = kakitu_headers($privateKeyHex, 'POST', '/v1/charges', $raw);
    $headers['Content-Type'] = 'application/json';
    // REQUIRED. Without it: 400 idempotency_key_required and no handset is rung.
    $headers['Idempotency-Key'] = $key;

    $lines = [];
    foreach ($headers as $k => $v) {
        $lines[] = "$k: $v";
    }
    $ch = curl_init(KAKITU_BASE_URL . '/v1/charges');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => $lines,
        CURLOPT_POSTFIELDS => $raw,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
    ]);
    $out = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return [$status, json_decode((string) $out, true)];
}

// Keep the key: a retry must reuse THIS one, not a fresh one.
$key = bin2hex(random_bytes(16));
[$status, $body] = create_charge(getenv('KAKITU_PRIVATE_KEY'), [
    'amount' => 500, 'phone' => '254700000001', 'reference' => 'order-1042',
], $key);
echo $status, ' ', $body['id'], ' ', $body['status'], PHP_EOL;   // 201 ... prompted or pending
```

</TabItem>
</Tabs>

Provisional response:

```json
{
  "id": "…",
  "reference": "order-1042",
  "amount": 500,
  "currency": "KES",
  "status": "prompted",
  "created_at": "2026-10-25T12:00:00Z",
  "paid_at": null,
  "settled_at": null
}
```

A field the server owns — `id`, `status`, `currency`, `created_at`, `paid_at`, `settled_at` — is tolerated and dropped if you echo it back from a charge you read, so round-tripping a charge object does not break. It is never obeyed. Any other unknown field is refused with `invalid_request`, and the message names it.

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
      "settled_at": "2026-10-25T12:01:03Z"
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
| `paid` | The rail says the payer paid. |
| `settled` | Your wallet has been credited on chain with the KSHS minted for this payment, which is less than `amount` ([why](./pricing#fees)). Final. |
| `failed` | The attempt did not complete. |
| `expired` | The charge ran out of time. |
| `cancelled` | Cancelled. Final. |

A charge only moves forward. `pending` can also stay `pending` if the rail accepted the order but could not confirm the prompt went out.

## Idempotency

**Every money-moving `POST` requires an `Idempotency-Key` header**: a string you generate, at most 255 characters, a UUID is ideal. It exists so a timeout never means a double charge: if you do not know whether a request worked, resend it with the **same key** and you get the original answer, not a second prompt.

- **Same key, same request:** the stored response is returned with the header `Idempotent-Replayed: true`. Only successful (2xx) responses are stored.
- **Same key, different body, path or query:** `409 idempotency_key_reuse`. A key names one request. Use a new key for a new request.
- **Same key while the first is still running:** `409 idempotency_key_in_progress`. Wait and retry with the same key.
- **No key:** `400 idempotency_key_required`. Over 255 characters: `400 idempotency_key_invalid`.
- **Store unavailable:** `503 idempotency_unavailable`. Retry with the same key.
- Keys are held for 24 hours.

### When a retry needs a new reference as well

If the payment rail refuses a charge **before** a handset is rung (for example `amount_below_minimum`, `amount_above_maximum`, or `rate_limited` for too many prompts to that payer), the key is released and you may reuse it. But the charge row and its `reference` were already written, so that **reference is now closed**. A retry must use **the same key and a new `reference`**, otherwise you get `409 reference_reused`. The error message says "retry with a new reference" when this applies.

Refusals made earlier, by Kakitu's own checks (not approved, malformed request, a reference you already used, your daily cap, per-charge maximum or per-minute rate), write no charge row, so the reference stays free. Fix the cause and retry.

### A 503 after the rail was asked

Once collections are on, `503 rail_unavailable` can also come **after** the charge row was written and the rail was asked to prompt the payer. Then the `reference` is consumed, and the payer's handset **may already have rung**: a rail that times out cannot tell us whether its prompt went out.

So **do not answer a `503` by retrying with a new `reference`** until you have checked. Read `GET /v1/charges?reference=<your reference>`: if a charge comes back, that attempt exists and may still be paid; follow its status rather than prompting the payer again. Only when no charge exists for that reference is a fresh attempt safe.

### idempotency_key_acted

If the original request reached the rail, so a handset may have been rung, but the outcome could not be recorded, every retry in the 24-hour window gets `409 idempotency_key_acted`. **Do not retry with this key or a new one.** Fetch the charge by `reference` or contact support first. Sending again could prompt the payer twice.

## Limits

Per-merchant daily and per-charge caps, a per-minute rate and a per-payer daily prompt limit apply. See [Rate limits](./rate-limits).
