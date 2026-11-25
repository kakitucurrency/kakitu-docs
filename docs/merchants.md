---
sidebar_position: 4
title: Merchants
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Merchants

A merchant is a business Kakitu has checked. It is identified by its wallet address: the address shoppers pay, and the address that signs its API requests.

## Becoming a merchant

1. **Create the business wallet in the Kakitu app** and write down its 12 words.
2. **Add the Kakitu extension to Chrome** and restore the same wallet there.
3. **Sign in at [kakitu.org/merchant](https://kakitu.org/merchant)** with the extension. The extension asks you to approve a sign-in that says "Signing in cannot move money." No password, no SMS, and no website ever asks for your 12 words.
4. **Apply**: business name (2 to 100 characters), type of business (`shop`, `food`, `beauty`, `transport`, `services`, `online` or `other`), where it is (3 to 200 characters, plus an optional map pin inside Kenya), and a Kenyan mobile number, which is stored as `2547…` or `2541…` (a number that does not fit that form is refused). Your merchant is now `pending`.
5. **Kakitu decides.** A person reviews the application. The page checks by itself and opens your dashboard once you are `approved`. A rejection shows the reason, and you can correct the application and send it again.

Once approved:

- **The dashboard** at kakitu.org/merchant lists the KSHS transfers into your wallet, newest first, with each payer's `reference`; totals for today, the last 7 and the last 30 days (East Africa Time); and a CSV export of up to 92 days at a time. It is read-only: signing in to it cannot move money.
- **Shoppers will see you are verified**, once the badge is switched on: a shopper paying your address from Kakitu extension 0.2.8 or later sees **Verified Kakitu merchant** and your business name. It is not shown yet; [the verified-merchant badge](./extension#the-verified-merchant-badge) says exactly what the extension shows today.
- **The API** is open to your wallet's signature, but server-side signing for wallets made in the Kakitu app is coming soon: see [the quickstart](./quickstart#server-side-signing).

The dashboard's routes (`/merchant/*` on `walletapi.kakitu.org`) serve kakitu.org only: sign-in is accepted from kakitu.org and nowhere else. Build your own integration on the `/v1` API and [`GET /transfers`](./transfers#get-transfers), not on them.

The two `/v1` endpoints below read your merchant record and update its contact details and callback URL. **Neither makes a merchant**: the application at kakitu.org/merchant and Kakitu's approval are the only way to become one.

## States

| `state` | Meaning |
|---|---|
| `pending` | Applied, not reviewed yet. |
| `approved` | Kakitu reviewed and approved it. The dashboard, transfers and webhooks work, and the verified badge once it is switched on. Only `POST /v1/transfers`, the payout-sending routes and saving a payout destination check this state. |
| `rejected` | Kakitu declined it. The reason is shown at kakitu.org/merchant; correct the application and send it again. |
| `suspended` | Kakitu stopped it. No badge and no dashboard. The routes that move money refuse it; reading its own record and events still works. |

You cannot change `state` yourself. See [Going live](./going-live).

### If Kakitu entered you by hand

Kakitu can create a merchant from an address you give it, so the paperwork can be done first. That row is created `pending`, with your details already filled in.

**It cannot be approved until that address proves it holds its key**: sign in at kakitu.org/merchant with the extension and send the application. That updates the existing row rather than creating a second one.

That gate is not bureaucracy. The address is where your money is paid, **on chain**. Somebody typing it proves the characters were typed — not that you hold the key, and not that the address is right. If it is wrong by one character, or it is a wallet you cannot spend from, every payment you ever take is gone and there is nobody to ask for it back. A signed request is the only thing that proves the key is yours. It approves nothing by itself; it only clears the way for Kakitu's decision.

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

## POST /v1/merchants

Updates the contact email, contact phone and callback URL of the signing wallet's merchant. Signed request; no `Idempotency-Key` is needed because it does not move money.

**It does not make a merchant, and it is not a way to apply.** It works only for a wallet Kakitu has already approved through the application at [kakitu.org/merchant](https://kakitu.org/merchant). Any other wallet, including one whose application is still `pending`, gets `404 merchant_not_found` and nothing is saved. Send `business_name` exactly as you applied with it: it is frozen once you are reviewed, and this route cannot change it.

| Field | Type | Rules |
|---|---|---|
| `business_name` | string, required | 1 to 100 characters. No control, invisible or text-direction characters. The name Kakitu vetted and the name on the verified badge. Must be the name you applied with: it is frozen. |
| `contact_email` | string, required | A plain address such as `a@b.co`. `Name <a@b.co>` is refused. At most 254 characters. |
| `contact_phone` | string, optional | At most 20 characters: digits, `+`, spaces and hyphens only. |
| `callback_url` | string, optional | See [callback URLs](#callback-urls). |

The body is limited to 16 KiB (`request_too_large`, 413).

<Tabs groupId="lang">
<TabItem value="curl" label="cURL" default>

```bash
# No Idempotency-Key: it moves no money.
kakitu POST /v1/merchants '{
  "business_name": "Mama Njeri Groceries",
  "contact_email": "njeri@example.com",
  "callback_url": "https://shop.example.com/kakitu/webhooks"
}'
```

`200` with your merchant record. The address in the answer is the one that signed: you never
send it, and a body that could name another wallet would let anybody change somebody else's
callback URL.

```bash
# Absent and null both LEAVE A FIELD ALONE. Only "" clears it.
kakitu POST /v1/merchants '{"business_name":"Mama Njeri Groceries","contact_email":"njeri@example.com","callback_url":""}'
```

</TabItem>
<TabItem value="ts" label="TypeScript">

```ts title="contact.mjs"
// node contact.mjs - needs kakitu.mjs from the Authentication page beside it.
import { Wallet } from "ethers";
import { call } from "./kakitu.mjs";

const wallet = new Wallet(process.env.KAKITU_PRIVATE_KEY);

// No Idempotency-Key: it moves no money, so call() is the whole of it.
const { status, body } = await call(wallet, "POST", "/v1/merchants", {
  business_name: "Mama Njeri Groceries",
  contact_email: "njeri@example.com",                 // plain address; "Name <a@b.co>" is refused
  callback_url: "https://shop.example.com/kakitu/webhooks",
  // contact_phone omitted: an ABSENT field (and an explicit null) leaves the stored value
  // alone. Only "" clears one. That is what stops a misspelt key wiping a webhook URL.
});

console.log(status);          // 200; 404 merchant_not_found if this wallet is not an approved merchant
console.log(body.address);    // the wallet that SIGNED - never a field you send
console.log(body.state);      // "approved": you cannot set this, and sending it is dropped
```

</TabItem>
<TabItem value="py" label="Python">

```python title="contact.py"
# python contact.py - needs kakitu.py from the Authentication page beside it.
import os

from eth_account import Account
from kakitu import call

account = Account.from_key(os.environ["KAKITU_PRIVATE_KEY"])

# No Idempotency-Key: it moves no money, so call() is the whole of it.
status, body = call(account, "POST", "/v1/merchants", {
    "business_name": "Mama Njeri Groceries",
    "contact_email": "njeri@example.com",   # plain address; "Name <a@b.co>" is refused
    "callback_url": "https://shop.example.com/kakitu/webhooks",
    # contact_phone omitted: an ABSENT field (and an explicit None) leaves the stored value
    # alone. Only "" clears one. That is what stops a misspelt key wiping a webhook URL.
})

print(status)            # 200; 404 merchant_not_found if this wallet is not an approved merchant
print(body["address"])   # the wallet that SIGNED - never a field you send
print(body["state"])     # "approved": you cannot set this, and sending it is dropped
```

</TabItem>
<TabItem value="php" label="PHP">

```php title="contact.php"
<?php
// php contact.php - needs kakitu.php from the Authentication page beside it.
declare(strict_types=1);
require __DIR__ . '/kakitu.php';

// No Idempotency-Key: it moves no money, so kakitu_call() is the whole of it.
[$status, $body] = kakitu_call(getenv('KAKITU_PRIVATE_KEY'), 'POST', '/v1/merchants', [
    'business_name' => 'Mama Njeri Groceries',
    'contact_email' => 'njeri@example.com',   // plain address; "Name <a@b.co>" is refused
    'callback_url' => 'https://shop.example.com/kakitu/webhooks',
    // contact_phone omitted: an ABSENT field (and an explicit null) leaves the stored value
    // alone. Only '' clears one. That is what stops a misspelt key wiping a webhook URL.
]);

echo $status, PHP_EOL;            // 200; 404 merchant_not_found if this wallet is not an approved merchant
echo $body['address'], PHP_EOL;   // the wallet that SIGNED - never a field you send
echo $body['state'], PHP_EOL;     // "approved": you cannot set this, and sending it is dropped
```

</TabItem>
</Tabs>

**Unknown fields are refused** with `invalid_request`, and the message names the field. A misspelt key fails loudly instead of being ignored. The exception is a small set of fields you must never set: `state`, `webhook_secret`, `daily_cap_kes`, `per_charge_max_kes`, `address`, `reviewed_by`, `review_note`. If you send one it is accepted and **dropped**, and the answer shows the real stored values. A client that sends `"daily_cap_kes": 1000000` gets `200` with the cap Kakitu set.

Response: `200`. The body is the merchant record:

```json
{
  "address": "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
  "business_name": "Mama Njeri Groceries",
  "contact_email": "njeri@example.com",
  "contact_phone": "",
  "callback_url": "",
  "state": "approved",
  "daily_cap_kes": 0,
  "per_charge_max_kes": 0,
  "payout_locked": false
}
```

| Field | Meaning |
|---|---|
| `address` | The wallet that signed. It is the merchant. |
| `business_name` | The name Kakitu vetted. |
| `contact_email`, `contact_phone`, `callback_url` | Yours to update with this route. `""` when unset. |
| `state` | `pending`, `approved`, `rejected` or `suspended`. See [States](#states). |
| `daily_cap_kes`, `per_charge_max_kes` | Set by Kakitu. `0` means no per-merchant value has been set, and the platform default then applies. |
| `payout_locked` | Whether your [payout lock](./payouts#saved-destinations-and-the-lock) binds now. Always present. |
| `payout_unlocks_at` | RFC 3339 UTC. **Present only while an unlock is pending**: when the lock comes off. |

The webhook secret is never in this record, and neither are the application's own fields (type of business, location, when you applied): those are on kakitu.org/merchant.

### Clearing and leaving fields alone

For `contact_phone` and `callback_url` there are three cases, and they differ:

| You send | Result |
|---|---|
| the field absent | Stored value is **unchanged** |
| `null` | Stored value is **unchanged** |
| `""` (empty string) | Stored value is **cleared** |
| a value | Stored value is replaced |

Why: an omitted or misspelt field must never silently wipe a webhook URL and stop deliveries with nobody told. To clear, say so explicitly with `""`.

### business_name is frozen

`business_name` cannot be changed through the API. A request with a different name is refused with `409 merchant_name_frozen` and **nothing in that request is saved**. Why: it is the name Kakitu vetted and the name shoppers see on the verified badge, so it is fixed after vetting. A rename needs Kakitu: write to kakitu@kakitu.org.

Resubmitting the **same** name with new contact details is fine.

### A wallet with an open loan

A wallet that has an open Kakitu loan (a feature of the Kakitu app) cannot become a merchant: the application is refused, and `409 open_loan` means **nothing in the request was saved**. Apply once the loan is closed, or apply with a wallet made for the business, as the [quickstart](./quickstart#why-a-separate-wallet) recommends anyway.

### Callback URLs

`callback_url` is where webhooks will be delivered (see [Webhooks](./webhooks)). **This route is the only way to set it**: the application at kakitu.org/merchant has no callback field, so an approved merchant receives no webhooks until it has set one here. It is validated when you set it, so a bad one fails now rather than silently later. It must be:

- `https`, on port 443, at most 512 characters, no credentials in the URL, no whitespace.
- **Public.** Loopback, private, link-local and other reserved addresses are refused, as are `localhost`, `.local`, `.internal`, `.lan` and similar names, and wildcard-DNS names such as `nip.io` that resolve to private addresses. The reason is that webhooks are fetched by our servers, and a private target would let a callback URL point us at internal systems.
- **ASCII in the hostname.** A non-ASCII hostname is refused. Give it in **punycode**: `https://xn--exmple-cua.com/hook`, not `https://exämple.com/hook`. Why: the same name can be written in visually identical ways, and we validate what we will actually connect to.

Failures return `invalid_request` with a message saying which rule was broken.

## GET /v1/merchants/me

Returns the merchant record for the signing wallet. No body.

- `200`: the record above.
- `404 merchant_not_registered`: this wallet has no merchant record. Apply at kakitu.org/merchant.

Use it to read your `state`, which is how you know you have been approved.

<Tabs groupId="lang">
<TabItem value="curl" label="cURL" default>

```bash
kakitu GET /v1/merchants/me | jq -r '.state'
```

`404 merchant_not_registered` if this wallet has no merchant record.

</TabItem>
<TabItem value="ts" label="TypeScript">

```ts title="me.mjs"
import { Wallet } from "ethers";
import { call } from "./kakitu.mjs";

const wallet = new Wallet(process.env.KAKITU_PRIVATE_KEY);
const { status, body } = await call(wallet, "GET", "/v1/merchants/me");

if (status === 404) throw new Error("this wallet has no merchant record");   // merchant_not_registered
console.log(body.state);   // pending | approved | rejected | suspended
```

</TabItem>
<TabItem value="py" label="Python">

```python title="me.py"
import os

from eth_account import Account
from kakitu import call

account = Account.from_key(os.environ["KAKITU_PRIVATE_KEY"])
status, body = call(account, "GET", "/v1/merchants/me")

if status == 404:   # merchant_not_registered
    raise SystemExit("this wallet has no merchant record")
print(body["state"])   # pending | approved | rejected | suspended
```

</TabItem>
<TabItem value="php" label="PHP">

```php title="me.php"
<?php
declare(strict_types=1);
require __DIR__ . '/kakitu.php';

[$status, $body] = kakitu_call(getenv('KAKITU_PRIVATE_KEY'), 'GET', '/v1/merchants/me');

if ($status === 404) {   // merchant_not_registered
    exit("this wallet has no merchant record\n");
}
echo $body['state'], PHP_EOL;   // pending | approved | rejected | suspended
```

</TabItem>
</Tabs>

