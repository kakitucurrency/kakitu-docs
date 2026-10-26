---
sidebar_position: 12
title: Events
---

# Events

:::danger Not yet available
`GET /v1/events` and `POST /v1/events/{id}/replay` **do not answer on the live server today**, and the delivery worker that fills the queue is not running either. Nothing is being sent to your `callback_url`. The routes, the payload, the signature and the retry schedule below are read from the server's code so you can build against them now. See [the status board](./intro).
:::

An event is one webhook delivery: what we sent you about a charge, when we tried, and whether it worked. These two endpoints exist because **delivery is best-effort, not guaranteed.** An endpoint that was down for a day has events marked `abandoned`, and you need to be able to see that, read what we tried to send, fix your side and ask for it again — without opening a support ticket.

## Delivery is at-least-once

**Your endpoint can be rung more than once for the same event. Build for it.**

This is not a bug we intend to fix, because it cannot be fixed. Sending the request and recording "delivered" are two acts, and anything that happens between them — a timeout on our side, a crash after your `200`, a replay you asked for — means we try again. An endpoint that accepted a delivery and then had the answer lost will be rung again with the same body.

**The event `id` is your dedupe key.** It is stable across every attempt and across a replay: the same event is always the same id. Key on it, ignore an id you have already processed, and you get exactly-once. Do not key on the charge id — a charge produces several events.

The corollary is that **no payload is ever a delta.** Every body states the charge's whole current state, so processing a duplicate is a no-op rather than a second increment.

## What a delivery looks like

A `POST` to your `callback_url`, `Content-Type: application/json`, `User-Agent: Kakitu-Webhooks/1`, with three headers:

| Header | Value |
|---|---|
| `Kakitu-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256>` |
| `Kakitu-Event-Id` | The event id. Your dedupe key. |
| `Kakitu-Event-Type` | `charge.paid`, `charge.settled` or `charge.failed`. |

**Only the signature header is worth trusting.** The other two are a convenience, and both values are also inside the signed body; a receiver that reads them without verifying the signature has verified nothing.

The body:

```json
{
  "id": "4e7c2b18-0f2a-4a1b-9a44-1b2c3d4e5f60",
  "type": "charge.settled",
  "created_at": "2026-10-26T09:14:02Z",
  "charge": {
    "id": "a1f0c9d2-55b1-4f3e-8a0d-77c1e2b3a4d5",
    "reference": "order-1042",
    "amount": 500,
    "currency": "KES",
    "status": "settled",
    "paid_at": "2026-10-26T09:13:44Z",
    "settled_at": "2026-10-26T09:14:02Z"
  }
}
```

There is no payer phone number, no rail name, no partner status and no internal order id in it, and there never will be.

### Verifying the signature

`v1` is the HMAC-SHA256, keyed with your webhook secret, of the string `<t>.<raw body>`.

The timestamp is **inside** the signed string, not merely alongside it. That is what makes it worth checking: move `t` and the signature breaks. The `.` is a separator, not decoration — without it `"1" + "23.x"` and `"12" + "3.x"` would sign identically and a replayer could shift the clock by trimming the body.

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

// `raw` must be the EXACT bytes of the request body. Do not parse and re-serialise
// before verifying: that reorders keys and changes whitespace, and you will then be
// checking a different string from the one we signed.
export function verify(secret, header, raw) {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2)));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.`).update(raw).digest();
  const got = Buffer.from(parts.v1 ?? "", "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}
```

Your webhook secret is issued once, when an operator approves you, and is never retrievable afterwards. See [Webhooks](./webhooks).

### What counts as delivered

**A 2xx, and nothing else.** A `3xx` is a failure and the redirect is not followed — following one would carry a body signed for your host to a host the signature was never meant for. Answer `200` as soon as you have stored the event; do your work afterwards. A receiver that does its processing before answering turns a slow job into a retry.

### The retry schedule

30 seconds, then 1 minute, 2, 4, 8, and so on, doubling to a ceiling of 6 hours. When the *next* attempt would fall outside **24 hours** from the first, the event is marked `abandoned` instead.

It is not thrown away. It stays readable on `GET /v1/events`, and `POST /v1/events/{id}/replay` gives it a fresh budget once your endpoint is fixed. We stop at a day because an endpoint that has been down that long has a human problem, and a queue that retried forever would turn one broken integration into an unbounded backlog for everybody.

Your callback URL and your secret are read **fresh on every attempt**. Fix your endpoint or rotate your secret and the next retry believes you — you do not have to wait for anything on our side.

## GET /v1/events

Your own events, newest first. Signed request, no body.

```http
GET /v1/events?status=abandoned&limit=50
```

| Parameter | Rules |
|---|---|
| `type` | `charge.paid`, `charge.settled` or `charge.failed`. |
| `status` | `pending`, `delivered` or `abandoned`. |
| `charge_id` | The id of one of your charges. |
| `limit` | A whole number from 1 to 100. Default 20. |
| `cursor` | `next_cursor` from the previous page, unchanged. |

