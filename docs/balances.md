---
sidebar_position: 10
title: Balances
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Balances

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

## GET /v1/balances

The balances of **the wallet that signed the request**, read live from the chain. Signed request, no body, no `Idempotency-Key`.

```json
HTTP 200
{
  "kshs": { "amount_kes": 1250, "network": "base" },
  "usdc": { "amount": "3.5", "network": "base" }
}
```

| Field | Meaning |
|---|---|
| `kshs.amount_kes` | Your KSHS balance in whole shillings, as a number. 1 KSHS is 1 KES. |
| `usdc.amount` | Your USDC balance as a **decimal string**, so no precision is lost on the way through JSON. |
| `network` | The chain the balance is on. |

You do not have to be a registered merchant to read this. Any wallet that can sign can read its own balances.

<Tabs groupId="lang">
<TabItem value="curl" label="cURL" default>

```bash
kakitu GET /v1/balances
```

```json
{"kshs":{"amount_kes":1250,"network":"base"},"usdc":{"amount":"3.5","network":"base"}}
```

`usdc.amount` arrives as a JSON **string**. Keep it one: `jq -r .usdc.amount` gives you the
digits, `jq .usdc.amount | tonumber` throws the precision away.

</TabItem>
<TabItem value="ts" label="TypeScript">

```ts title="balances.mjs"
// node balances.mjs - needs kakitu.mjs from the Authentication page beside it.
import { Wallet } from "ethers";
import { call } from "./kakitu.mjs";

const wallet = new Wallet(process.env.KAKITU_PRIVATE_KEY);
const { body } = await call(wallet, "GET", "/v1/balances");

// kshs.amount_kes is a NUMBER (whole shillings). usdc.amount is a STRING, deliberately.
// `Number(body.usdc.amount)` compiles, runs, and quietly loses precision on a big balance:
// a typed client that declares `amount: number` fails on this route.
console.log(body.kshs.amount_kes, body.kshs.network);   // 1250 base
console.log(body.usdc.amount, body.usdc.network);       // "3.5" base
```

</TabItem>
<TabItem value="py" label="Python">

```python title="balances.py"
# python balances.py - needs kakitu.py from the Authentication page beside it.
import os
from decimal import Decimal

from eth_account import Account
from kakitu import call

account = Account.from_key(os.environ["KAKITU_PRIVATE_KEY"])
status, body = call(account, "GET", "/v1/balances")

# kshs.amount_kes is an int (whole shillings). usdc.amount is a str, deliberately: hand it to
# Decimal, never to float(), and never to a model that declares it a number.
print(body["kshs"]["amount_kes"], body["kshs"]["network"])   # 1250 base
print(Decimal(body["usdc"]["amount"]), body["usdc"]["network"])
```

</TabItem>
<TabItem value="php" label="PHP">

```php title="balances.php"
<?php
// php balances.php - needs kakitu.php from the Authentication page beside it.
declare(strict_types=1);
require __DIR__ . '/kakitu.php';

[$status, $body] = kakitu_call(getenv('KAKITU_PRIVATE_KEY'), 'GET', '/v1/balances');

// kshs.amount_kes is an int (whole shillings). usdc.amount is a string, deliberately.
// Leave it a string, or use bcmath; (float) $body['usdc']['amount'] loses precision.
echo $body['kshs']['amount_kes'], ' ', $body['kshs']['network'], PHP_EOL;  // 1250 base
echo $body['usdc']['amount'], ' ', $body['usdc']['network'], PHP_EOL;      // 3.5 base
```

</TabItem>
</Tabs>

## Both say their network

Both balances state `"base"`, and both will keep saying it even if we never support a second chain.

The reason is not tidiness. **A customer has already lost money sending a token to a Kakitu address on the wrong chain.** An address looks identical on every EVM network, so an integrator who has to *infer* which one an address is for will eventually infer wrong, and the money does not come back. Stating it costs one field.

A related warning worth repeating: this endpoint reads a balance, it does not create a deposit address. Sending a token to your address from outside Kakitu is not how you fund an account, and nothing credits it.

## Zero is an answer

An address with no history holds zero, and the chain says so. You get `200` with zeros, not a `404`. There is no "account not found" here, because there are no accounts — only addresses.

## You can only read your own

The subject is the address that signed the request, and nothing else can name it. An `?address=` query parameter is not honoured: it is ignored, and you get your own balances. Your credential *is* the subject. See [Authentication](./authentication).

## Errors

| `code` | HTTP | When |
|---|---|---|
| `unauthorized` | 401 | The request was not signed, or the signature did not verify. |
| `rail_unavailable` | 503 | Balance reads are temporarily unavailable. Retry shortly. |
| `internal` | 500 | The chain could not be read. Quote the `request_id`. |

A chain that cannot be reached is `internal`, not an empty balance. We would rather tell you we do not know than tell you zero.
