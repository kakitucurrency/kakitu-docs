---
sidebar_position: 11
title: Limits
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Limits

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

## GET /v1/limits

Two things: the current withdrawal band — the smallest and largest payout the rail will accept — and, if you are a registered merchant, **your own payout limits**. Signed request, no body, no `Idempotency-Key`.

<Tabs groupId="lang">
<TabItem value="curl" label="cURL" default>

```bash
kakitu GET /v1/limits
```

```bash
# `payout` is ABSENT for a wallet that never registered as a merchant. Test for the key:
kakitu GET /v1/limits | jq 'if has("payout") then .payout else "not a merchant" end'

# remaining_today_kes is null when the counter could not be read. null is NOT zero.
kakitu GET /v1/limits | jq -r '.payout.remaining_today_kes // "unknown"'
```

</TabItem>
<TabItem value="ts" label="TypeScript">

```ts title="limits.mjs"
// node limits.mjs - needs kakitu.mjs from the Authentication page beside it.
import { Wallet } from "ethers";
import { call } from "./kakitu.mjs";

const wallet = new Wallet(process.env.KAKITU_PRIVATE_KEY);
const { body } = await call(wallet, "GET", "/v1/limits");

// source is "live" or "estimated". Read max_staleness_seconds; do not hardcode 300.
console.log(body.withdrawal.min_kes, body.withdrawal.max_kes, body.withdrawal.source);
console.log(body.max_staleness_seconds);

// `payout` is ABSENT - not null, not {} - for a wallet that never registered as a merchant.
// `body.payout.enabled` straight off throws on an ordinary customer, which is a 200, not an
// error condition.
if (body.payout) {
  const p = body.payout;
  // remaining_today_kes is null when the counter could not be read, and null is NOT zero.
  const remaining = p.remaining_today_kes === null ? "unknown" : p.remaining_today_kes;
  console.log(p.enabled, p.max_kes, p.daily_cap_kes, p.hold_above_kes, remaining);
  // "Above" is strict: a payout exactly equal to hold_above_kes is dispatched, not held.
  const willBeHeld = (kes) => kes > p.hold_above_kes;
  console.log(willBeHeld(p.hold_above_kes));   // false
}
```

</TabItem>
<TabItem value="py" label="Python">

```python title="limits.py"
# python limits.py - needs kakitu.py from the Authentication page beside it.
import os

from eth_account import Account
from kakitu import call

account = Account.from_key(os.environ["KAKITU_PRIVATE_KEY"])
status, body = call(account, "GET", "/v1/limits")

w = body["withdrawal"]
# source is "live" or "estimated". Read max_staleness_seconds; do not hardcode 300.
print(w["min_kes"], w["max_kes"], w["source"], body["max_staleness_seconds"])

# "payout" is ABSENT - not None, not {} - for a wallet that never registered as a merchant.
# body["payout"] straight off raises KeyError on an ordinary customer, which is a 200.
p = body.get("payout")
if p is not None:
    # remaining_today_kes is None when the counter could not be read, and None is NOT zero.
    remaining = "unknown" if p["remaining_today_kes"] is None else p["remaining_today_kes"]
    print(p["enabled"], p["max_kes"], p["daily_cap_kes"], p["hold_above_kes"], remaining)
    # "Above" is strict: a payout exactly equal to hold_above_kes is dispatched, not held.
    print(p["hold_above_kes"] > p["hold_above_kes"])   # False
```

</TabItem>
<TabItem value="php" label="PHP">

```php title="limits.php"
<?php
// php limits.php - needs kakitu.php from the Authentication page beside it.
declare(strict_types=1);
require __DIR__ . '/kakitu.php';

[$status, $body] = kakitu_call(getenv('KAKITU_PRIVATE_KEY'), 'GET', '/v1/limits');

$w = $body['withdrawal'];
// source is "live" or "estimated". Read max_staleness_seconds; do not hardcode 300.
echo $w['min_kes'], ' ', $w['max_kes'], ' ', $w['source'], ' ', $body['max_staleness_seconds'], PHP_EOL;

// "payout" is ABSENT - not null, not [] - for a wallet that never registered as a merchant.
// array_key_exists, not isset: isset() is also false for a key whose value is null.
if (array_key_exists('payout', $body)) {
    $p = $body['payout'];
    // remaining_today_kes is null when the counter could not be read, and null is NOT zero.
    $remaining = $p['remaining_today_kes'] ?? 'unknown';
    echo $p['enabled'] ? 'on' : 'off', ' ', $p['max_kes'], ' ', $p['daily_cap_kes'], ' ',
         $p['hold_above_kes'], ' ', $remaining, PHP_EOL;
    // "Above" is strict: a payout exactly equal to hold_above_kes is dispatched, not held.
    $willBeHeld = fn (int $kes): bool => $kes > $p['hold_above_kes'];
    var_dump($willBeHeld($p['hold_above_kes']));   // false
}
```

</TabItem>
</Tabs>

The response:

```json
HTTP 200
{
  "withdrawal": {
    "min_kes": 200,
    "max_kes": 60000,
    "source": "live"
  },
  "payout": {
    "enabled": true,
    "max_kes": 50000,
    "daily_cap_kes": 200000,
    "hold_above_kes": 20000,
    "remaining_today_kes": 143500,
    "note": "max_kes, daily_cap_kes and hold_above_kes are exact: they are read from the same place the limits are enforced. remaining_today_kes is a snapshot and may already be lower by the time you read it, because another payout of yours can land in between; it is null when it could not be read, which does not mean zero. The day resets at midnight East Africa Time. A payout above hold_above_kes is accepted and held for a person to review, which is a normal outcome and not an error."
  },
  "max_staleness_seconds": 300,
  "note": "The withdrawal band is cached and refreshed about every five minutes, so after the payout route is switched it can be up to five minutes out of date. A quote, not this band, is what decides whether an amount is accepted."
}
```

