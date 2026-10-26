---
sidebar_position: 12
title: Webhooks
---

# Webhooks

A webhook is a `POST` we make to your `callback_url` when something happens to one of your charges or payouts. This page is the receiving end: where deliveries go, the secret that signs them, what you must answer, and what happens when you do not.

**The bodies themselves are documented once, on the [Events](./events) page.** Every field of every type, which fields are always present and which may be null, and a worked example of each — [the payload](./events#the-payload). They live there rather than being repeated here so there is only ever one description of them to keep true.

## Before anything is delivered

- You store a `callback_url` on your merchant. It is validated at registration (https, public, punycode for non-ASCII hostnames) so a bad one fails there rather than silently never delivering. See [Merchants](./merchants#callback-urls).
- When an operator approves your merchant, a **webhook secret** is issued. It signs every delivery.

### The webhook secret is shown once

The secret is shown **once, at approval**, and is **never retrievable afterwards**. It is not in `GET /v1/merchants/me`, and no endpoint returns it or anything derived from it. A secret that can be read back over an API is not a secret.

Store it in a secret manager the moment you receive it. If you lose it, an operator has to issue a new one; write to kakitu@kakitu.org.

A merchant cannot be approved without a secret, and a delivery is never sent without one: an unsigned delivery is one you could not tell from a forgery, so there is no "just this once".

Your callback URL and your secret are read **fresh on every attempt**, so fixing an endpoint or rotating a secret is believed on the next retry rather than at some later deploy of ours.

## The request

`POST` to your `callback_url`, `Content-Type: application/json`, `User-Agent: Kakitu-Webhooks/1`, and three headers:

| Header | Value |
|---|---|
| `Kakitu-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">` |
| `Kakitu-Event-Id` | The event id. Your dedupe key. |
| `Kakitu-Event-Type` | One of the five types below. |

**Only the signature is worth trusting.** The other two headers are a convenience and both values are also inside the signed body; reading them without verifying the signature verifies nothing.

### Verifying the signature

`v1` is the HMAC-SHA256, keyed with your webhook secret, of the string `<t>.<raw body>`.

The timestamp is **inside** the signed string, not merely alongside it, which is what makes checking it worth anything: move `t` and the signature breaks. The `.` is a separator rather than decoration — without it `"1" + "23.x"` and `"12" + "3.x"` would sign identically and a replayer could shift the clock by trimming the body.

Verify against the **exact bytes** of the request body. Parsing and re-serialising before you verify reorders keys and changes whitespace, and you will then be checking a different string from the one we signed. There is a worked implementation on the Events page: [verifying the signature](./events#verifying-the-signature).

## The body

Every delivery carries one of five event types:

| `type` | What it tells you |
|---|---|
| `charge.paid` | The payer paid. Your wallet is not credited yet. |
| `charge.settled` | The KSHS is at your address. This is the one to release goods on. |
| `charge.failed` | The collection did not go through, or was refunded. |
| `payout.expired` | **It was not sent. Sign and submit it again.** |
| `payout.cancelled` | **It was not sent. A person refused it. Do not submit it again.** |

Each body is a four-field envelope — `id`, `type`, `created_at` — wrapped around **one** subject object, `charge` or `payout`. A charge event has no `payout` key at all and a payout event has no `charge` key; the key is absent, not present-and-`null`. **Branch on `type` and on nothing else.**

**Every field of every type, what is always present, what may be null, and an example body of each: [the payload](./events#the-payload).**

:::danger The two payout types are opposite instructions
Both mean **nothing left your wallet and nothing reached the beneficiary.** They differ only in
what you do next, and they differ completely: `payout.expired` asks you to send the money again,
`payout.cancelled` forbids it.

A held payout carries a signed permit that stops being relayable after minutes, and a person
working a review queue does not work in minutes — so a hold nobody reaches in time lapses, and
`payout.expired` is the *ordinary* end of one, not an edge case. The answer to it is a fresh
quote, a fresh signature and a **new** payout. `payout.cancelled` means an operator looked at it
and decided the money does not go; re-signing walks straight back into a decision a person has
just taken.

**The `type` is the only way to tell them apart.** There is no reason field and no sentence to
read — deliberately, because a receiver that had to parse English to decide whether to send money
a second time would eventually get it wrong. Acting on the wrong one either loses a payment or
sends it twice.
:::

## Two contracts your receiver must be built for

**Delivery is at-least-once.** The same event can reach you more than once — a timeout on our side, a crash after your `200`, or a replay you asked for. The event `id` (also `Kakitu-Event-Id`) is **stable across every attempt and every replay** and is your dedupe key. Key on it, ignore an id you have already processed, and you get exactly-once. Do not key on the charge or payout id: one subject produces several events.

**A payload is never a delta.** Every body states its subject's **state at the time the event was raised**, in full. Nothing in it is an increment or a patch, which is what makes processing a duplicate a no-op rather than a second count.

Because retries run for up to 24 hours, a body can arrive after its subject has moved on: a `charge.paid` that took four hours to get through describes the charge as it was four hours ago, and the `charge.settled` behind it is the newer truth. **Order your own processing by the envelope's `created_at`, never by arrival time.**

## What you must answer

**A `2xx`, and nothing else counts as delivered.** A `3xx` is a failure and the redirect is not followed — following one would carry a body signed for your host to a host the signature was never meant for.

Answer as soon as you have stored the event and do your work afterwards. A receiver that finishes its processing before answering turns a slow job into a retry, and a retry into a duplicate.

### The retry schedule

30 seconds, then 1 minute, 2, 4, 8, and so on, doubling to a ceiling of 6 hours. When the *next* attempt would fall outside **24 hours** from the first, the event is marked `abandoned` instead of being retried again.

We stop at a day because an endpoint that has been down that long has a human problem, and a queue that retried forever would turn one broken integration into an unbounded backlog for everybody.

## When one is missed

Nothing is lost if your endpoint was down. Every event stays readable on [`GET /v1/events`](./events#get-v1events) — including what we tried to send and, in a closed vocabulary rather than a raw error string, why the last attempt failed — and [`POST /v1/events/{id}/replay`](./events#post-v1eventsidreplay) puts one back in the queue with a fresh 24-hour budget.

The event id does not change on a replay, which is the point: a receiver that dedupes on it, as the at-least-once contract requires, can tell this is one it may already have seen.
