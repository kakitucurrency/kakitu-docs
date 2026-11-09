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
| `open_loan` | 409 | `POST /v1/merchants` only: this wallet has an open Kakitu loan, so it cannot register as a merchant until the loan is closed. Nothing was saved. |
| `account_blocked` | 403 | Kakitu has blocked a wallet this request touches (yours, or on a transfer the recipient), or the money is on hold. **Nothing was charged or sent.** Contact support; retrying will not help. |
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
| `rail_unavailable` | 503 | The thing you asked for is temporarily unavailable: the partner, our cash-out capacity, or our own check of whether a wallet is blocked. Retry shortly. On a route that moves money it means **nothing was sent** and no handset was rung. |
| `order_not_found` | 404 | No such order. See [Orders](./orders). |
| `event_not_found` | 404 | No such webhook event. See [Events](./events). |
| `payouts_disabled` | 403 | Payouts are not switched on for this merchant. See [Payouts](./payouts#payouts-are-off-by-default). |
| `payout_daily_cap_exceeded` | 429 | The merchant's daily **payout** budget is spent. Not the collection cap. Resets at midnight EAT. |
| `payout_amount_above_maximum` | 400 | Over the largest single payout allowed for this merchant. |
| `payout_not_found` | 404 | No such payout for this merchant. See [Payouts](./payouts). |
| `payout_quote_not_found` | 404 | The payout quote does not exist, has expired, or has already been spent. |
| `payout_approval_required` | 409 | The payout is above your `hold_above_kes` and no person has approved it, so there is nothing to sign. Ask at `POST /v1/payouts/requests`. See [Approve first](./payouts#approve-first). |
| `payout_not_approved` | 409 | The `payout_id` cannot be quoted or signed now: undecided, rejected, lapsed, already used, or its destination was removed. Read the payout. |
| `payout_approval_mismatch` | 409 | The amount or beneficiary is not what a person approved. It is a different payout, so it is a new request. |
| `payout_open_requests_exceeded` | 429 | You already have as many payout requests waiting as you may. A decision or a lapsed approval frees a place. |
| `payout_destination_locked` | 403 | You hold your payouts to your saved destinations, and this is not one that can be paid now. The answer does not say whether it is unsaved, cooling off or removed. See [the lock](./payouts#saved-destinations-and-the-lock). |
| `payout_destination_not_found` | 404 | No saved destination with that id for this merchant. |
| `payout_destinations_full` | 409 | You have as many saved destinations as you may (50). Remove one. |
| `bank_unavailable` | 403 | A paybill or bank that is not a saved destination past its cooling-off, or a kind of destination that is not available now. Nothing was quoted. |
| `unknown_bank` | 400 | `bank_code` is not a bank we can pay. |
| `account_not_found` | 422 | The bank does not hold that account, or no longer under the name it was saved with. |
| `insufficient_balance` | 400 | The wallet does not hold the KSHS this payout or withdrawal burns. Nothing was quoted or sent. |
| `profile_required` | 409 | This wallet has no profile yet: a phone number and name, which the cash-out partner needs on every order. There is no `/v1` route for it; save one with `POST /profile` or in the Kakitu app. See [Cash out](./cash-out#2-a-profile-once). |
| `identity_verification_required` | 403 | The amount needs the customer's identity verified first. |
| `internal` | 500 | Something went wrong on our side. Quote the request_id. |

Forty-four codes, and that is all of them.

Seven answer the same way for a thing that does not exist and a thing that belongs to somebody else: `merchant_not_registered`, `charge_not_found`, `order_not_found`, `event_not_found`, `payout_not_found`, `payout_quote_not_found` and `payout_destination_not_found`. Same status, same code, same sentence, deliberately. An error that told the two apart would turn the endpoint into a way of asking whether somebody else's id is real.

## The payout codes are not the collection codes

`payouts_disabled`, `payout_daily_cap_exceeded` and `payout_amount_above_maximum` are deliberately separate from `merchant_not_approved`, `daily_cap_exceeded` and `amount_above_maximum`, and they are never folded into them.

**Paying money out is a different permission from collecting it in**, on different settings and a different counter. A payout cap refusal must never arrive as `daily_cap_exceeded`: an integrator who saw that would go and ask an operator to raise their *collection* cap, the operator would raise the wrong number, nothing would change, and the real limit would stay a mystery. Branch on the payout codes when you are paying out. See [Payouts](./payouts#payout-caps-are-not-your-collection-caps).

Codes are never reused and never renamed: a code you branch on today means the same thing tomorrow. New codes can be added (`open_loan` and `account_blocked` were added in November 2026), so treat a code you do not recognise by its HTTP status, and log it.

## Codes that are not in `/v1`

The wallet's own routes (`/ramp/*`, which the Kakitu app and extension call) answer in the older shape, `{"error": "<code>"}`, and a few of their codes have no `/v1` equivalent. The ones worth knowing if you cash in or out for a customer:

| `error` | HTTP | Meaning |
|---|---|---|
| `deposits_paused` | 409 | M-Pesa top-ups are paused for a short while. **Nothing was charged**, no prompt was sent, and the customer is texted when top-ups reopen. Not a failure to retry in a loop. |
| `treasury_short` | 409 | The hot treasury cannot pay this cash-out right now. Refused at the quote or the confirm, before anything was signed or taken. Try a smaller amount (`cashout_capacity_kes` in [`GET /config`](https://walletapi.kakitu.org/config)) or later. |
| `account_blocked` | 403 | Kakitu has blocked this wallet, or the other wallet on a transfer. Nothing moved. |
| `cashout_on_hold` | 403 | Money paid in from an M-Pesa number new to this wallet can be held for a while before it may leave. Nothing moved. |

On those routes `insufficient_balance` is the same fact as the `/v1` code above, and `rail_unavailable` is not used: a partner that fails is `502 provider_error`.

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
| `503` (`idempotency_unavailable`, `rail_unavailable`) | Retry with backoff, same `Idempotency-Key`. On a charge, a `rail_unavailable` can also have closed the `reference`: see [Collections](./collections#a-503-on-a-charge). |
| `409 idempotency_key_in_progress` | Wait, retry with the same key. |
| `429` | Back off. See [Rate limits](./rate-limits). |
| `409 idempotency_key_acted` | **Do not retry**, with this key or a new one. The money may already have moved — check state first. On [charges](./collections#idempotency_key_acted), [transfers](./transfers#the-two-answers-that-are-not-retry) and [payouts](./payouts#the-one-answer-that-is-not-retry) you can get this on the first attempt. |
| `reference_reused` after a refused charge | Same key, **new reference**. |
| `4xx` otherwise | Fix the request. Retrying will not help. |
