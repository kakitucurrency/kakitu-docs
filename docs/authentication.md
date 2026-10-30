---
sidebar_position: 3
title: Authentication
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Authentication

**Your wallet address is your API credential.** There is no API key to issue, leak or rotate. Every request is signed with the wallet's private key, and the server recovers the address from the signature. That address is also where your collections are settled, so a body that could name a different address would let anyone register as someone else. For that reason the address is never a body field.

## The scheme

Send three headers on every request, including `GET`.

| Header | Value |
|---|---|
| `X-Kakitu-Address` | The signer's address. EIP-55 checksummed or lowercase hex; compared case-insensitively. |
| `X-Kakitu-Timestamp` | Unix time in **seconds**, as a decimal string. |
| `X-Kakitu-Signature` | `0x` plus 65 bytes (130 hex characters): `r` (32) `s` (32) `v` (1). `v` may be 27/28 or 0/1. |

The signature is an **EIP-191 `personal_sign`** signature over exactly this string, with single spaces between the four parts:

```
{METHOD} {path}{?query} {timestamp} {sha256hex(body)}
```

- `METHOD` is upper case.
- `path` is the URL path **as the server decodes it**: an escaped character in a path segment (`%20`) is signed as the character it stands for. You rarely meet this, because every id we issue is plain ASCII. If there is a query string, append `?` and the query **exactly as sent, byte for byte**. If there is none, add no `?`.
- `timestamp` is the same string you put in `X-Kakitu-Timestamp`.
- `sha256hex(body)` is the lowercase hex SHA-256 of the **raw request body bytes**. For `GET` and `DELETE`, and for any request with no body, it is the SHA-256 of the empty string: `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

Example, a `POST` with a body:

```
POST /v1/merchants 1758240002 7a4c4c0f0333102cffe5a64621024fe6d094cbcc71d771c251a3600c43ac19a6
```

### Why it is built this way

- **The body hash is in the message** so a captured signature cannot be reused with different JSON.
- **The query string is in the message** so a captured signature for one `GET` cannot be replayed with different parameters.
- **Hash the bytes you send.** If your client re-serialises the JSON after you signed it (different key order, spacing or escaping), the hash will not match and you will get `bad_signature`. Serialise once, sign that string, send that same string.

### Time and replay

- The timestamp must be within **120 seconds** of server time, in either direction. Outside it: `timestamp_out_of_range`. If you see this on every request, your machine's clock is wrong.
- Replays are rejected. The server remembers each request for **300 seconds**, keyed on address, method, path with query, timestamp and body hash. A second request that is identical in all of those, inside the window, fails with `replay`. Two requests that differ in any of them, for example a different body in the same second, are both accepted.
- Do not retry a failed request by resending the same signature. Sign again with a fresh timestamp. If the retry is identical to the first and lands in the same second, it will be rejected as a replay even though you meant it.
- Bodies over 1 MiB are refused during authentication.

## Complete examples

:::note SDKs
The SDKs are not on npm, PyPI or Packagist yet: `npm install @kakitu/sdk`, `pip install kakitu`
and `composer require kakitu/kakitu-php` all fail. Install them from this repository instead, or
sign requests directly with the programs below.

```bash
# Python
pip install "kakitu @ git+https://github.com/kakitucurrency/kakitu-docs#subdirectory=sdk/python"

# TypeScript: npm cannot install from a subfolder of a git repo, so build a tarball
git clone --depth 1 https://github.com/kakitucurrency/kakitu-docs
(cd kakitu-docs/sdk/ts && npm ci && npm run build && npm pack)
npm install ./kakitu-docs/sdk/ts/kakitu-sdk-0.1.0.tgz

# PHP: Composer cannot either, so point it at the folder
git clone --depth 1 https://github.com/kakitucurrency/kakitu-docs
composer config repositories.kakitu path ./kakitu-docs/sdk/php
composer require kakitu/kakitu-php:@dev
```
:::

Each of these is a whole program: it builds the message, signs it, sends the request and prints the answer. Run on its own, each makes one read-only call, `GET /v1/merchants/me`; import its `call` function to make others, as the [quickstart](./quickstart#4-register) does to register. Each reads the key from `KAKITU_PRIVATE_KEY`. Do not put a key in source code or paste one into a support ticket, and make it a key generated for this integration rather than your personal wallet's — see [why a separate wallet](./quickstart#why-a-separate-wallet).

<Tabs groupId="lang">
<TabItem value="ts" label="TypeScript" default>

Node 18 or newer. `npm install ethers@6`. Save as `kakitu.mjs`.

```ts title="kakitu.mjs"
// kakitu.mjs - Node 18+, `npm install ethers@6`
import { createHash } from "node:crypto";
import { Wallet } from "ethers";

const BASE_URL = "https://walletapi.kakitu.org";

const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");

// The exact string that gets signed. `target` is the path plus "?query" if there is one,
// byte for byte as it will be sent. `body` is the exact string you will send ("" for none).
export function message(method, target, timestamp, body = "") {
  return `${method.toUpperCase()} ${target} ${timestamp} ${sha256hex(body)}`;
}

