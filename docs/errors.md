---
sidebar_position: 13
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
| `rail_unavailable` | 503 | The thing you asked for is temporarily unavailable. Retry shortly. |
| `order_not_found` | 404 | No such order. See [Orders](./orders). |
| `event_not_found` | 404 | No such webhook event. See [Events](./events). |
| `profile_required` | 409 | This wallet has no profile yet. It must be completed before a quote can be priced. |
| `identity_verification_required` | 403 | The amount needs the customer's identity verified first. |
| `internal` | 500 | Something went wrong on our side. Quote the request_id. |

Four of these answer the same way for a thing that does not exist and a thing that belongs to somebody else: `merchant_not_registered`, `charge_not_found`, `order_not_found` and `event_not_found`. Same status, same code, same sentence, deliberately. An error that told the two apart would turn the endpoint into a way of asking whether somebody else's id is real.

The whole code set below is final and will not change under you. Codes are never reused and never renamed: a code you branch on today means the same thing tomorrow.

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
| `409 idempotency_key_acted` | Do not retry. Check state first. On [transfers](./transfers#the-three-answers-that-are-not-retry) you can get this on the first attempt. |
| `503 rail_unavailable` saying the outcome is not known | Do not retry. That wording means money may have moved. |
| `reference_reused` after a refused charge | Same key, **new reference**. |
| `4xx` otherwise | Fix the request. Retrying will not help. |
