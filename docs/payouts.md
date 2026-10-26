---
sidebar_position: 7
title: Payouts
---

# Payouts

A payout sends shillings **out** — from your KSHS balance to somebody's M-Pesa. You price it, you sign it with your own key, and we hand the signed result to the rail that pays the beneficiary.

It is the opposite direction from [collections](./collections), and it is deliberately not the same object with the sign flipped. A charge is money arriving; a payout is money leaving, and the permissions, the caps and the counters behind the two are separate from end to end.

## Payouts are off by default

**Read this before you write any of it.** Payouts are off for everybody until an operator switches them on, and off for your merchant until an operator switches them on for you. Both switches must be on. While either is off, every route on this page answers:

```json
HTTP 403
{
  "error": {
    "code": "payouts_disabled",
    "message": "This merchant is not switched on for payouts. Contact support to enable them.",
    "request_id": "…"
  }
}
```

Being `approved` is not enough. Approval lets you collect; it does not let you pay out. These are two decisions, taken by a person, and the second is not implied by the first — write to **kakitu@kakitu.org** and ask for payouts specifically.

One code covers both switches on purpose. Which of the two is off is an operator's business, and an endpoint that told you would let anyone probe how the platform is configured.

## Who can call these

An **approved** merchant with payouts switched on. The refusals are the same ones the rest of the API uses: an unsigned request gets `401 unauthorized`, a wallet that never registered gets `404 merchant_not_registered`, a `pending` or `rejected` one gets `403 merchant_not_approved`, and a suspended one gets `403 merchant_suspended`.

`GET /v1/payouts/{id}` is the exception: it only needs a signed request, and it scopes by the signing address. A wallet that is not a merchant simply has no payouts, and is told so in the ordinary way.

## Payout caps are not your collection caps

**A merchant approved to collect 100,000 a day is not thereby approved to pay out anything.** They are separate settings, on a separate counter, with their own error codes:

| Limit | `code` | HTTP |
|---|---|---|
| Payouts are switched off | `payouts_disabled` | 403 |
| The day's payout budget is spent | `payout_daily_cap_exceeded` | 429 |
| Over the largest single payout allowed | `payout_amount_above_maximum` | 400 |

None of these is `daily_cap_exceeded`, and they never will be. That code is the **collection** cap, and an integrator told `daily_cap_exceeded` when it is the payout budget that ran out goes and asks an operator to raise the collection number — which changes nothing, and leaves the real limit a mystery. Branch on the payout codes.

The daily payout budget resets at **midnight East Africa Time**, not UTC.

The budget is checked twice: at quote time, so you learn you are over it **before** you sign anything, and again when you confirm, which is the call that actually spends it. A payout that is accepted and then fails has still spent the day's budget — there is no refund path, because a counter that could be refunded is a counter that can be raced.

## The shape of it

Three calls, in this order:

```http
POST /v1/payouts/quote   price it, and get back exactly what to sign
POST /v1/payouts         send the quote id and the signed transfer
GET  /v1/payouts/{id}    read where it got to
```

## POST /v1/payouts/quote

Signed request. **No `Idempotency-Key`**, because a quote creates no payout and moves no money.

```http
POST /v1/payouts/quote
Content-Type: application/json

{
  "amount_kes": 1000,
  "beneficiary": {
    "phone": "254712345678",
    "name": "Jane Wanjiru"
  }
}
```

| Field | Type | Rules |
|---|---|---|
| `amount_kes` | integer, required | A whole number of shillings, at least 1. It is what **lands on the beneficiary**, not what leaves you. |
| `beneficiary.phone` | string, required | A Kenyan mobile number as `2547xxxxxxxx`. |
| `beneficiary.name` | string, required | The person being paid. See below. |

Unknown fields are refused with `invalid_request` rather than ignored. On a route that authorises money leaving, a mistyped field name must be a refusal and not an instruction that was silently dropped. The body is limited to 4 KiB (`request_too_large`, 413).

### The beneficiary name is yours to supply

**It is what the recipient sees on their M-Pesa statement, and it is taken from this request — never from your own merchant profile.** If you are paying Jane, put Jane's name here. Leaving it to be filled in from the sender's profile is exactly how a recipient ends up looking at a stranger's name against money they were expecting, and it is not something we will guess for you. Both the phone and the name are required: money must not leave without a number to send it to, and the recipient must not be shown the wrong person.

### The response