export async function signedHeaders(wallet, method, target, body = "", timestamp) {
  const ts = String(timestamp ?? Math.floor(Date.now() / 1000));
  // wallet.signMessage is EIP-191 personal_sign: it prefixes the message and hashes it.
  const signature = await wallet.signMessage(message(method, target, ts, body));
  return {
    "X-Kakitu-Address": wallet.address,
    "X-Kakitu-Timestamp": ts,
    "X-Kakitu-Signature": signature,
  };
}

export async function call(wallet, method, target, body) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const headers = await signedHeaders(wallet, method, target, raw);
  if (raw) headers["Content-Type"] = "application/json";
  // Send `raw`, the same string you signed. Never re-serialise between signing and sending.
  const res = await fetch(BASE_URL + target, { method, headers, body: raw || undefined });
  return { status: res.status, body: await res.json() };
}

// Run it: KAKITU_PRIVATE_KEY=0x... node kakitu.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const wallet = new Wallet(process.env.KAKITU_PRIVATE_KEY);
  // Read-only: a 404 merchant_not_registered here means your signature verified.
  console.log(await call(wallet, "GET", "/v1/merchants/me"));
}
```

Run: `KAKITU_PRIVATE_KEY=0x... node kakitu.mjs`

</TabItem>
<TabItem value="py" label="Python">

Python 3.9 or newer. `pip install eth-account requests`. Save as `kakitu.py`.

```python title="kakitu.py"
"""kakitu.py - Python 3.9+, `pip install eth-account requests`"""
import hashlib
import json
import os
import time

import requests
from eth_account import Account
from eth_account.messages import encode_defunct

BASE_URL = "https://walletapi.kakitu.org"


def message(method: str, target: str, timestamp: str, body: bytes = b"") -> str:
    """The exact string that gets signed. `target` is the path plus "?query" if there is
    one, byte for byte as it will be sent. `body` is the exact bytes you will send."""
    return f"{method.upper()} {target} {timestamp} {hashlib.sha256(body).hexdigest()}"


def signed_headers(account, method, target, body=b"", timestamp=None):
    ts = str(timestamp if timestamp is not None else int(time.time()))
    # encode_defunct + sign_message is EIP-191 personal_sign (version 0x45).
    signed = account.sign_message(encode_defunct(text=message(method, target, ts, body)))
    return {
        "X-Kakitu-Address": account.address,
        "X-Kakitu-Timestamp": ts,
        # eth-account returns v as 27/28; the server accepts 27/28 and 0/1.
        "X-Kakitu-Signature": "0x" + signed.signature.hex(),
    }


def call(account, method, target, payload=None):
    # Serialise once, sign those bytes, send those bytes. Do not use requests' json= here:
    # it may serialise differently from the bytes you hashed.
    raw = b"" if payload is None else json.dumps(payload, separators=(",", ":")).encode()
    headers = signed_headers(account, method, target, raw)
    if raw:
        headers["Content-Type"] = "application/json"
    res = requests.request(method, BASE_URL + target, headers=headers, data=raw or None, timeout=30)
    return res.status_code, res.json()


if __name__ == "__main__":
    # KAKITU_PRIVATE_KEY=0x... python kakitu.py
    account = Account.from_key(os.environ["KAKITU_PRIVATE_KEY"])
    # Read-only: a 404 merchant_not_registered here means your signature verified.
    print(call(account, "GET", "/v1/merchants/me"))
```

Run: `KAKITU_PRIVATE_KEY=0x... python kakitu.py`

</TabItem>
<TabItem value="php" label="PHP">

PHP 8.1 or newer with the `curl` and `gmp` extensions. `composer require kornrunner/keccak simplito/elliptic-php`. Save as `kakitu.php`.

```php title="kakitu.php"
<?php
// kakitu.php - PHP 8.1+ with ext-curl and ext-gmp.
//   composer require kornrunner/keccak simplito/elliptic-php
declare(strict_types=1);
require __DIR__ . '/vendor/autoload.php';

use Elliptic\EC;
use kornrunner\Keccak;

const KAKITU_BASE_URL = 'https://walletapi.kakitu.org';

/** The exact string that gets signed. $target is the path plus "?query" if there is one,
 *  byte for byte as it will be sent. $body is the exact bytes you will send. */
function kakitu_message(string $method, string $target, string $timestamp, string $body = ''): string
{
    return strtoupper($method) . ' ' . $target . ' ' . $timestamp . ' ' . hash('sha256', $body);
}

/** EIP-191 personal_sign. Returns [address, 0x-prefixed 65-byte signature]. */
function kakitu_sign(string $privateKeyHex, string $message): array
{
    $ec = new EC('secp256k1');
    $key = $ec->keyFromPrivate(preg_replace('/^0x/', '', $privateKeyHex), 'hex');

    $prefixed = "\x19Ethereum Signed Message:\n" . strlen($message) . $message;
    $digest = Keccak::hash($prefixed, 256);                       // hex string

    $sig = $key->sign($digest, 'hex', ['canonical' => true]);     // low-s, as Ethereum requires
    $signature = '0x'
        . str_pad($sig->r->toString(16), 64, '0', STR_PAD_LEFT)
        . str_pad($sig->s->toString(16), 64, '0', STR_PAD_LEFT)
        . dechex(27 + $sig->recoveryParam);

    $pub = substr($key->getPublic(false, 'hex'), 2);              // drop the 04 prefix
    $address = '0x' . substr(Keccak::hash(hex2bin($pub), 256), 24);
    return [$address, $signature];
}