A value outside those sets is refused with `invalid_request` rather than quietly matching nothing. If you are debugging "why is my list empty", a typo tells you so instead of leaving you hunting for events that were never going to match.

```json
HTTP 200
{
  "data": [
    {
      "id": "4e7c2b18-0f2a-4a1b-9a44-1b2c3d4e5f60",
      "type": "charge.settled",
      "charge_id": "a1f0c9d2-55b1-4f3e-8a0d-77c1e2b3a4d5",
      "created_at": "2026-10-26T09:14:02Z",
      "status": "abandoned",
      "attempts": 12,
      "next_attempt_at": null,
      "last_attempt_at": "2026-10-27T08:40:11Z",
      "delivered_at": null,
      "last_error": "http_502",
      "payload": { "id": "4e7c2b18-0f2a-4a1b-9a44-1b2c3d4e5f60", "type": "charge.settled", "created_at": "2026-10-26T09:14:02Z", "charge": { "id": "a1f0c9d2-55b1-4f3e-8a0d-77c1e2b3a4d5", "reference": "order-1042", "amount": 500, "currency": "KES", "status": "settled", "paid_at": "2026-10-26T09:13:44Z", "settled_at": "2026-10-26T09:14:02Z" } }
    }
  ],
  "next_cursor": "MjAyNi0xMC0yNlQwOToxNDowMloucy4u"
}
```

| Field | Meaning |
|---|---|
| `status` | `pending` (not yet delivered), `delivered` (your endpoint answered 2xx), `abandoned` (the 24-hour budget is spent). |
| `attempts` | How many attempts have failed so far. |
| `next_attempt_at` | When we will try again. **`null` unless the event is `pending`** — a next attempt that is not coming would be a lie. |
| `last_attempt_at` | When we last tried. `null` if we never have. |
| `delivered_at` | When your endpoint accepted it. |
| `last_error` | Why the last attempt failed. Absent if none has. See the table below. |
| `payload` | The exact body we sent, as JSON rather than as a quoted string, so you can read it without a second parse. |

`next_cursor` is `null` on the last page. It is an opaque string, not a page number: events arrive while you are paging, and an offset would show you the same row twice. Pass it back unchanged; anything else is `invalid_request`.

### `last_error`

A closed vocabulary, never a raw error message — an error's own text can name a DNS resolver, a proxy or an internal hostname.

| Value | Meaning |
|---|---|
| `http_<code>` | Your endpoint answered with that status. The number is yours. |
| `timeout` | Your endpoint did not answer in time. |
| `connection_failed` | We could not connect. |
| `callback_address_refused` | Your callback URL resolved to an address we refuse to connect to. See [callback URLs](./merchants#callback-urls). |
| `no_callback_url` | You have no `callback_url` set. The event is kept and still retried, so setting one inside the window still gets it delivered. |
| `no_signing_secret` | No webhook secret. An unsigned delivery is one you could not tell from a forgery, so it is not sent. |
| `merchant_not_found` / `merchant_lookup_failed` | We could not read your merchant record. Ours to fix. |

## POST /v1/events/\{id\}/replay

Puts one event back in the queue with a fresh 24-hour budget — whatever state it was in. An `abandoned` event after a day of failures, or a `delivered` one you lost on your side.

```json
HTTP 202
{
  "id": "4e7c2b18-0f2a-4a1b-9a44-1b2c3d4e5f60",
  "type": "charge.settled",
  "charge_id": "a1f0c9d2-55b1-4f3e-8a0d-77c1e2b3a4d5",
  "created_at": "2026-10-26T09:14:02Z",
  "status": "pending",
  "attempts": 0,
  "next_attempt_at": "2026-10-27T09:00:00Z",
  "last_attempt_at": "2026-10-27T08:40:11Z",
  "delivered_at": null,
  "payload": { "…": "…" }
}
```

**`202`, not `200`: nothing has been delivered when this returns.** The worker picks the row up on its next tick. What you get back is the queued state, not a receipt.

**No `Idempotency-Key` is needed.** Replay is idempotent by construction — requeuing an already-requeued event sets the same row to the same state. Calling it five times is one replay.

**The event id does not change**, which is the whole point. A receiver that dedupes on it, as the at-least-once contract requires, can tell that this is an event it may already have seen.

## Who can call these

A registered merchant. **A suspended merchant can still read and replay its own events** — doing so moves no money and tells nobody anything new. Suspension stops new charges, not your access to your own delivery history.

## Errors

| `code` | HTTP | When |
|---|---|---|
| `unauthorized` | 401 | The request was not signed. |
| `merchant_not_registered` | 404 | This wallet has not registered. |
| `invalid_request` | 400 | A filter value outside its set, a `limit` outside 1–100, or a cursor we did not issue. |
| `event_not_found` | 404 | No event with that id. |
| `internal` | 500 | Something went wrong on our side. |

**`event_not_found` is one answer for three situations**: the event does not exist, it belongs to another merchant, or the id is not a well-formed id at all. Same status, same code, same sentence. An error that told them apart would turn this endpoint into a way of asking whether somebody else's event id is real.
