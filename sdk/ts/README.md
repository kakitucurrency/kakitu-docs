# @kakitu/sdk (TypeScript)

A client for the Kakitu developer API.

**Not published.** `@kakitu/sdk` is not on npm: `npm install @kakitu/sdk` answers 404. Install it from this folder (below), or sign requests directly with the complete signers on [Authentication](https://developer.kakitu.org/docs/authentication).

**Status:** merchants apply at [kakitu.org/merchant](https://kakitu.org/merchant) and Kakitu approves them; no API call makes a merchant. Take payment today with a KSHS transfer and a `reference`, and read it with `transfers.list`. `charges.create` is not open for integration (planned as a KSHS payment request), and the payout-sending calls and `payoutDestinations.save` are not open for integration (planned to come back, paid through KCB). See [what is live](https://developer.kakitu.org/docs/going-live#what-is-live).

**Server-side signing is coming soon.** This SDK signs with a hex private key. There is no safe way yet to get the key of a wallet made in the Kakitu app onto a server: the app and the extension do not export one. **Never type your 12 words into a script or tool to work one out.** See [the quickstart](https://developer.kakitu.org/docs/quickstart#server-side-signing).

The Kakitu API authenticates every request by signing it with your wallet key instead of using a bearer token. This SDK does the signing, so you never build a signature, a timestamp or a header yourself.

## Quickstart

```bash
# npm cannot install from a subfolder of a git repository, and dist/ is not committed,
# so clone, build a tarball, and install that
git clone --depth 1 https://github.com/kakitucurrency/kakitu-docs
(cd kakitu-docs/sdk/ts && npm ci && npm run build && npm pack)
npm install ./kakitu-docs/sdk/ts/kakitu-sdk-0.1.0.tgz
export KAKITU_PRIVATE_KEY=0x...   # a hex private key: use a secret store, never source code
```

```ts
import { Kakitu, KakituError } from "@kakitu/sdk";

const kakitu = new Kakitu({ privateKey: process.env.KAKITU_PRIVATE_KEY! });

// 1. Check your merchant record (you applied at kakitu.org/merchant)
const me = await kakitu.merchants.me();
console.log(me.state); // "pending" until Kakitu approves you

// 2. Read your payments, newest first, with each payer's reference
for await (const t of kakitu.transfers.listAll({ limit: 100 })) {
  if (t.direction === "in") console.log(t.tx_hash, t.amount_kes, t.reference ?? "-");
}

// 3. Once approved: set your contact details and callback URL (this does not make a merchant)
await kakitu.merchants.update({
  business_name: "Mama Njeri Groceries",              // exactly as you applied
  contact_email: "owner@example.com",
  callback_url: "https://example.com/kakitu/webhook", // optional
});

// 4. Handle errors by code, never by message text
try {
  await kakitu.merchants.me();
} catch (e) {
  if (e instanceof KakituError) {
    switch (e.code) {
      case "merchant_not_registered": /* apply at kakitu.org/merchant */ break;
      case "rate_limited": /* already retried for you */ break;
      default: console.error(e.code, e.requestId); // quote requestId to support
    }
  }
}
```

A reference is the payer's claim, not proof: check the amount and the recipient, and match each order to one transfer. `merchants.register` is a deprecated alias of `merchants.update`; the route no longer registers anybody.

Your merchant identity and settlement address is the wallet address your key signs as: `kakitu.address`.

## What's covered

| Namespace | Methods |
| --- | --- |
| `merchants` | `update` (`register` is a deprecated alias), `me` |
| `charges` | `get`, `list`, `listAll` (past charges); `create` is not open for integration |
| `transfers` | `create`, `list`, `listAll` (`GET /transfers`) |
| `balances` | `retrieve` |
| `orders` | `get` |
| `limits` | `retrieve` |
| `quotes` | `create`: not open for integration |
| `events` | `list`, `listAll`, `replay` |
| `payouts` | `get`, `list`, `listAll` (past payouts); `request`, `quote`, `create` are not open for integration |
| `payoutDestinations` | `list`, `remove`, `setLock`; `save` answers `payouts_disabled` while payouts are off |

```ts
const { kshs, usdc } = await kakitu.balances.retrieve();
const page = await kakitu.transfers.list({ limit: 50 });   // or hold next_before yourself
console.log(page.transfers.length, page.next_before);       // next_before is absent on the last page
```

## You sign the money; the SDK signs the request

Two different signatures live in this API and confusing them is the single most common mistake.

The `X-Kakitu-Signature` this SDK adds to **every** request authenticates *you to the API*. It authorises nothing on chain.

`transfers.create` and `payouts.create` move KSHS out of your wallet, and that needs a signature **you** produce with your own wallet key, over on-chain structured data:

- `v` / `r` / `s` — an **EIP-2612 permit**, signed under the **token's** EIP-712 domain.
- `iv` / `ir` / `is` — an **EIP-712 `Relay(owner,to,value,deadline,nonce)` intent**, signed under the **forwarder's** domain.

**This SDK does not and cannot produce them.** Kakitu holds no keys and signs nothing on your behalf; it only pays the gas. Build the two signatures with your own signing stack (viem, ethers, a KMS) and hand them over:

```ts
const transfer = await kakitu.transfers.create({
  from: kakitu.address, to: "0xRecipient", value_wei: "1000000000000000000000",
  deadline: Math.floor(Date.now() / 1000) + 300,
  v, r, s,      // EIP-2612 permit, under the TOKEN domain
  iv, ir, is,   // EIP-712 Relay intent, under the FORWARDER domain
});
```

`payouts.quote` publishes **both** domains (`eip712.permit` and `eip712.relay`) along with the exact `value_wei`, `treasury_address` and latest `deadline` to sign, so neither is left to be guessed. Signing the permit under the forwarder's domain produces a signature the chain rejects with nothing to read.

`value_wei` is a **string** everywhere, and must stay one. Through a JavaScript number `"1000000000000000000000"` becomes `1e+21` and the signature will not verify.

## Payouts (not open for integration)

**Payouts are not open for integration**: they are planned to come back, paid through KCB. While they are off for your merchant, `payouts.quote` and `payouts.request` answer `payouts_disabled` and `payouts.create` answers `payout_quote_not_found`. The shape below is the API as it stands and will change.

```ts
const quote = await kakitu.payouts.quote({
  amount_kes: 5000,                                        // what LANDS on the beneficiary
  beneficiary: { phone: "254712345678", name: "A Mwangi" },
});
// ...sign quote.value_wei / quote.treasury_address / quote.deadline with your own key...
const payout = await kakitu.payouts.create({ quote_id: quote.quote_id, transfer });

if (payout.status === "held") {
  // NORMAL, not an error: above your hold_above_kes, a person reviews it before it is sent.
  // Poll kakitu.payouts.get(payout.id) for the outcome.
}
```

The quote id is single use and expires. There are ten states: `quoted`, `pending_approval`, `approved`, `rejected`, `held`, `dispatched`, `paid`, `failed`, `cancelled`, `expired`. Five are terminal (`paid`, `failed`, `cancelled`, `rejected`, `expired`), and a retry is a **new** payout. `limits.retrieve()` tells you your `hold_above_kes`, `max_kes` and `daily_cap_kes` up front, so you never have to learn them by being refused.

## Idempotency

The server does **not** require a key uniformly, and this SDK does not pretend it does.

| Route | `Idempotency-Key` |
| --- | --- |
| `charges.create`, `transfers.create`, `payouts.create`, `payouts.request` | **required** — generated for you (UUID), or pass your own |
| `quotes.create`, `payouts.quote`, `events.replay` | **never sent** — the server mounts no idempotency on them |
| `merchants.update` | not sent — it moves no money, and the server mounts no key |
| every `GET` | not sent |

The generated key is reused across every automatic retry inside one call, which is what makes a retry safe. It lives only in memory, so to survive a crash or a process restart generate and store your own: `create(params, { idempotencyKey: "order-1042-attempt-1" })`. Same key means the same request; a new request needs a new key.

## Pagination

`charges`, `events` and `payouts` page identically: an opaque `cursor`, `limit` 1-100 (default 20), and `next_cursor` that is `null` on the last page. Pass `next_cursor` back unchanged — never parse one, build one, or carry one from one list to another.

```ts
for await (const payout of kakitu.payouts.listAll({ status: "held" })) {
  console.log(payout.id);   // follows next_cursor for you, one page at a time
}

const page = await kakitu.payouts.list({ limit: 50 });   // or hold the cursor yourself
console.log(page.data.length, page.next_cursor);
```

Each page is a separate signed request against your rate limit, fetched lazily; break out of the loop and no further page is requested.

## Errors

`KakituError` has `code`, `message`, `requestId` and `status`. `code` is the server's closed set (see `ServerErrorCode`) plus `network_error` and `unknown` (a code newer than this SDK; the raw string is in `rawCode`). Authentication failures (`unauthorized`) also carry `reason`: `bad_signature`, `replay`, `timestamp_out_of_range` (fix your server clock; the window is 120 seconds), and so on.

The payout codes are **not** the collection ones: `payout_daily_cap_exceeded` is a different budget from `daily_cap_exceeded`, on a different setting and a different counter, and `payout_amount_above_maximum` is a 400 — no amount of waiting makes that payout acceptable, only a smaller one. `payouts_disabled` deliberately does not say whether it is the global switch or yours.

## Retries

Retried with exponential backoff and jitter (default 3 retries): HTTP 5xx and 429 `rate_limited` (honours `Retry-After`). Never retried: any other 4xx, including 429 `daily_cap_exceeded` and `payer_velocity_exceeded`, which will not clear in seconds. Every attempt is re-signed with a fresh timestamp, because the server rejects an identical request in the same second as a replay.

## Webhooks

```ts
import { verifyWebhookSignature } from "@kakitu/sdk";
const header = req.headers["kakitu-signature"];
const ok = typeof header === "string"
  && verifyWebhookSignature({ payload: rawBody, header, secret: process.env.KAKITU_WEBHOOK_SECRET! });
```

Header `Kakitu-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`, 300s tolerance. Pass the **raw** body, not re-serialised JSON: re-marshalling reorders keys and you would verify a different string than the one signed.

Delivery is **at-least-once**. `Kakitu-Event-Id` (and `id` in the payload) is stable across every attempt and across a replay — dedupe on it or you will double-count. There are thirteen event types: `transfer.received` (the one that matters today), `charge.paid`, `charge.settled`, `charge.failed`, `payout.approved`, `payout.rejected`, `payout.expired`, `payout.cancelled`, `payout.paid`, `payout.failed`, `payout_destination.added`, `payout_destination.removed` and `payout_lock.changed`. The API also returns `payload_raw`, the exact signed body, on each event (the `Event` type does not declare it yet): check a kept `Kakitu-Signature` over that (or over the raw request body), never over `payload`.

When an endpoint was down and events were abandoned, `events.list({ status: "abandoned" })` shows them and `events.replay(id)` puts one back in the queue with a fresh budget. Replay answers HTTP 202: nothing has been delivered when it returns, and the event id does not change.

## Key safety

The key is held in a private field: it does not appear in `JSON.stringify`, `console.log` or error messages. Examples use a placeholder; keep real keys in environment variables or a secret manager.

## Crypto dependency

`@noble/curves` and `@noble/hashes`, pinned to exact versions. They are audited, dependency-free, pure JavaScript, work in Node, browsers and edge runtimes, and need no native build or user configuration. Signatures are deterministic (RFC 6979, low-s), matching the Go server's signer byte for byte.

## Development

`npm test` runs the signing tests, which pin the exact signed strings and signatures for a GET with no body, a GET with a query and a POST with a body, plus every case generated by the server's own `cmd/kakitu-vectors`.
