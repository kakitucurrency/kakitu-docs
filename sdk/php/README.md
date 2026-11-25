# Kakitu PHP SDK

A PHP 8.1+ client for the Kakitu developer API, usable from Laravel, Symfony or plain PHP. There is no WooCommerce plugin; this is a library you call from your own code.

**Not published.** `kakitu/kakitu-php` is not on Packagist: `composer require kakitu/kakitu-php` fails. Install it from this repository (below), or sign requests directly with the complete signers on [Authentication](https://developer.kakitu.org/docs/authentication).

**Status:** merchants apply at [kakitu.org/merchant](https://kakitu.org/merchant) and Kakitu approves them; no API call makes a merchant. Take payment today with a KSHS transfer and a `reference`, and read it with `transfers->list()`. `charges->create()` is not available (coming back as a KSHS payment request), and the payout-sending calls and `payoutDestinations->save()` are not available (coming back, paid through KCB). See [what is live](https://developer.kakitu.org/docs/going-live#what-is-live).

**Server-side signing is coming soon.** This SDK signs with a hex private key. There is no safe way yet to get the key of a wallet made in the Kakitu app onto a server: the app and the extension do not export one. **Never type your 12 words into a script or tool to work one out.** See [the quickstart](https://developer.kakitu.org/docs/quickstart#server-side-signing).

Kakitu authenticates by **request signing**, not a bearer token: every request is signed with your
wallet's private key. This SDK does that for you. You never build a signature, a timestamp or a header.

## Quickstart

```bash
# Composer cannot install from a subfolder of a git repository, so clone it and point
# Composer at the folder
git clone --depth 1 https://github.com/kakitucurrency/kakitu-docs
composer config repositories.kakitu path ./kakitu-docs/sdk/php
composer require kakitu/kakitu-php:@dev
```

Put the private key in an environment variable or your host's secret store. Never in code,
never in git.

```php
<?php
require 'vendor/autoload.php';

use Kakitu\Kakitu;

$kakitu = new Kakitu([
    'private_key' => getenv('KAKITU_PRIVATE_KEY'),   // 64 hex chars; e.g. YOUR_PRIVATE_KEY_HERE
]);

// 1. Your state, after applying at kakitu.org/merchant.
echo $kakitu->merchants->me()['state'];   // "pending", then "approved"

// 2. Your payments, newest first, with each payer's reference (their claim, not proof).
foreach ($kakitu->transfers->autoPagingIterator(['limit' => 100]) as $t) {
    if ($t['direction'] === 'in') {
        echo $t['tx_hash'], ' ', $t['amount_kes'], ' ', $t['reference'] ?? '-', PHP_EOL;
    }
}

// 3. Once approved: contact details and callback URL. This does not make a merchant.
$kakitu->merchants->update([
    'business_name' => 'Mama Njeri Fabrics',   // exactly as you applied
    'contact_email' => 'pay@mamanjeri.example',
    'callback_url'  => 'https://mamanjeri.example/kakitu/webhook',
]);
```

`merchants->register()` is a deprecated alias of `merchants->update()`; the route no longer registers anybody.

## What's covered

| Resource | Methods |
| --- | --- |
| `$kakitu->merchants` | `update` (`register` is a deprecated alias), `me` |
| `$kakitu->charges` | `get`, `list`, `autoPagingIterator` (past charges); `create` is not available |
| `$kakitu->transfers` | `create`, `list`, `autoPagingIterator` (`GET /transfers`) |
| `$kakitu->balances` | `retrieve` |
| `$kakitu->orders` | `get` |
| `$kakitu->limits` | `retrieve` |
| `$kakitu->quotes` | `create`: not available today |
| `$kakitu->events` | `list`, `autoPagingIterator`, `replay` |
| `$kakitu->payouts` | `get`, `list`, `autoPagingIterator` (past payouts); `request`, `quote`, `create` are not available |
| `$kakitu->payoutDestinations` | `list`, `remove`, `setLock`; `save` answers `payouts_disabled` while payouts are off |

Every method returns the decoded JSON array. Closed sets live in `Kakitu\ErrorCode`,
`Kakitu\PayoutState` and `Kakitu\EventType` — switch on those constants, never on a message.

## You sign the money; the SDK signs the request

Two different signatures live in this API, and confusing them is the single most common mistake.

The `X-Kakitu-Signature` this SDK adds to **every** request authenticates *you to the API*. It
authorises nothing on chain.

`transfers->create()` and `payouts->create()` move KSHS out of your wallet, and that needs a signature
**you** produce with your own wallet key, over on-chain structured data:

* `v` / `r` / `s` — an **EIP-2612 permit**, signed under the **token's** EIP-712 domain.
* `iv` / `ir` / `is` — an **EIP-712 `Relay(owner,to,value,deadline,nonce)` intent**, signed under the
  **forwarder's** domain.

**This SDK does not and cannot produce them.** Kakitu holds no keys and signs nothing on your behalf;
it only pays the gas. Build both with your own signing stack and hand them over:

```php
$transfer = [
    'from' => $kakitu->address(), 'to' => '0xRecipient',
    'value_wei' => '1000000000000000000000',   // a STRING, always
    'deadline' => time() + 300,
    'v' => $v, 'r' => $r, 's' => $s,           // EIP-2612 permit, TOKEN domain
    'iv' => $iv, 'ir' => $ir, 'is' => $is,     // EIP-712 Relay intent, FORWARDER domain
];
$result = $kakitu->transfers->create($transfer);   // ['id' => '0x…', 'status' => 'pending'|'confirmed']
```

`value_wei` must stay a **string**: through a PHP float `1000000000000000000000` becomes `1.0E+21` and
the signature will not verify. The SDK refuses a non-string rather than let that reach the wire, and
refuses a half-signed transfer (a missing `is`, say) before it costs a round trip.

## Payouts (not available)

**Payouts are not available today**: they are coming back, paid through KCB. While they are off, `payouts->quote()` and `payouts->request()` answer `payouts_disabled` and `payouts->create()` answers `payout_quote_not_found`. The shape below is the API as it stood and will change.

```php
$quote = $kakitu->payouts->quote([
    'amount_kes' => 5000,                                             // what LANDS on them
    'beneficiary' => ['phone' => '254712345678', 'name' => 'A Mwangi'],
]);
// sign $quote['value_wei'] to $quote['treasury_address'] by $quote['deadline'], using
// $quote['eip712']['permit'] for the permit and $quote['eip712']['relay'] for the intent
$payout = $kakitu->payouts->create($quote['quote_id'], $transfer);

if ($payout['status'] === PayoutState::HELD) {
    // NORMAL, not an error: above your hold_above_kes, a person reviews it before it is sent.
    // Poll $kakitu->payouts->get($payout['id']) for the outcome.
}
```

The quote id is **single use** and expires, and a quote from `quotes->create()` is not one of these —
that route has no merchant, no approval and no payout cap behind it, so it is refused here on purpose.
The ten states are in `Kakitu\PayoutState`; `paid`, `failed`, `cancelled`, `rejected` and `expired` are
terminal (`PayoutState::isTerminal()`) and a retry is a **new** payout. `$kakitu->limits->retrieve()['payout']`
gives you `hold_above_kes`, `max_kes` and `daily_cap_kes` up front, so you never learn them by being
refused.

## Pagination

`charges`, `events` and `payouts` page identically: an opaque `cursor`, `limit` 1-100 (default 20), and
a `next_cursor` that is `null` on the last page. Pass `next_cursor` back unchanged — never parse one,
build one, or carry one from one list to another.

```php
foreach ($kakitu->payouts->autoPagingIterator(['status' => PayoutState::HELD]) as $payout) {
    echo $payout['id'];          // follows next_cursor for you, one page at a time
}

$page = $kakitu->payouts->list(['limit' => 50]);   // or hold the cursor yourself
echo count($page['data']), $page['next_cursor'];
```

Each page is a separate signed request against your rate limit, fetched lazily; `break` and no further
page is requested.

## Errors

Every failure is a `Kakitu\Exception\KakituException` carrying the API's string code, a message and a
request id. **Switch on the code, never on the message** (messages may be reworded).

```php
try {
    $kakitu->merchants->me();
} catch (KakituException $e) {
    switch ($e->errorCode) {                       // compare with Kakitu\ErrorCode constants
        case ErrorCode::MERCHANT_NOT_REGISTERED: /* apply at kakitu.org/merchant */ break;
        case ErrorCode::RATE_LIMITED:            /* back off */ break;
        default: error_log("Kakitu {$e->errorCode} request_id={$e->requestId}");
    }
}
```

`$e->errorCode`, `$e->requestId` (quote it to support), `$e->httpStatus`. (`getCode()` is a final int
in PHP, so the string code is `errorCode` / `getErrorCode()`.) Subclasses, if you prefer `catch` by type:
`AuthenticationException`, `InvalidRequestException`, `MerchantException`, `IdempotencyException`,
`RateLimitException`, `NotFoundException`, `ConflictException`, `ApiException`, `ConnectionException`.
For `unauthorized`, `$e->reason` holds the server's short reason (`replay`, `bad_signature`,
`timestamp_out_of_range`, ...). The full closed set is in `Kakitu\ErrorCode`.

The payout codes are **not** the collection ones. `PAYOUT_DAILY_CAP_EXCEEDED` is a different budget from
`DAILY_CAP_EXCEEDED`, on a different setting and a different counter — asking an operator to raise your
collection cap changes nothing. `PAYOUT_AMOUNT_ABOVE_MAXIMUM` is a 400: waiting does not help, a smaller
payout does. `PAYOUTS_DISABLED` deliberately does not say whether the global switch or yours is off.
Both arrive as `RateLimitException` / `InvalidRequestException`, so only `errorCode` tells them apart.

## Safe retries

* The server does **not** require a key uniformly, and this SDK does not pretend it does. A fresh UUID is
  sent on the four routes that require one — `charges->create()`, `transfers->create()`,
  `payouts->create()`, `payouts->request()` — and **no key at all** on `quotes->create()`, `payouts->quote()` and
  `events->replay()`, which mount no idempotency on the server, nor on `merchants->update()`, which
  moves no money. Pass your own to make a retry safe across crashes and timeouts:
  `['idempotency_key' => 'order-1042']` (honoured on any method). Same key + same body replays the
  original response instead of acting twice; same key + different body is `idempotency_key_reuse`.
* The SDK retries **429 `rate_limited`, 5xx and network errors** (default 2 retries, exponential backoff
  with jitter, honours `Retry-After`; set `max_retries`). It reuses the same idempotency key and signs each
  attempt afresh. It **never retries a 4xx** other than `rate_limited`: `daily_cap_exceeded` and
  `payer_velocity_exceeded` are also HTTP 429 but are policy limits, so they are raised immediately.

## Webhooks

The `Kakitu-Signature` header carries `t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">`, keyed with
your webhook secret. Pass its value in:

```php
use Kakitu\Webhook;

$event = Webhook::constructEvent(
    file_get_contents('php://input'),                    // the RAW body, not re-encoded JSON
    $_SERVER['HTTP_KAKITU_SIGNATURE'] ?? '',
    getenv('KAKITU_WEBHOOK_SECRET'),
);   // throws SignatureVerificationException; 300s replay tolerance
```

Delivery is **at-least-once**: `Kakitu-Event-Id` (and `id` in the payload) is stable across every attempt
and across a replay — dedupe on it or you will double-count. `Webhook::verify()` returns a bool instead of
throwing. The thirteen types are in `Kakitu\EventType`; `transfer.received` is the one that matters
today. A `payload` read back from `events->list()` is the same JSON value as the delivery but not the
same bytes, so verify signatures on deliveries only.

When an endpoint was down and events were abandoned, `$kakitu->events->list(['status' => 'abandoned'])`
shows them and `$kakitu->events->replay($id)` puts one back in the queue with a fresh budget. Replay
answers HTTP 202: nothing has been delivered when it returns, and the event id does not change.

## Options

| option | default | |
|---|---|---|
| `private_key` | required | 64 hex chars, `0x` optional |
| `base_url` | `https://walletapi.kakitu.org` | `http` allowed for localhost only |
| `timeout` | `30` | seconds per attempt |
| `max_retries` | `2` | extra attempts |

`$kakitu->address()` returns the wallet address your key signs for: that is your merchant identity and
your settlement destination.

## Install and the crypto libraries (why these two)

Signing needs secp256k1 ECDSA and Keccak-256 (Ethereum's hash, which is **not** PHP's `sha3-256`).
We do not implement either ourselves. Composer installs:

* [`simplito/elliptic-php`](https://github.com/simplito/elliptic-php) `^1.0.12`: the most widely used
  PHP elliptic-curve library (a port of JS `elliptic`), supports secp256k1 with canonical low-s
  signatures and recovery id. Needs no extension (uses `ext-gmp` when present for speed).
* [`kornrunner/keccak`](https://github.com/kornrunner/php-keccak) `^1.1`: the standard Keccak-256 used
  across PHP Ethereum tooling.

Requirements: PHP >= 8.1, `ext-curl`, `ext-json`, `ext-hash`. Enable `ext-gmp` for faster signing.
Versions are pinned to caret ranges in `composer.json`; commit your own `composer.lock`.

**Verified, not trusted:** `tests/SignerTest.php` pins the exact signed string for GET with no body,
GET with a query, and POST with a body, plus four more shapes, and asserts the resulting signature is
byte-identical to the signatures produced by the server's own Go code (`cmd/kakitu-vectors`). Run them:

```bash
composer install && vendor/bin/phpunit
```

## How signing works (you never do this)

Headers sent on every request: `X-Kakitu-Address`, `X-Kakitu-Timestamp`, `X-Kakitu-Signature`. The
signature is an EIP-191 `personal_sign` over
`"{METHOD} {path}{?query} {unix-seconds} {sha256hex(body)}"`. The query is included only when non-empty,
byte-for-byte as sent; the SDK builds the URL once and signs that same string. The body is hashed exactly
as encoded. Two things the SDK handles that bite hand-rolled clients: your server clock must be within
about two minutes of Kakitu's (use NTP; the error says so), and an identical signed request in the same
second is refused as a replay, so retries are re-signed with a later timestamp.

## Security notes

* Never log, commit or echo the private key. The SDK never includes it in exceptions, and hides it from
  `var_dump`/`print_r`/`serialize`. Keep it in an env var or secret store, and rotate it if it leaks.
* The private key **is** the credential and the settlement address. Anyone holding it can act as you.