```json
HTTP 200
{
  "quote_id": "pq_4f3e8a0d77c1e2b3a4d5…",
  "amount_kes": 1000,
  "fee_kes": 25,
  "send_kes": 1025,
  "currency": "KES",
  "beneficiary": { "phone": "254712345678", "name": "Jane Wanjiru" },
  "expires_at": "2026-10-26T09:16:02Z",
  "value_wei": "1025000000000000000000",
  "treasury_address": "0x…",
  "deadline": 1761480300,
  "eip712": {
    "permit": { "name": "Kakitu", "version": "1", "chain_id": 8453, "verifying_contract": "0x…" },
    "relay":  { "name": "KakituForwarder", "version": "1", "chain_id": 8453, "verifying_contract": "0x…" }
  }
}
```

| Field | Meaning |
|---|---|
| `quote_id` | Ours: `pq_` and 64 hex characters. The only thing `POST /v1/payouts` accepts. Treat it as opaque. See [below](#the-quote-is-single-use-and-yours-alone). |
| `amount_kes` | What lands on the beneficiary. The number you asked for. |
| `fee_kes` | Kakitu's fee. |
| `send_kes` | What leaves your wallet. This is the number the permit must be for. |
| `expires_at` | When this price stops being the price. |
| `value_wei` | `send_kes` in the token's smallest unit, as a decimal string. Sign **this**, exactly. |
| `treasury_address` | The `to` of the transfer you sign. Not the beneficiary — the beneficiary is paid in shillings by the rail, off chain. |
| `deadline` | The **latest** deadline that will be accepted. An earlier one is fine. |
| `eip712` | Both domains you sign under, so neither has to be guessed. |

There is no rail name, no partner quote id and no order id in it, and there never will be.

### Signing it

A payout is signed exactly like a [transfer](./transfers#signing-a-transfer): the same two signatures, over the same two typed-data structures, with the same single nonce read before you sign. The permit authorises the forwarder to move `value_wei` of your KSHS; the intent names where it goes. Read that page once and this one needs no second explanation.

The only difference is that you do not choose the fields. `to` is the quote's `treasury_address`, `value_wei` is the quote's exactly, and `from` is your own address. The `eip712` block above gives you both domains rather than leaving you to assemble them from `GET /config`.

## POST /v1/payouts

Signed request. **`Idempotency-Key` is required** — without it, `400 idempotency_key_required` and nothing is sent. This is the call that authorises money leaving, and a route that does that does not run without run-once.

```http
POST /v1/payouts
Content-Type: application/json
Idempotency-Key: 8ab0f6c4-6c38-4f0e-9a7e-6b0a2f6b1d33

{
  "quote_id": "pq_4f3e8a0d77c1e2b3a4d5…",
  "transfer": {
    "from": "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
    "to": "0x…",
    "value_wei": "1025000000000000000000",
    "deadline": 1761480300,
    "v": 27, "r": "0x…", "s": "0x…",
    "iv": 28, "ir": "0x…", "is": "0x…"
  }
}
```

`transfer` is the same object `POST /v1/transfers` takes. Unknown fields are refused here too.

Four things about the signed transfer are checked against the quote before a row is written, and a mismatch in any of them is `invalid_request` with nothing sent:

- `from` must be your own wallet — the one that signed the HTTP request.
- `to` must be the quote's `treasury_address`.
- `value_wei` must be the quote's **exactly**. Not more, not less.
- `deadline` must be in the future and **no later than** the quote's. Earlier is your own business; later is a signature the rail would refuse after you had already signed it.

### The quote is single-use and yours alone

**A quote id can be spent once, by the merchant it was minted for, and only before it expires.** Every other case — a quote that never existed, one that has already been confirmed, one that has lapsed, one belonging to another merchant — gets the same answer:

```json
HTTP 404
{
  "error": {
    "code": "payout_quote_not_found",
    "message": "That payout quote cannot be used: it does not exist, it has expired, or it has already been confirmed. Ask for a new quote at POST /v1/payouts/quote.",
    "request_id": "…"
  }
}
```

They are indistinguishable on purpose. An error that told them apart would say whether another merchant's quote id is real.

**A quote id from anywhere else is refused the same way.** `POST /v1/quotes` issues no id at all — it prices a number for you to show somebody — and the wallet app's older `/ramp/*` quotes carry ids that mean nothing here. This route has its own ids in their own namespace, so a quote minted outside it is refused exactly as one that never existed. That is the whole reason this route exists instead of a `type: "payout"` on `/v1/quotes`: a quote obtained from a route with no merchant, no approval and no payout cap behind it must not be spendable at a confirm that has all three. It is also what stops one quote being replayed past the caps.

### The response

Both a held and a dispatched payout answer **`202`**. Nothing has reached the beneficiary when this returns either way.

```json
HTTP 202
{
  "id": "7c2b18e4-0f2a-4a1b-9a44-1b2c3d4e5f60",
  "status": "dispatched",
  "amount_kes": 1000,
  "fee_kes": 25,
  "send_kes": 1025,
  "currency": "KES",
  "beneficiary": { "phone": "254712345678", "name": "Jane Wanjiru" },
  "created_at": "2026-10-26T09:14:02Z",
  "message": "This payout is on its way to the beneficiary. Poll GET /v1/payouts/{id} for the outcome."
}
```

`message` is our sentence about what is happening now. It is present for `held` and `dispatched` and absent otherwise. It is written for a person reading a log; **branch on `status`, never on `message`.**

## The hold

**A payout above your hold threshold is accepted and then deliberately not sent. It waits for a person.**

That is a normal answer and not an error. You get `202`, a payout id, and `"status": "held"`:

```json
HTTP 202
{
  "id": "7c2b18e4-…",
  "status": "held",
  "message": "This payout is held for review and has NOT been sent. A person will release or cancel it; poll GET /v1/payouts/{id} for the outcome."
}
```

The threshold is a per-platform setting an operator controls, and "above" is strict — a payout exactly at the threshold goes on. A threshold of zero holds everything, which is the setting an operator reaches for when something is wrong.

Your signature is **held, not spent**. Nothing has been handed to the rail, nothing has left your wallet, and nothing has reached the beneficiary. The only thing that makes that true is that the dispatcher is never called, so a `held` status really does mean the money is still yours.

### Holds usually expire, and you should plan for that

This is the part that will surprise you if nobody says it: **the ordinary end of a hold is `expired`, not `dispatched`.**

The permit you signed stops being relayable at its own deadline, and that window is about ten minutes. The price behind it lives less. An operator working a review queue is working in minutes or hours. So a hold that a person has not reached in time lapses — a sweep notices within the minute, moves the payout to `expired`, and tells you.

When that happens you get a **`payout.expired`** webhook, and the instruction is: **sign and submit again.** Nothing was sent. The money never left. A fresh quote and a fresh signature is the correct response, and it is a new payout with a new id.

That is not the same as a person saying no. If an operator refuses a held payout you get **`payout.cancelled`**, and the instruction is the opposite: **do not submit it again.** Nothing was sent in that case either — the two outcomes look identical in every respect except one.

**The event `type` is the only reliable way to tell them apart.** Both mean "not sent". Both leave the payout terminal. One says try again, the other says a person has already decided. There is no reason field to parse and no message to read, because a receiver that had to parse English to decide whether to send money a second time would eventually get it wrong. Branch on `type`. See [Events](./events).

## Status

| `status` | Terminal | Meaning |
|---|---|---|
| `quoted` | no | Priced, nothing signed, nothing moved. |
| `held` | no | Signed and accepted, deliberately **not** sent. Waiting for a person. |
| `dispatched` | no | Handed to the worker. The money is leaving. |
| `paid` | **yes** | The beneficiary has the money. |
| `failed` | **yes** | It did not go through. |
| `cancelled` | **yes** | A person refused it. Nothing was sent. **Do not re-submit.** |
| `expired` | **yes** | Nothing was sent and nothing can be. **Sign and submit again.** |

The moves that exist, and no others:

```
quoted ──► held ──► dispatched ──► paid
   │         │           └──────► failed
   │         ├──► cancelled
   │         └──► expired
   └──► expired
```

Three things that are refused and worth knowing are refused: a `paid` payout can never be dispatched again, nothing can skip `dispatched` to reach `paid`, and a `cancelled` payout cannot be revived by a late caller.

**All four terminal states really are final.** This is where a payout differs from a [charge](./collections#status) on purpose: a `failed` charge can still turn out to have been paid, because it is our projection of a rail's word about money coming in. A payout row is the **authority** for money going out, so re-opening one would let a late message send a second disbursement against a budget that was only ever charged once. A retry is always a **new payout**, never this one moving again — which also means the amount is counted against your cap again.

You will not normally see `quoted` from the API. A payout is created in it and moved to `held` inside the same request, so by the time you are holding an id it is already past it.

## GET /v1/payouts/\{id\}

Your own payout, by id. Signed request, no body, no `Idempotency-Key`.

```json
HTTP 200
{
  "id": "7c2b18e4-0f2a-4a1b-9a44-1b2c3d4e5f60",
  "status": "paid",
  "amount_kes": 1000,
  "fee_kes": 25,
  "send_kes": 1025,
  "currency": "KES",
  "beneficiary": { "phone": "254712345678", "name": "Jane Wanjiru" },
  "created_at": "2026-10-26T09:14:02Z"
}
```

**Another merchant's payout is indistinguishable from one that does not exist.** A payout that is not yours, an id that has never existed, and a string that is not a UUID at all are one answer with one set of words:

```json
HTTP 404
{ "error": { "code": "payout_not_found", "message": "No payout with that id.", "request_id": "…" } }
```

Anything else would make this endpoint a way of asking whether somebody else's payout id is real. It is `payout_not_found` and not `order_not_found` because you are holding a payout id, and an integrator should not be sent off to look for an order.

## Errors

### POST /v1/payouts/quote

| `code` | HTTP | When |
|---|---|---|
| `unauthorized` | 401 | The request was not signed. |
| `merchant_not_registered` | 404 | This wallet has not registered. |
| `merchant_not_approved` | 403 | Registered, not yet approved. |
| `merchant_suspended` | 403 | The merchant is suspended. |
| `payouts_disabled` | 403 | Payouts are not switched on for this merchant. |
| `payout_daily_cap_exceeded` | 429 | The day's payout budget is spent. Resets at midnight EAT. |
| `payout_amount_above_maximum` | 400 | Over the largest single payout allowed for this merchant. |
| `invalid_request` | 400 | A malformed body, an unknown field, an `amount_kes` below 1, or a phone or name that is not valid. |
| `request_too_large` | 413 | The body is over 4 KiB. |
| `amount_below_minimum` | 400 | Under the rail's band. [`GET /v1/limits`](./limits) shows it. |
| `amount_above_maximum` | 400 | Over the rail's band. |
| `profile_required` | 409 | This wallet has no profile yet. |
| `identity_verification_required` | 403 | This amount needs identity verification first. |
| `rate_limited` | 429 | Too many requests from this wallet. |
| `rail_unavailable` | 503 | Pricing is temporarily unavailable, or we could not count your budget. Nothing was priced. Retry shortly. |
| `internal` | 500 | Something went wrong on our side. Quote the `request_id`. |

`payout_amount_above_maximum` is a `400` and not a `429` for a reason: no amount of waiting makes that payout acceptable, only a smaller one. `payout_daily_cap_exceeded` is a `429` because tomorrow it will work.

### POST /v1/payouts

Everything above, plus:

| `code` | HTTP | When |
|---|---|---|
| `idempotency_key_required` | 400 | No `Idempotency-Key`. Nothing was sent. |
| `payout_quote_not_found` | 404 | The quote cannot be used. See [above](#the-quote-is-single-use-and-yours-alone). |
| `invalid_request` | 400 | The signed transfer does not match the quote, or the body is malformed. **Nothing was sent.** |
| `idempotency_key_acted` | 409 | The payout was submitted and we cannot tell what became of it. **Do not send it again.** |

The general idempotency rules — replays, mismatched bodies, the 24-hour window — are on the [Collections](./collections#idempotency) page and apply here unchanged.

### GET /v1/payouts/\{id\}

| `code` | HTTP | When |
|---|---|---|
| `unauthorized` | 401 | The request was not signed. |
| `payout_not_found` | 404 | No payout with that id, or it is not yours. |
| `rail_unavailable` | 503 | Temporarily unavailable. Retry shortly. |
| `internal` | 500 | Something went wrong on our side. |

Every code on this page is from the closed set in [Errors](./errors).

## The one answer that is not "retry"

Almost every refusal above happens before anything is handed over, and says so. Your `Idempotency-Key` is released and a corrected retry with the same key is right.

**`409 idempotency_key_acted` is the exception.** It means the payout was handed to the rail and we could not record what came back. The money may be on its way.

**Do not send it again — not with this key, and not with a new one.** The message carries the payout id; read `GET /v1/payouts/{id}` and see where it got to, or ask support with the `request_id`. A `503` on this route always means nothing was sent; this `409` always means it may have been. The two readings are never mixed into one status, which is the same ruling [transfers](./transfers#the-two-answers-that-are-not-retry) makes and for the same reason.

The key is held deliberately. Freeing a key after money may have moved makes the retry send it a second time; holding one only costs you a new key.