The two halves are not the same kind of number. The **withdrawal band** is the rail's, shared by everybody, and cached. The **payout block** is yours, and exact.

## `source` says whether the band is real

| `source` | Meaning |
|---|---|
| `live` | The band was read from the payout route itself. These are the real numbers. |
| `estimated` | The payout route has not answered, so these are our configured fallback. Treat them as a guide. |

We publish the fallback rather than an error, because an app that can show a customer *roughly* what is allowed is more useful than one that shows nothing. But we label it, because a guess presented as a fact is worse than both.

## `max_staleness_seconds` is a promise, not a timestamp

It is **the longest this band can be behind the payout route** — not how old this particular answer is.

The band is cached and refreshed on a timer. If an operator switches the payout route, the cache can describe the previous one until the next refresh. `max_staleness_seconds` is that refresh interval, read from the same setting that drives the refresh, so it cannot quietly promise a freshness nobody is maintaining.

Today it is `300`. Do not hardcode that: read it. If an operator widens the refresh interval, this number widens with it, and code that assumed five minutes would be wrong without anything looking broken.

## The band does not decide anything

**A [quote](./quotes) decides whether an amount is accepted. This band does not.**

Use it to shape a form — to grey out an obviously impossible amount, or to tell someone the rough range before they type. Do not use it to promise that a particular amount will go through, and do not treat a quote that disagrees with it as a bug. The quote is live; this is a cache.

## `payout` — your own limits {#payout-limits}

This is what governs [payouts](./payouts), published so you do not have to learn it by being refused.

| Field | Meaning |
|---|---|
| `enabled` | Whether you may pay out at all. |
| `max_kes` | The largest single payout. Over it: `400 payout_amount_above_maximum`. |
| `daily_cap_kes` | Today's budget. Over it: `429 payout_daily_cap_exceeded`. |
| `hold_above_kes` | A payout **above** this is accepted and held for a person. |
| `remaining_today_kes` | What is left of `daily_cap_kes`, or `null`. |
| `note` | The caveats below, in a sentence. |

### The whole object is missing if you are not a merchant

`payout` is **absent — not `null`, not an empty object** — for a caller that has not registered as a merchant. `GET /v1/limits` is a wallet route too, and an ordinary customer has no payout limits to be told about.

So test for the key before reading it. A client that does `limits.payout.enabled` straight off will crash on a wallet that simply never registered, which is not an error condition and gets a `200`.

### `enabled` is one fact, not two

Payouts have two switches: a platform-wide one and your merchant's own. **`enabled` is both of them ANDed together, and it will not tell you which is off.**

That is deliberate, and it matches the refusal: `payouts_disabled` does not say which switch it is either. Which one an operator has moved is an operator's business, and an endpoint that told you would let anyone probe how the platform is configured. If `enabled` is `false`, write to **kakitu@kakitu.org** — the answer is the same either way.

The three numbers are published regardless. A `false` with real caps still tells you what you would be allowed if payouts were switched on for you.

### The three caps are exact

`max_kes`, `daily_cap_kes` and `hold_above_kes` are read from the same place the enforcement reads them — not from a second copy that could drift. A limit published here that disagreed with the one enforced would be worse than publishing nothing, because you would build against a number we do not honour. There is nothing to drift from.

`hold_above_kes` is the one worth acting on. **A held payout is a normal, expected outcome and not an error**, and knowing this number lets you tell someone "this one needs review" *before* asking them to sign rather than after. "Above" is strict: a payout exactly equal to `hold_above_kes` is dispatched, not held. A threshold of `0` holds everything, which is the setting an operator reaches for when something is wrong.

### `remaining_today_kes` is a snapshot, and `null` is not zero

It is what is left of `daily_cap_kes`, floored at zero — read from the same counter the accept increments, so it can never disagree with the cap. It can only be **behind** it: another payout of your own can land between this read and your next request, so it may already be lower by the time you act on it.

**It is `null` when the counter could not be read, and `null` never means zero.** A budget that cannot be read is not an empty one. Publishing `0` there would tell you that you are out of money when you are not, so we publish nothing and say so. Treat `null` as "unknown" and go ahead and quote.

Nothing here authorises an amount. **A [payout quote](./payouts#post-v1payoutsquote) does that**, and it checks the budget for real at the moment you ask.

The day resets at **midnight East Africa Time**, not UTC.

## Errors

| `code` | HTTP | When |
|---|---|---|
| `unauthorized` | 401 | The request was not signed. |
| `rail_unavailable` | 503 | The band is unavailable. Retry shortly. |

There is no error for the payout block. If your merchant row or the payout counter cannot be read, the block is dropped and the withdrawal band is still returned: a merchant-only extra must never be a reason a wallet customer stops getting what they came for.

## Limits this endpoint does not cover

It publishes the **withdrawal** band and your **payout** limits. These live elsewhere:

| Limit | Where |
|---|---|
| Your daily collection cap and per-charge maximum | `daily_cap_kes` and `per_charge_max_kes` in [`GET /v1/merchants/me`](./merchants) |
| The largest single [transfer](./transfers) | `relay_max_per_tx_kes` in `GET /config` |
| Requests per minute, prompts per payer, charges per minute | [Rate limits](./rate-limits) |
