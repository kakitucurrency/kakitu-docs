---
sidebar_position: 14
title: Errors
---

# Errors

Every `/v1/` endpoint answers an error with one envelope:

```json
{
  "error": {
    "code": "merchant_name_frozen",
    "message": "The business name is fixed once your account has been reviewed, …",
    "request_id": "…"
  }
}
```

**`code` is the contract. `message` is for humans and may be reworded at any time. Never branch on `message`.** Codes are a closed set, and each code has exactly one HTTP status, so you can handle errors by code alone.

`request_id` is always present. Quote it when you contact support; it is the only handle we have on your request. For `internal` errors the message is always the same fixed sentence, because the real cause can contain a provider's or a payer's details and is kept in our logs.

## Every code

| `code` | HTTP | Meaning |
|---|---|---|
| `invalid_request` | 400 | The body or a field is malformed, unknown or out of range. The message says which. |
| `unauthorized` | 401 | The request reached a handler without a verified wallet. |
| `merchant_not_registered` | 404 | This wallet has not registered. POST /v1/merchants. |
| `merchant_not_approved` | 403 | The merchant is not `approved`. An operator must approve it first. |
| `merchant_suspended` | 403 | The merchant is suspended. |
| `merchant_name_frozen` | 409 | business_name cannot be changed after review. Needs an operator. |
| `idempotency_key_required` | 400 | A money-moving POST has no Idempotency-Key. |
| `idempotency_key_invalid` | 400 | The Idempotency-Key is longer than 255 characters. |
| `idempotency_key_reuse` | 409 | This key was already used with a different request. |
| `idempotency_key_in_progress` | 409 | A request with this key is still running. Retry with the same key. |
| `idempotency_key_acted` | 409 | The original request acted but its outcome was not recorded. Do not retry; check first. |
| `idempotency_unavailable` | 503 | The idempotency store is down. Retry with the same key. |
| `request_too_large` | 413 | The body exceeds the limit for that endpoint. See [Sizes](./rate-limits#sizes). |
| `amount_below_minimum` | 400 | The amount is under the minimum that can be collected. |
| `amount_above_maximum` | 400 | The amount is over the per-charge or rail maximum. |
| `daily_cap_exceeded` | 429 | The merchant's daily collection cap is reached. |
| `payer_velocity_exceeded` | 429 | This payer has been prompted too often today. |
| `rate_limited` | 429 | Too many requests per minute, too many charges per minute, too many prompts, or too many transfers this hour. See [Rate limits](./rate-limits). |
| `charge_not_found` | 404 | No such charge for this merchant. |
| `reference_reused` | 409 | This merchant already has a charge with that reference. |
| `rail_unavailable` | 503 | The thing you asked for is temporarily unavailable. Retry shortly. On a route that moves money it means **nothing was sent**. |
| `order_not_found` | 404 | No such order. See [Orders](./orders). |
| `event_not_found` | 404 | No such webhook event. See [Events](./events). |
| `payouts_disabled` | 403 | Payouts are not switched on for this merchant. See [Payouts](./payouts#payouts-are-off-by-default). |
| `payout_daily_cap_exceeded` | 429 | The merchant's daily **payout** budget is spent. Not the collection cap. Resets at midnight EAT. |
| `payout_amount_above_maximum` | 400 | Over the largest single payout allowed for this merchant. |
| `payout_not_found` | 404 | No such payout for this merchant. See [Payouts](./payouts). |
| `payout_quote_not_found` | 404 | The payout quote does not exist, has expired, or has already been spent. |
| `profile_required` | 409 | This wallet has no profile yet: a phone number and name, which the cash-out partner needs on every order. There is no `/v1` route for it; save one with `POST /profile` or in the Kakitu app. See [Cash out](./cash-out#2-a-profile-once). |
| `identity_verification_required` | 403 | The amount needs the customer's identity verified first. |
| `internal` | 500 | Something went wrong on our side. Quote the request_id. |

Thirty-one codes, and that is all of them.

Six answer the same way for a thing that does not exist and a thing that belongs to somebody else: `merchant_not_registered`, `charge_not_found`, `order_not_found`, `event_not_found`, `payout_not_found` and `payout_quote_not_found`. Same status, same code, same sentence, deliberately. An error that told the two apart would turn the endpoint into a way of asking whether somebody else's id is real.

## The payout codes are not the collection codes

`payouts_disabled`, `payout_daily_cap_exceeded` and `payout_amount_above_maximum` are deliberately separate from `merchant_not_approved`, `daily_cap_exceeded` and `amount_above_maximum`, and they are never folded into them.

**Paying money out is a different permission from collecting it in**, on different settings and a different counter. A payout cap refusal must never arrive as `daily_cap_exceeded`: an integrator who saw that would go and ask an operator to raise their *collection* cap, the operator would raise the wrong number, nothing would change, and the real limit would stay a mystery. Branch on the payout codes when you are paying out. See [Payouts](./payouts#payout-caps-are-not-your-collection-caps).

The whole code set above is final and will not change under you. Codes are never reused and never renamed: a code you branch on today means the same thing tomorrow.

## Authentication failures

Signature checking happens before the API, and it answers with an **older shape**:

```json
HTTP 401
{ "error": "unauthorized", "reason": "replay" }
```

Here `error` is a string and `reason` is one of `missing_auth_headers`, `bad_timestamp`, `timestamp_out_of_range`, `bad_signature`, `replay`, `unreadable_body`, `auth_unavailable`. Handle it by checking whether `error` is a string or an object. Meanings are on the [Authentication](./authentication#when-you-get-401) page.

## Retrying

| Situation | What to do |
|---|---|
| `503` (`idempotency_unavailable`, `rail_unavailable`) | Retry with backoff, same `Idempotency-Key`. |
| `409 idempotency_key_in_progress` | Wait, retry with the same key. |
| `429` | Back off. See [Rate limits](./rate-limits). |
| `409 idempotency_key_acted` | **Do not retry**, with this key or a new one. The money may already have moved — check state first. On [transfers](./transfers#the-two-answers-that-are-not-retry) and [payouts](./payouts#the-one-answer-that-is-not-retry) you can get this on the first attempt. |
| `reference_reused` after a refused charge | Same key, **new reference**. |
| `4xx` otherwise | Fix the request. Retrying will not help. |
