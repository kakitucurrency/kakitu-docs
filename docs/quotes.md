---
sidebar_position: 7
title: Quotes
---

# Quotes

A quote is a **price**: what a payment in or out would cost right now, and what would land. Asking for one creates no order, no charge and no transfer, and commits you to nothing.

## No Idempotency-Key

**This is the one `POST` in the API that does not take an `Idempotency-Key`**, and sending one is pointless rather than wrong. Every other money-moving `POST` requires a key because a timeout must not mean a second charge. A quote moves no money, so there is nothing to protect: ask twice and you get two prices, which is the correct answer.

## The request

```http
POST /v1/quotes
Content-Type: application/json

{
  "type": "deposit",
  "amount_kes": 1000,
  "phone": "254700000001"
}
```

| Field | Type | Rules |
|---|---|---|
| `type` | string, required | `deposit` or `withdrawal`. Anything else: `invalid_request`. |
| `amount_kes` | integer, required | Whole shillings, at least 1. What it means depends on `type` — see below. |
| `phone` | string | The payer's number, for a deposit. |
| `beneficiary` | object | **Required for a withdrawal.** `{ "channel": …, "number": …, "reference": … }`. |

**`amount_kes` is the number you care about, and it sits on a different side of the fee for each type.**

- For a **deposit** it is what the payer is asked to pay.
- For a **withdrawal** it is the shillings that must **land**. We price backwards from there and tell you the KSHS it would cost.

That is deliberate: you almost always know the amount somebody must receive, not the amount before a fee you have not been told yet.

**Unknown fields are refused** with `invalid_request`. A misspelt key fails loudly instead of being quietly ignored and changing your price. The body is limited to 4 KiB (`request_too_large`, 413).

## The response

A deposit:

```json
HTTP 200
{
  "type": "deposit",
  "pay_kes": 1000,
  "receive_kes": 970,
  "fee_kes": 30,
  "rate_kes_per_usdc": "125",
  "expires_at": "2026-10-26T09:02:00Z"
}
```

A withdrawal:

```json
HTTP 200
{
  "type": "withdrawal",
  "send_kes": 515,
  "receive_kes": 500,
  "fee_kes": 15,
  "rate_kes_per_usdc": "125",
  "expires_at": "2026-10-26T09:02:00Z"
}
```

| Field | Meaning |
|---|---|
| `pay_kes` | Deposit only: the shillings the payer is asked for. |
| `send_kes` | Withdrawal only: the KSHS that would be sent. |
| `receive_kes` | What lands. Deposit: the KSHS credited. Withdrawal: the shillings paid out. |
| `fee_kes` | The difference, in shillings. |
| `rate_kes_per_usdc` | The rate used, as a decimal string. |
| `expires_at` | When this price stops being the price. |

### There is no quote id

You cannot hand a quote back to us, because there is no endpoint that takes one yet. A quote is a number you show somebody, not a reservation. When a route exists that redeems one, it will issue an id of its own and this page will say so.

The reason there is no id today is not an oversight: the only id a quote has internally belongs to the pricing partner, and no partner identifier goes over this API. For the same reason nothing in the response names a rail, a treasury address or an amount to sign.

## Errors

| `code` | HTTP | When |
|---|---|---|
| `invalid_request` | 400 | Bad JSON, an unknown field, a `type` that is not `deposit` or `withdrawal`, `amount_kes` below 1, a missing `beneficiary` on a withdrawal, or a phone or beneficiary that is not valid for this wallet. |
| `request_too_large` | 413 | The body is over 4 KiB. |
| `unauthorized` | 401 | The request was not signed. |
| `amount_below_minimum` | 400 | Under the band. `GET /v1/limits` shows it. |
| `amount_above_maximum` | 400 | Over the band. |
| `profile_required` | 409 | This wallet has no profile yet. It must be completed before a quote can be priced. |
| `identity_verification_required` | 403 | This amount needs the customer's identity verified first. |
| `rate_limited` | 429 | Too many requests from this wallet. |
| `rail_unavailable` | 503 | Pricing is temporarily unavailable. Retry shortly. |
| `internal` | 500 | Something went wrong on our side. Quote the `request_id`; do not retry in a loop. |

A `500` here is worth treating differently from a `503`. `rail_unavailable` means try again shortly. `internal` can mean our own arithmetic disagreed with itself, and retrying that gets the same answer faster.

## What a quote does not tell you

The band from [`GET /v1/limits`](./limits) is cached and can be minutes old. **A quote is live.** If the two disagree, the quote is right — it is the thing that decides whether an amount is accepted.
