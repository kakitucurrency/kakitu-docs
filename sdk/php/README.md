# Kakitu PHP SDK

Accept M-Pesa payments settled in KES stablecoin, from any PHP 8.1+ site (WooCommerce, Laravel, plain PHP).

Kakitu authenticates by **request signing**, not a bearer token: every request is signed with your
wallet's private key. This SDK does that for you. You never build a signature, a timestamp or a header.

> **Status.** `merchants->register()` and `merchants->me()` are live.
> **`charges->*` is NOT YET AVAILABLE**: those endpoints are still being written on the server. The
> methods exist so your integration code can be written now, but they will fail until the endpoints ship.
> Webhook verification follows the *planned* scheme and is likewise provisional (see below).

## 60-second quickstart

```bash
composer require kakitu/kakitu-php
```

Put your wallet private key in an environment variable or your host's secret store. Never in code,
never in git.

```php
<?php
require 'vendor/autoload.php';

use Kakitu\Kakitu;
use Kakitu\ErrorCode;
use Kakitu\Exception\KakituException;

$kakitu = new Kakitu([
    'private_key' => getenv('KAKITU_PRIVATE_KEY'),   // 64 hex chars; e.g. YOUR_PRIVATE_KEY_HERE
]);

// 1. Register this wallet as a merchant (starts "pending"; Kakitu approves it).
$merchant = $kakitu->merchants->register([
    'business_name' => 'Mama Njeri Fabrics',
    'contact_email' => 'pay@mamanjeri.example',
    'callback_url'  => 'https://mamanjeri.example/kakitu/webhook',
]);

// 2. Check your state at any time.
echo $kakitu->merchants->me()['state'];   // "pending", then "approved"

// 3. NOT YET AVAILABLE: charge a customer's M-Pesa.
$charge = $kakitu->charges->create(
    ['amount' => 1500, 'phone' => '+254700000000', 'reference' => 'order-1042'],
    ['idempotency_key' => 'order-1042'],   // optional; see "Safe retries"
);
```

## Errors

Every failure is a `Kakitu\Exception\KakituException` carrying the API's string code, a message and a
request id. **Switch on the code, never on the message** (messages may be reworded).

```php
try {
    $kakitu->merchants->me();
} catch (KakituException $e) {
    switch ($e->errorCode) {                       // compare with Kakitu\ErrorCode constants
        case ErrorCode::MERCHANT_NOT_REGISTERED: /* call register() */ break;
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

## Safe retries

* Every `POST` carries an `Idempotency-Key` automatically (a fresh UUID). Pass your own to make a retry
  safe across crashes and timeouts: `['idempotency_key' => 'order-1042']`. Same key + same body replays
  the original response instead of acting twice; same key + different body is `idempotency_key_reuse`.
* The SDK retries **429 `rate_limited`, 5xx and network errors** (default 2 retries, exponential backoff
  with jitter, honours `Retry-After`; set `max_retries`). It reuses the same idempotency key and signs each
  attempt afresh. It **never retries a 4xx** other than `rate_limited`: `daily_cap_exceeded` and
  `payer_velocity_exceeded` are also HTTP 429 but are policy limits, so they are raised immediately.

## Webhooks (provisional)

Delivery is still being written. The planned scheme is a header `t=<unix>,v1=<hex HMAC-SHA256 of "t.body">`
keyed with your webhook secret. The header *name* is not final, so you pass its value in:

```php
use Kakitu\Webhook;

$event = Webhook::constructEvent(
    file_get_contents('php://input'),                    // the RAW body, not re-encoded JSON
    $_SERVER['HTTP_X_KAKITU_WEBHOOK_SIGNATURE'] ?? '',   // header name: provisional
    getenv('KAKITU_WEBHOOK_SECRET'),
);   // throws SignatureVerificationException; 300s replay tolerance
```

Delivery is at-least-once: dedupe on the event id. `Webhook::verify()` returns a bool instead of throwing.

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