function kakitu_headers(string $privateKeyHex, string $method, string $target, string $body = '', ?int $timestamp = null): array
{
    $ts = (string) ($timestamp ?? time());
    [$address, $signature] = kakitu_sign($privateKeyHex, kakitu_message($method, $target, $ts, $body));
    return [
        'X-Kakitu-Address' => $address,
        'X-Kakitu-Timestamp' => $ts,
        'X-Kakitu-Signature' => $signature,
    ];
}

function kakitu_call(string $privateKeyHex, string $method, string $target, ?array $payload = null): array
{
    // Encode once, sign those bytes, send those bytes.
    $raw = $payload === null ? '' : json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    $headers = kakitu_headers($privateKeyHex, $method, $target, $raw);
    if ($raw !== '') {
        $headers['Content-Type'] = 'application/json';
    }
    $lines = [];
    foreach ($headers as $k => $v) {
        $lines[] = "$k: $v";
    }
    $ch = curl_init(KAKITU_BASE_URL . $target);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $lines,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
    ]);
    if ($raw !== '') {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $raw);
    }
    $out = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return [$status, json_decode((string) $out, true)];
}

// Run it: KAKITU_PRIVATE_KEY=0x... php kakitu.php
if (PHP_SAPI === 'cli' && realpath($argv[0] ?? '') === __FILE__) {
    $key = getenv('KAKITU_PRIVATE_KEY') ?: exit("Set KAKITU_PRIVATE_KEY\n");
    // Read-only: a 404 merchant_not_registered here means your signature verified.
    print_r(kakitu_call($key, 'GET', '/v1/merchants/me'));
}
```

Run: `KAKITU_PRIVATE_KEY=0x... php kakitu.php`

</TabItem>
</Tabs>

## Check your signer against known answers

Before you debug your integration, check your signer. These are test vectors produced by the server's own signing code, using the public BIP-39 test key (mnemonic `abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about`, path `m/44'/60'/0'/0/0`), whose address is `0x9858EfFD232B4033E47d90003D41EC34EcaEda94`. **That key is published in every BIP-39 test suite. Use it for these vectors only, never for real money.** If your signer produces these signatures, the signing is right and any remaining problem is in the request. All three programs above produce them.

**GET /kyc/state?country=KE&tier=basic**, timestamp `1758240001`, body `(empty)`

```
message   GET /kyc/state?country=KE&tier=basic 1758240001 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
signature 0x3660f0431d31e727a8ba5f33c788812c6a25e8507b9c2479324ed1259ad047fe6c44925337052d4037a86ade58ef860a890f3f7bfaeec5331deaf78e1fe50e681b
```

**POST /ramp/deposit**, timestamp `1758240002`, body `{"amount_kes":1000,"phone":"+254700000000"}`

```
message   POST /ramp/deposit 1758240002 7a4c4c0f0333102cffe5a64621024fe6d094cbcc71d771c251a3600c43ac19a6
signature 0x300fa9012768e1bcd22614d77d7724be7cdad84bbf65f482b536860ce0eb5a4e2329986faa234254388022acfb3f9c7640778bfc2021cc6eca0848f1556f6f171c
```

## When you get 401

An authentication failure is answered by the signing layer before your request reaches the API, so it uses a **different, older shape** from the rest of the API:

```json
HTTP 401
{ "error": "unauthorized", "reason": "bad_signature" }
```

Branch on `reason`. It is a string you can match, but unlike `code` on other errors it is not yet part of the closed error set. See [Errors](./errors#authentication-failures).

| `reason` | Meaning and fix |
|---|---|
| `missing_auth_headers` | One of the three headers is absent or empty. |
| `bad_timestamp` | `X-Kakitu-Timestamp` is not an integer. Send seconds, not milliseconds with a decimal point. |
| `timestamp_out_of_range` | More than 120 seconds from server time. Fix the clock. |
| `bad_signature` | The recovered address is not the one in `X-Kakitu-Address`, or the signature is malformed. Check, in order: the body you hashed is the body you sent; the query string is included with its `?`; the method is upper case; you used `personal_sign` (EIP-191 prefix), not a raw hash signature. |
| `replay` | Identical request already seen in the last 300 seconds. Sign again with a fresh timestamp. |
| `unreadable_body` | The body could not be read, or exceeded 1 MiB. |
| `auth_unavailable` | The replay store is down. The request was refused rather than risk accepting a replay. Retry shortly with a fresh signature. |

## Idempotency is separate

Signing proves who you are. It does not make a retry safe. Requests that move money also need an `Idempotency-Key` header. See [Collections](./collections#idempotency).
