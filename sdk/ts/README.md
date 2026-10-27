# @kakitu/sdk (TypeScript)

Accept M-Pesa payments through Kakitu. The Kakitu API authenticates every request by signing it with your wallet key instead of using a bearer token. This SDK does the signing, so you never build a signature, a timestamp or a header yourself.

## 60-second quickstart

```bash
npm install @kakitu/sdk
export KAKITU_PRIVATE_KEY=0x...   # your wallet key: use a secret store, never source code
```

```ts
import { Kakitu, KakituError } from "@kakitu/sdk";

const kakitu = new Kakitu({ privateKey: process.env.KAKITU_PRIVATE_KEY! });

// 1. Register (instant; creates a PENDING merchant, an operator approves it later)
await kakitu.merchants.register({
  business_name: "Mama Njeri Groceries",
  contact_email: "owner@example.com",
  callback_url: "https://example.com/kakitu/webhook", // optional
});

// 2. Check your status
const me = await kakitu.merchants.me();
console.log(me.state); // "pending" until approved

// 3. Handle errors by code, never by message text
try {
  await kakitu.merchants.me();
} catch (e) {
  if (e instanceof KakituError) {
    switch (e.code) {
      case "merchant_not_registered": /* call register() */ break;
      case "rate_limited": /* already retried for you */ break;
      default: console.error(e.code, e.requestId); // quote requestId to support
    }
  }
}
```

Your merchant identity and settlement address is the wallet address your key signs as: `kakitu.address`.

## What's covered

| Namespace | Methods |
| --- | --- |
| `merchants` | `register`, `me` |
| `charges` | `create`, `get`, `list`, `listAll` |
| `transfers` | `create` |
| `balances` | `retrieve` |
| `orders` | `get` |
| `limits` | `retrieve` |
| `quotes` | `create` |
| `events` | `list`, `listAll`, `replay` |
| `payouts` | `quote`, `create`, `get`, `list`, `listAll` |

```ts
const charge = await kakitu.charges.create({ amount: 500, phone: "0712345678", reference: "order-1042" });
const { kshs, usdc } = await kakitu.balances.retrieve();
const price = await kakitu.quotes.create({ type: "deposit", amount_kes: 1000, phone: "0712345678" });
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

## Payouts

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

The quote id is single use and expires. States are `quoted`, `held`, `dispatched`, `paid`, `failed`, `cancelled`, `expired`; the last four are terminal and a retry is a **new** payout. `limits.retrieve()` tells you your `hold_above_kes`, `max_kes` and `daily_cap_kes` up front, so you never have to learn them by being refused.

## Idempotency

The server does **not** require a key uniformly, and this SDK does not pretend it does.

| Route | `Idempotency-Key` |
| --- | --- |
| `charges.create`, `transfers.create`, `payouts.create` | **required** — generated for you (UUID), or pass your own |
| `quotes.create`, `payouts.quote`, `events.replay` | **never sent** — the server mounts no idempotency on them |
| `merchants.register` | not sent — an upsert, with no key on the server |
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
const ok = verifyWebhookSignature({ payload: rawBody, header: req.headers["kakitu-signature"], secret: process.env.KAKITU_WEBHOOK_SECRET! });
```

Header `Kakitu-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`, 300s tolerance. Pass the **raw** body, not re-serialised JSON: re-marshalling reorders keys and you would verify a different string than the one signed.

Delivery is **at-least-once**. `Kakitu-Event-Id` (and `id` in the payload) is stable across every attempt and across a replay — dedupe on it or you will double-count. Events are `charge.paid`, `charge.settled`, `charge.failed`, `payout.expired`, `payout.cancelled`.

When an endpoint was down and events were abandoned, `events.list({ status: "abandoned" })` shows them and `events.replay(id)` puts one back in the queue with a fresh budget. Replay answers HTTP 202: nothing has been delivered when it returns, and the event id does not change.

## Key safety

The key is held in a private field: it does not appear in `JSON.stringify`, `console.log` or error messages. Examples use a placeholder; keep real keys in environment variables or a secret manager.

## Crypto dependency

`@noble/curves` and `@noble/hashes`, pinned to exact versions. They are audited, dependency-free, pure JavaScript, work in Node, browsers and edge runtimes, and need no native build or user configuration. Signatures are deterministic (RFC 6979, low-s), matching the Go server's signer byte for byte.

## Development

`npm test` runs the signing tests, which pin the exact signed strings and signatures for a GET with no body, a GET with a query and a POST with a body, plus every case generated by the server's own `cmd/kakitu-vectors`.
