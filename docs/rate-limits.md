---
sidebar_position: 8
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

## Request-level limits

Authentication and the platform's per-IP limits also apply to all endpoints, and may answer `429`. We have not confirmed the body of that response, so treat any `429` as back off. Do not hammer `GET /v1/merchants/me`; read it when you need it. Each signed request must also be unique (see [replays](./authentication#time-and-replay)), so a tight retry loop that resends an identical request in the same second fails with `replay`.

## Sizes

| Endpoint | Body limit |
|---|---|
| `POST /v1/merchants` | 16 KiB |
| Signed requests in general | 1 MiB |
| `Idempotency-Key` | 255 characters |
| `reference` | 128 characters |
