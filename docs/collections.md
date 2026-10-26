---
sidebar_position: 5
title: Collections
---

# Collections

:::danger Not yet available
`POST /v1/charges`, `GET /v1/charges` and `GET /v1/charges/{id}` **do not work on the live server today.** The routes are not registered, so calling them returns a plain 404. This page documents the shapes from the charge service as it is being built, so you can plan. Field names here are provisional until the endpoints ship; this notice will be removed when they do.
:::

A collection (a *charge*) asks a payer's phone to approve an M-Pesa payment. When they pay, the shilling amount is credited as KSHS to your merchant wallet.

## Operator approval is required

**Collections only work for an approved merchant.** A `pending`, `rejected` or `suspended` merchant is refused (`merchant_not_approved` or `merchant_suspended`, both 403) before anything else happens.

The reason is plain: a collection **rings a stranger's handset with a real M-Pesa PIN prompt**, showing your business name. Without a human check, the endpoint would be a phishing tool. So a Kakitu operator reviews every merchant first. See [Going live](./going-live).

## `POST /v1/charges` (not yet available)

Requires `Idempotency-Key` (below).

| Field | Type | Rules |
|---|---|---|
| `amount` | integer, required | Whole KES, greater than zero. Subject to the minimum the rail will collect and your per-charge maximum. |
| `phone` | string, required | The payer's Kenyan mobile number. Normalised once, then used for everything. |
| `reference` | string, required | Your own identifier. At most 128 characters. Unique per merchant. |

Provisional response:

```json
{
  "id": "…",
  "reference": "order-1042",
  "amount": 500,
  "currency": "KES",
  "status": "prompted",
  "created_at": "2026-10-25T12:00:00Z",
  "paid_at": null,
  "settled_at": null
}
```

A field the server owns — `id`, `status`, `currency`, `created_at`, `paid_at`, `settled_at` — is tolerated and dropped if you echo it back from a charge you read, so round-tripping a charge object does not break. It is never obeyed. Any other unknown field is refused with `invalid_request`, and the message names it.

## `GET /v1/charges/{id}` (not yet available)

Returns the charge. A charge that belongs to another merchant answers `404 charge_not_found`, the same as one that does not exist, and so does an id that is not well formed.

## `GET /v1/charges` (not yet available)

Your own charges, newest first. No `Idempotency-Key`; it reads.

```http
GET /v1/charges?status=settled&created_after=2026-10-01T00:00:00Z&limit=50
```

| Parameter | Rules |
|---|---|
| `reference` | Your own identifier, matched exactly. |
| `status` | One of the statuses above. Anything else: `invalid_request`. |
| `created_after` | An RFC 3339 timestamp, for example `2026-10-25T00:00:00Z`. |
| `limit` | A whole number from 1 to 100. Default 20. |
| `cursor` | `next_cursor` from the previous page, unchanged. |

```json
{
  "data": [
    {
      "id": "a1f0c9d2-55b1-4f3e-8a0d-77c1e2b3a4d5",
      "reference": "order-1042",
      "amount": 500,
      "currency": "KES",
      "status": "settled",
      "created_at": "2026-10-25T12:00:00Z",
      "paid_at": "2026-10-25T12:00:41Z",
      "settled_at": "2026-10-25T12:01:03Z"
    }
  ],
  "next_cursor": "MjAyNi0xMC0yNVQxMjowMDowMFouLg"
}
```

`next_cursor` is `null` on the last page. It is **an opaque string, not a page number**: charges arrive while you are paging, and an offset would show you the same row twice. Pass it back unchanged — a cursor we did not issue is `invalid_request`.

The list is scoped to your merchant in the query itself, not by a filter we remember to apply, so there is no shape of request that returns somebody else's charges.

## Status

| `status` | Meaning |
|---|---|
| `pending` | Created, nothing sent yet. |
| `prompted` | The payer's handset has been rung. |
| `paid` | The rail says the payer paid. |
| `settled` | Your wallet has been credited on chain. Final. |
| `failed` | The attempt did not complete. |
| `expired` | The charge ran out of time. |
| `cancelled` | Cancelled. Final. |

A charge only moves forward. `pending` can also stay `pending` if the rail accepted the order but could not confirm the prompt went out.

## Idempotency

**Every money-moving `POST` requires an `Idempotency-Key` header**: a string you generate, at most 255 characters, a UUID is ideal. It exists so a timeout never means a double charge: if you do not know whether a request worked, resend it with the **same key** and you get the original answer, not a second prompt.

- **Same key, same request:** the stored response is returned with the header `Idempotent-Replayed: true`. Only successful (2xx) responses are stored.
- **Same key, different body, path or query:** `409 idempotency_key_reuse`. A key names one request. Use a new key for a new request.
- **Same key while the first is still running:** `409 idempotency_key_in_progress`. Wait and retry with the same key.
- **No key:** `400 idempotency_key_required`. Over 255 characters: `400 idempotency_key_invalid`.
- **Store unavailable:** `503 idempotency_unavailable`. Retry with the same key.
- Keys are held for 24 hours.

### When a retry needs a new reference as well

If the payment rail refuses a charge **before** a handset is rung (for example `amount_below_minimum`, `amount_above_maximum`, or `rate_limited` for too many prompts to that payer), the key is released and you may reuse it. But the charge row and its `reference` were already written, so that **reference is now closed**. A retry must use **the same key and a new `reference`**, otherwise you get `409 reference_reused`. The error message says "retry with a new reference" when this applies.

Refusals made earlier, by Kakitu's own checks (not approved, malformed request, a reference you already used, your daily cap, per-charge maximum or per-minute rate), write no charge row, so the reference stays free. Fix the cause and retry.

### idempotency_key_acted

If the original request reached the rail, so a handset may have been rung, but the outcome could not be recorded, every retry in the 24-hour window gets `409 idempotency_key_acted`. **Do not retry with this key or a new one.** Fetch the charge by `reference` or contact support first. Sending again could prompt the payer twice.

## Limits

Per-merchant daily and per-charge caps, a per-minute rate and a per-payer daily prompt limit apply. See [Rate limits](./rate-limits).
