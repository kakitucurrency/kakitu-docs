---
sidebar_position: 14
title: Rate limits
---

# Rate limits

Limits exist to protect payers. A collection rings a real handset, so the controls are about how often and how much, not just request volume.

## Limits that apply to collections

These apply when charges are available ([not yet](./collections)). Each is its own error code:

| Limit | Code | HTTP |
|---|---|---|
| Daily collection cap for your merchant | `daily_cap_exceeded` | 429 |
| Charges per minute for your merchant | `rate_limited` | 429 |
| Prompts to one payer per day | `payer_velocity_exceeded` | 429 |
| Maximum per charge | `amount_above_maximum` | 400 |

Your own `daily_cap_kes` and `per_charge_max_kes` are in `GET /v1/merchants/me`. `0` means the platform default applies. We do not publish the platform defaults here because they are configuration that an operator can change. Read your record, and ask us for a limit raise when you need one.

The payer limit is deliberate: it stops a merchant, or someone who got hold of a merchant's key, from pestering one person.

## Reading a 429

Branch on `code`. A `429` does not mean your request was lost: check the code, wait, and retry. A refused charge that was stopped by these checks writes no charge, so its `reference` stays free.

## Limits that apply to transfers

The hourly limit on [`POST /v1/transfers`](./transfers) is not a courtesy. Our relayer pays the Base gas for every transfer out of one small ETH balance, and when that balance empties **every transfer in the country stops**, not just this API. Addresses cost nothing, so a merchant key is a free tap on it.

| Limit | Code | HTTP |
|---|---|---|
| Transfers per merchant per hour | `rate_limited` | 429 |
| Transfers per wallet per UTC day | `daily_cap_exceeded` | 429 |
| Largest single transfer | `amount_above_maximum` | 400 |
| Smallest transfer | `amount_below_minimum` | 400 |

This one **fails closed**: if we cannot count, we refuse. A limit on our own money is not something to switch off by generating load. The ceiling on a single transfer is published as `relay_max_per_tx_kes` in `GET /config`.

## Requests per minute

Every `/v1` endpoint is also counted per minute, keyed on **your authenticated address** — not your IP. An IP bucket would be meaningless for a server-side integration: one busy merchant behind one egress IP would throttle itself while a hundred merchants across a cloud provider would not be limited at all.

Three headers come back on every `/v1` response:

| Header | Meaning |
|---|---|
| `RateLimit-Limit` | Requests allowed in the current minute. |
| `RateLimit-Remaining` | How many are left. |
| `RateLimit-Reset` | Seconds until the window rolls over. |

Over the limit you get `429 rate_limited`, plus **`Retry-After`** in seconds, and the message names the wait. The default allowance is 120 requests a minute; read `RateLimit-Limit` rather than hardcoding it, because an operator can change it.

Unlike the money controls, this one **fails open**: if our counter is unavailable your request goes through. It protects us from load; it is not a safety control, and a Redis outage must not stop you reading your own charges.

## Other 429s

The platform also has a per-IP limiter in front of everything, including `/v1`. It answers with the **older error shape** and a `Retry-After`:

```json
HTTP 429
{ "error": "too_many_requests" }
```

Branch on whether `error` is a string or an object, as on the [Errors](./errors#authentication-failures) page.

Do not hammer `GET /v1/merchants/me`; read it when you need it. Each signed request must also be unique (see [replays](./authentication#time-and-replay)), so a tight retry loop that resends an identical request in the same second fails with `replay` rather than being rate limited.

## Sizes

| Limit | Value |
|---|---|
| `POST /v1/merchants` body | 16 KiB |
| `POST /v1/charges` body | 16 KiB |
| `POST /v1/quotes` body | 4 KiB |
| Signed requests in general | 1 MiB |
| `Idempotency-Key` | 255 characters |
| `reference` | 128 characters |
| `limit` on a list endpoint | 1 to 100, default 20 |

A body over its endpoint's limit is `413 request_too_large`. A body over 1 MiB is refused during authentication, before it reaches the endpoint at all.
