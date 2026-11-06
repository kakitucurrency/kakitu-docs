---
sidebar_position: 13
title: Events
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Events

An event is one webhook delivery: what we sent you about a charge, a payment you received, a payout or your own payout controls, when we tried, and whether it worked. These two endpoints exist because **delivery is best-effort, not guaranteed.** An endpoint that was down for a day has events marked `abandoned`, and you need to be able to see that, read what we tried to send, fix your side and ask for it again — without opening a support ticket.

## Delivery is at-least-once

**Your endpoint can be rung more than once for the same event. Build for it.**

This is not a bug we intend to fix, because it cannot be fixed. Sending the request and recording "delivered" are two acts, and anything that happens between them — a timeout on our side, a crash after your `200`, a replay you asked for — means we try again. An endpoint that accepted a delivery and then had the answer lost will be rung again with the same body.

**The event `id` is your dedupe key.** It is stable across every attempt and across a replay: the same event is always the same id. Key on it, ignore an id you have already processed, and you get exactly-once. Do not key on the subject id — one charge produces several events.

The corollary is that **no payload is ever a delta.** Every body states its subject's whole current state, so processing a duplicate is a no-op rather than a second increment.

## The thirteen types

A merchant's integration branches on `type` and on nothing else, so each of these is its own string rather than one type with a reason field in it.

| `type` | About | What it tells you |
|---|---|---|
| `charge.paid` | a charge | The payer paid. |
| `charge.settled` | a charge | The KSHS is at your address: the amount minted for this payment, which is less than `charge.amount`. |
| `charge.failed` | a charge | The charge did not go through. |
| `transfer.received` | a payment | KSHS arrived at your address on chain, from anybody, by any route. Carries the payer's `reference` if they sent one. |
| `payout.approved` | a payout | **A person said yes. Quote and sign it now**, before `payout.approval_expires_at`. |
| `payout.rejected` | a payout | **A person said no. Do not ask again.** Nothing was signed or sent. |
| `payout.expired` | a payout | **It was not sent. Ask again with a new payout.** An approval nobody signed in time, or a held payout whose signature lapsed. |
| `payout.cancelled` | a payout | **It was not sent. A person refused it. Do not submit it again.** Kept for events already written; a refusal now arrives as `payout.rejected`. |
| `payout.paid` | a payout | The beneficiary has the money. |
| `payout.failed` | a payout | It did not reach the beneficiary. A retry is a new payout. |
| `payout_destination.added` | your controls | **Somebody holding your key saved a new place to pay.** It can be paid from `destination.active_at`. If that was not you, remove it and replace your key before then. |
| `payout_destination.removed` | your controls | A saved place came off your list. |
| `payout_lock.changed` | your controls | **The payout lock moved.** It went on, or somebody asked for it to come off. |

The last three are the alarm for your own payout controls: if you did not make the change, somebody else holds your key.

### The approve-first events

A payout above your `hold_above_kes` asks a person **before** you sign: you `POST /v1/payouts/requests`, and the answer comes as an event. [Payouts](./payouts#approve-first) has the whole sequence.

- **`payout.approved`** is the instruction to go: quote with the `payout_id`, sign, submit, before `payout.approval_expires_at`.
- **`payout.rejected`** is the instruction to stop. It can also follow `payout.approved`, if an operator takes the yes back before you have signed. Nothing was sent.
- **`payout.expired`** after an approval means you did not sign before it lapsed. Nothing was sent. The answer is a new request.

### `payout.expired`, `payout.cancelled` and `payout.rejected`

All three mean the same thing about the money: **nothing left your wallet and nothing reached the beneficiary.** They differ only in what you should do next.

`payout.expired` asks you to try again with a **new** payout: a fresh request, quote and signature. `payout.cancelled` and `payout.rejected` both mean a person looked at the payout and decided the money does not go. Re-submitting walks straight back into a decision a person has just taken.

**The `type` is the only reliable way to tell them apart.** There is no reason field and no sentence to read, deliberately: a receiver that had to parse English to decide whether to send money a second time would eventually get it wrong. See [Payouts](./payouts#approve-first).

## What a delivery looks like

A `POST` to your `callback_url`, `Content-Type: application/json`, `User-Agent: Kakitu-Webhooks/1`, with three headers:

| Header | Value |
|---|---|
| `Kakitu-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256>` |
| `Kakitu-Event-Id` | The event id. Your dedupe key. |
| `Kakitu-Event-Type` | One of the thirteen types above. |

**Only the signature header is worth trusting.** The other two are a convenience, and both values are also inside the signed body; a receiver that reads them without verifying the signature has verified nothing.

## The payload

Every body is the same four-field envelope wrapped around **one** subject object, named for what the event is about.

| Field | Type | Present |
|---|---|---|
| `id` | string, UUID | **Always.** The event id — the same value as `Kakitu-Event-Id`, and the same on every retry and every replay. Your dedupe key. |
| `type` | string | **Always.** One of the thirteen. |
| `created_at` | string, RFC 3339 UTC to the second | **Always.** When the event was *raised*, not when it was delivered or when you received it. |
| `charge` | object | On `charge.paid`, `charge.settled` and `charge.failed`. |
| `transfer` | object | On `transfer.received`. |
| `payout` | object | On the six `payout.*` types: `approved`, `rejected`, `expired`, `cancelled`, `paid`, `failed`. |
| `destination` | object | On `payout_destination.added` and `payout_destination.removed`. |
| `payout_lock` | object | On `payout_lock.changed`. |

Three things are true of every one of the thirteen bodies, and your receiver can rely on all three:

**A payload is never a delta.** It is the subject's **state at the time the event was raised**, stated in full, every time. Nothing in it is an increment, a difference or a patch. That is what makes a duplicate delivery a no-op rather than a second count.

**Only the subject that the event is about is present.** A charge event has no `payout` key at all, a payout event has no `charge` key, and so on. The key is *absent*, not present-with-`null`. Do not branch on which key you can see — branch on `type`.

**The subject's `status` always restates `type`.** `charge.paid` always carries `"status": "paid"`, `payout.cancelled` always carries `"status": "cancelled"`, and so on. It is there so the subject object reads correctly on its own; it tells you nothing `type` did not.

One consequence of "state at the time it was raised": because delivery retries for up to 24 hours, a body can reach you after the subject has moved on. A `charge.paid` that took four hours to get through describes the charge as it was four hours ago, and the `charge.settled` behind it is the newer truth. Order your own processing by `created_at`, never by arrival.

### `charge.paid`

The rail says the payer paid. The KSHS is not at your address yet — wait for `charge.settled` before you release goods.

| Field | Type | Present |
|---|---|---|
| `charge.id` | string, UUID | **Always.** Kakitu's id for the charge. |
| `charge.reference` | string | **Always, and never empty.** Your own reference, the one you set when you created the charge. Unique per merchant. |
| `charge.amount` | integer | **Always.** A whole number of shillings. The field is `amount`, **not** `amount_kes` — a charge and a payout name their amounts differently; see the note below. |
| `charge.currency` | string | **Always.** Always the string `"KES"`. |
| `charge.status` | string | **Always.** Always `"paid"` on this type. |
| `charge.paid_at` | string, RFC 3339 UTC | **Always a timestamp on this type**, never `null`. |
| `charge.settled_at` | `null` | **Always `null` on this type.** The key is present and its value is `null`; nothing has settled yet. |
| `charge.fee_kes` | integer | **Always a number on this type.** What the collection cost, in whole shillings. |
| `charge.credited_kes` | integer | **Always a number on this type.** What reaches your wallet: `charge.amount` less `charge.fee_kes`. |

```json
{
  "id": "4e7c2b18-0f2a-4a1b-9a44-1b2c3d4e5f60",
  "type": "charge.paid",
  "created_at": "2026-10-26T09:13:44Z",
  "charge": {
    "id": "a1f0c9d2-55b1-4f3e-8a0d-77c1e2b3a4d5",
    "reference": "order-1042",
    "amount": 500,
    "currency": "KES",
    "status": "paid",
    "paid_at": "2026-10-26T09:13:44Z",
    "settled_at": null,
    "fee_kes": 15,
    "credited_kes": 485
  }
}
```

### `charge.settled`

The KSHS is at your address on chain. This is the event to release goods on.

| Field | Type | Present |
|---|---|---|
| `charge.id` | string, UUID | **Always.** |
| `charge.reference` | string | **Always, and never empty.** |
| `charge.amount` | integer | **Always.** Whole shillings the payer was asked for. **Not** what you were credited: the KSHS minted to you is less, by our partner's fee and our spread. See [below](#charges-and-payouts-name-their-amounts-differently). |
| `charge.currency` | string | **Always** `"KES"`. |
| `charge.status` | string | **Always** `"settled"` on this type. |
| `charge.paid_at` | string, RFC 3339 UTC | **Always a timestamp on this type**, never `null`. If the charge jumped straight to settled without a `charge.paid` ever being raised, this is the moment it settled. |
| `charge.settled_at` | string, RFC 3339 UTC | **Always a timestamp on this type**, never `null`. It equals the envelope's `created_at`. |
| `charge.fee_kes` | integer | **Always a number on this type.** What the collection cost, in whole shillings. |
| `charge.credited_kes` | integer | **Always a number on this type.** What reached your wallet: `charge.amount` less `charge.fee_kes`. |

```json
{
  "id": "6d9a4f12-7b31-4c08-9e5d-2a8f0b1c3d4e",
  "type": "charge.settled",
  "created_at": "2026-10-26T09:14:02Z",
  "charge": {
    "id": "a1f0c9d2-55b1-4f3e-8a0d-77c1e2b3a4d5",
    "reference": "order-1042",
    "amount": 500,
    "currency": "KES",
    "status": "settled",
    "paid_at": "2026-10-26T09:13:44Z",
    "settled_at": "2026-10-26T09:14:02Z",
    "fee_kes": 15,
    "credited_kes": 485
  }
}
```

### `charge.failed`

The collection did not go through, or a payment that had gone through was refunded.

| Field | Type | Present |
|---|---|---|
| `charge.id` | string, UUID | **Always.** |
| `charge.reference` | string | **Always, and never empty.** |
| `charge.amount` | integer | **Always.** Whole shillings — what was asked for, not what was collected. |
| `charge.currency` | string | **Always** `"KES"`. |
| `charge.status` | string | **Always** `"failed"` on this type. |
| `charge.paid_at` | string or `null` | **May be either.** `null` for a charge that never got as far as paid — the ordinary case. A **timestamp** for a charge that was paid and then refunded, and that timestamp is when it was paid, not when it failed. Read this field if you need to tell a refund from a payment that never arrived. |
| `charge.settled_at` | `null` | **Always `null` on this type.** A settled charge never fails. |
| `charge.fee_kes` | `null` | **Always `null` on this type.** Nothing was credited. |
| `charge.credited_kes` | `null` | **Always `null` on this type.** Nothing was credited. |

```json
{
  "id": "c0b7e218-9f44-4a63-8d12-5e6f7a8b9c0d",
  "type": "charge.failed",
  "created_at": "2026-10-26T09:18:31Z",
  "charge": {
    "id": "b2e1d8c7-66a2-4d5f-9b1c-88d2f3a4b5c6",
    "reference": "order-1043",
    "amount": 1200,
    "currency": "KES",
    "status": "failed",
    "paid_at": null,
    "settled_at": null,
    "fee_kes": null,
    "credited_kes": null
  }
}
```

**There is no reason, code or message on a `charge.failed`.** Why a collection failed is a rail's word about a payer, and it is not part of this contract. If you need to tell "never paid" from "paid and refunded", `paid_at` is the field that answers it.

### `transfer.received`

**KSHS arrived at your address.** This is the notification for a payment made with `pay()`, a `kakitu:` link, a QR code or any wallet: it is raised from the chain, for a transfer **to** your address, whoever sent it and by whatever route. Mints and burns are never announced. Only an approved merchant receives it.

| Field | Type | Present |
|---|---|---|
| `transfer.tx_hash` | string | **Always.** The transaction on Base. |
| `transfer.log_index` | integer | **Always.** Which `Transfer` log in that transaction. With `tx_hash` it names the payment. |
| `transfer.from` | string | **Always.** The payer's address. |
| `transfer.to` | string | **Always.** Your address. |
| `transfer.amount_kes` | string | **Always.** The exact amount as a decimal **string**, such as `"99.5"`, not whole shillings: a KES 99.50 invoice must not read as 99. |
| `transfer.value_wei` | string | **Always.** The same amount in the token's smallest unit. A string, because it does not fit a JSON number. |
| `transfer.block_number` | integer | **Always.** |
| `transfer.observed_at` | string, RFC 3339 UTC | **Always.** When we saw it on chain. |
| `transfer.reference` | string | **Only when the payer sent one.** The key is absent otherwise. 1 to 64 characters from `[A-Za-z0-9._:-]`. |

```json
{
  "id": "0e5f7a21-3c46-4d89-b0a2-6d1e9f8c7b53",
  "type": "transfer.received",
  "created_at": "2026-11-07T08:21:09Z",
  "transfer": {
    "tx_hash": "0x9f3c…",
    "log_index": 4,
    "from": "0x2b7e…",
    "to": "0x58a1…",
    "amount_kes": "1250",
    "value_wei": "1250000000000000000000",
    "block_number": 24310987,
    "observed_at": "2026-11-07T08:21:09Z",
    "reference": "ORD-1042"
  }
}
```

**A reference is the payer's claim, not proof.** Anybody can send KSHS to your address with any reference they like, including one that belongs to somebody else's order. Before you release goods, check the amount and the recipient against the order the reference names, and match each order to one transfer. The reference tells you which order to look at; it does not tell you the order is paid.

**Do not release on a payment that is not in this event.** A screenshot of a payer's phone is not a payment.

### `payout.approved`

**A person said yes. Quote and sign it now.**

| Field | Type | Present |
|---|---|---|
| `payout.id` | string, UUID | **Always.** The `payout_id` to quote with. |
| `payout.status` | string | **Always** `"approved"` on this type. |
| `payout.amount_kes` | integer | **Always.** Whole shillings that will land on the beneficiary. |
| `payout.fee_kes` | integer | **Always `0` on this type.** A request is priced when you quote it. |
| `payout.send_kes` | integer | **Always `0` on this type.** Set by the quote. |
| `payout.currency` | string | **Always** `"KES"`. |
| `payout.approval_expires_at` | string, RFC 3339 UTC | **Only on this type.** Sign and submit before this, or the approval lapses and you will receive `payout.expired`. |

```json
{
  "id": "5d2c8e10-6a17-4f93-8b40-1e7a9c3d2f68",
  "type": "payout.approved",
  "created_at": "2026-11-07T09:02:11Z",
  "payout": {
    "id": "7c2b18e4-0f2a-4a1b-9a44-1b2c3d4e5f60",
    "status": "approved",
    "amount_kes": 9000,
    "fee_kes": 0,
    "send_kes": 0,
    "currency": "KES",
    "approval_expires_at": "2026-11-08T09:02:11Z"
  }
}
```

### `payout.rejected`

**A person said no. Do not ask again.** The body has the same six payout fields, with `status` reading `"rejected"` and no `approval_expires_at`. Nothing was signed, nothing was sent and none of the day's budget was spent.

### `payout.paid` and `payout.failed`

`payout.paid`: **the beneficiary has the money.** `payout.failed`: **it did not reach the beneficiary, and a retry is a new payout.** The same six payout fields, with `status` reading `"paid"` or `"failed"`. Neither is raised for an outcome nobody knows: a payout whose result is not known stays `dispatched`, and you read it with [`GET /v1/payouts/{id}`](./payouts#get-v1payoutsid).

### `payout_destination.added` and `payout_destination.removed`

About your own saved payout destinations. A destination is named by its type and the end of its number; the holder's name stays out.

| Field | Type | Present |
|---|---|---|
| `destination.id` | string, UUID | **Always.** The id to `DELETE` it with. |
| `destination.type` | string | **Always.** `phone`, `till`, `paybill` or `bank`. |
| `destination.ending` | string | **Always.** The last four characters of the number, enough to recognise your own. |
| `destination.active_at` | string, RFC 3339 UTC | **On `payout_destination.added` only.** The moment it can first be paid. |

```json
{
  "id": "2a9c4e71-5b08-4d63-9f12-8c7d6e5a4b30",
  "type": "payout_destination.added",
  "created_at": "2026-11-07T10:00:00Z",
  "destination": { "id": "c3d4…", "type": "till", "ending": "3456", "active_at": "2026-11-08T10:00:00Z" }
}
```

**If you did not save that destination, somebody else holds your key.** Remove it before `active_at`, with [`DELETE /v1/payout-destinations/{id}`](./payouts#saved-destinations-and-the-lock), and replace the key.

### `payout_lock.changed`

| Field | Type | Present |
|---|---|---|
| `payout_lock.locked` | boolean | **Always `true`.** Asking to unlock leaves the lock on until `unlocks_at`. |
| `payout_lock.unlocks_at` | string, RFC 3339 UTC | **Only while an unlock is pending.** Its absence says the lock is on and not coming off. |

```json
{
  "id": "8b1d3f55-7c29-4e04-a6b8-0d9e1f2a3c47",
  "type": "payout_lock.changed",
  "created_at": "2026-11-07T11:00:00Z",
  "payout_lock": { "locked": true, "unlocks_at": "2026-11-08T11:00:00Z" }
}
```

If somebody asked for the lock to come off and it was not you, turn it on again: that cancels the unlock at once. The lock controls where your **cash-outs** can go. It does not stop KSHS transfers to other wallets.

### `payout.expired`

**The payout was not sent. Ask again with a new payout.** Either an approval went unsigned past `approval_expires_at`, or a held payout's signature passed its deadline.

| Field | Type | Present |
|---|---|---|
| `payout.id` | string, UUID | **Always.** The payout that did not go. |
| `payout.status` | string | **Always** `"expired"` on this type. |
| `payout.amount_kes` | integer | **Always.** Whole shillings that *would have* landed on the beneficiary. |
| `payout.fee_kes` | integer | **Always.** Kakitu's fee on it. Can be `0`. |
| `payout.send_kes` | integer | **Always.** Whole shillings that *would have* left your wallet. |
| `payout.currency` | string | **Always** `"KES"`. A payout is KES by construction — the beneficiary is paid into a Kenyan mobile money account. |

```json
{
  "id": "9b3d1a70-2c55-4e81-a0b7-3f6c1d2e4a89",
  "type": "payout.expired",
  "created_at": "2026-10-26T09:24:02Z",
  "payout": {
    "id": "7c2b18e4-0f2a-4a1b-9a44-1b2c3d4e5f60",
    "status": "expired",
    "amount_kes": 1000,
    "fee_kes": 25,
    "send_kes": 1025,
    "currency": "KES"
  }
}
```

### `payout.cancelled`

**The payout was not sent. A person refused it. Do not submit it again.** A refusal now arrives as `payout.rejected`; this type stays for events already written.

The body is the same six fields as `payout.expired`, with `status` reading `"cancelled"`. The amounts are what the payout was worth, so you can reconcile it against your own ledger and close it out.

| Field | Type | Present |
|---|---|---|
| `payout.id` | string, UUID | **Always.** |
| `payout.status` | string | **Always** `"cancelled"` on this type. |
| `payout.amount_kes` | integer | **Always.** Whole shillings that *would have* landed on the beneficiary. |
| `payout.fee_kes` | integer | **Always.** Can be `0`. |
| `payout.send_kes` | integer | **Always.** Whole shillings that *would have* left your wallet. |
| `payout.currency` | string | **Always** `"KES"`. |

```json
{
  "id": "1f4a6c93-8d20-4b57-ae31-0c9d8e7f6a5b",
  "type": "payout.cancelled",
  "created_at": "2026-10-26T10:02:18Z",
  "payout": {
    "id": "3a5b7d91-4e62-4c08-b1d7-9f0e2a3b4c5d",
    "status": "cancelled",
    "amount_kes": 40000,
    "fee_kes": 300,
    "send_kes": 40300,
    "currency": "KES"
  }
}
```

**There is no cancellation reason, and there will not be one.** An operator's words about why they refused a payout are not a thing to branch on, and reading them would be the one case where sending money a second time depended on parsing English. The type is the instruction.

### Why a payout payload has no timestamps

A `payout.*` body carries no `held_at`, `dispatched_at` or `paid_at`, because none of them would be true: nothing was dispatched and nothing was paid. The envelope's `created_at` is when the hold ended, and that is the only time there is to report.

### Charges and payouts name their amounts differently

| | Charge | Payout |
|---|---|---|
| What was asked for (charge) / what lands on the beneficiary (payout) | `amount` | `amount_kes` |
| What reaches your wallet | `credited_kes`, `null` until paid | — |
| Kakitu's fee | `fee_kes`, `null` until paid | `fee_kes` |
| What leaves your wallet | *not in the payload* | `send_kes` |

This is not a slip to be tidied up later: each payload uses the names its own API already uses, so you meet one vocabulary whether you poll [`GET /v1/charges`](./collections) or [`GET /v1/payouts/{id}`](./payouts), or listen. Do not book a charge's `amount` as revenue: the KSHS that reaches your wallet is `credited_kes`, smaller by the collection's cost (`fee_kes`). Both are `null` until the charge is paid, and cleared again if a paid charge is refunded. See [Pricing, limits and settlement](./pricing).

### What is never in a payload

Both payload shapes are built field by field, and the fields below are not among them — not absent by accident, and not coming later.

A `charge.*` body never carries:

- the payer's phone number, or any hash or masked form of it;
- the payer's wallet address;
- the name of the payment rail or partner that served the collection, or that partner's own status string;
- Kakitu's internal order id or order reference;
- your own merchant address;
- the charge's `created_at` (that one is on [`GET /v1/charges`](./collections), not here).

A `payout.*` body never carries:

- the beneficiary's number, account or name (they are on [`GET /v1/payouts/{id}`](./payouts), under `beneficiary`, but never on the wire to your endpoint);
- the identity of the operator who decided it, or the reason they recorded;
- the rail name, the pricing partner's quote id, the signed permit or its deadline.

**If your integration needs the payer's number, it will never arrive in a webhook.** Hold it on your side against your own `reference` and match on that; `reference` is on every `charge.*` body for exactly this purpose. There is a test in the server that asserts, by literal string, that a payer phone number, a payer address, a rail name, a partner status and an internal order id are absent from a rendered charge payload — so this is a property of the build, not a convention.

### Verifying the signature

`v1` is the HMAC-SHA256, keyed with your webhook secret, of the string `<t>.<raw body>`.

The timestamp is **inside** the signed string, not merely alongside it. That is what makes it worth checking: move `t` and the signature breaks. The `.` is a separator, not decoration — without it `"1" + "23.x"` and `"12" + "3.x"` would sign identically and a replayer could shift the clock by trimming the body.

<Tabs groupId="lang">
<TabItem value="curl" label="cURL" default>

```bash
# $HEADER is the Kakitu-Signature value, $BODY the EXACT request body. Do not pretty-print
# or re-serialise the body first: you would then be checking a different string.
T=${HEADER%%,*}; T=${T#t=}
V1=${HEADER##*v1=}

# The timestamp is INSIDE the signed string, which is what makes checking it worth doing.
AGE=$(( $(date +%s) - T )); [ "${AGE#-}" -le 300 ] || { echo stale; exit 1; }

EXPECTED=$(printf '%s.%s' "$T" "$BODY" \
  | openssl dgst -sha256 -hmac "$KAKITU_WEBHOOK_SECRET" | awk '{print $NF}')
[ "$EXPECTED" = "$V1" ] && echo ok || echo FORGERY
```

A shell cannot compare in constant time. The three programs below do, and a real receiver
should: use one of them rather than this at the edge of a production service.

</TabItem>
<TabItem value="ts" label="TypeScript">

```ts title="verify.mjs"
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

</TabItem>
<TabItem value="py" label="Python">

```python title="verify.py"
import hashlib
import hmac
import time


def verify(secret: str, header: str, raw: bytes) -> bool:
    """`raw` must be the EXACT bytes of the request body. Do not parse and re-serialise
    before verifying: that reorders keys and changes whitespace, and you will then be
    checking a different string from the one we signed.

    In Flask that is request.get_data(); in Django, request.body. NOT request.json
    re-dumped, and not a middleware's pretty-printed copy."""
    parts = dict(p.split("=", 1) for p in header.split(",") if "=" in p)
    try:
        t = int(parts["t"])
    except (KeyError, ValueError):
        return False
    if abs(time.time() - t) > 300:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))
```

</TabItem>
<TabItem value="php" label="PHP">

```php title="verify.php"
<?php
declare(strict_types=1);

/**
 * $raw must be the EXACT bytes of the request body. Do not parse and re-serialise before
 * verifying: that reorders keys and changes whitespace, and you will then be checking a
 * different string from the one we signed. In PHP that is file_get_contents('php://input'),
 * read once and kept - NOT json_encode(json_decode(...)).
 */
function kakitu_verify_webhook(string $secret, string $header, string $raw): bool
{
    $parts = [];
    foreach (explode(',', $header) as $p) {
        [$k, $v] = array_pad(explode('=', $p, 2), 2, '');
        $parts[$k] = $v;
    }
    if (!isset($parts['t'], $parts['v1']) || !ctype_digit($parts['t'])) {
        return false;
    }
    if (abs(time() - (int) $parts['t']) > 300) {
        return false;
    }
    $expected = hash_hmac('sha256', $parts['t'] . '.' . $raw, $secret);
    return hash_equals($expected, $parts['v1']);   // constant time
}
```

</TabItem>
</Tabs>

Your webhook secret is issued once, when an operator approves you, and is never retrievable afterwards. See [Webhooks](./webhooks).

### What counts as delivered

**A 2xx, and nothing else.** A `3xx` is a failure and the redirect is not followed — following one would carry a body signed for your host to a host the signature was never meant for. Answer `200` as soon as you have stored the event; do your work afterwards. A receiver that does its processing before answering turns a slow job into a retry.

### The retry schedule

30 seconds, then 1 minute, 2, 4, 8, and so on, doubling to a ceiling of 6 hours. When the *next* attempt would fall outside **24 hours** from the first, the event is marked `abandoned` instead.

It is not thrown away. It stays readable on `GET /v1/events`, and `POST /v1/events/{id}/replay` gives it a fresh budget once your endpoint is fixed. We stop at a day because an endpoint that has been down that long has a human problem, and a queue that retried forever would turn one broken integration into an unbounded backlog for everybody.

Your callback URL and your secret are read **fresh on every attempt**. Fix your endpoint or rotate your secret and the next retry believes you — you do not have to wait for anything on our side.
## Running these examples

Every example on this page is **signed**. An unsigned request is `401 unauthorized`, so a
shorter version would not be worth printing.

None of them writes a fourth signer. The TypeScript, Python and PHP snippets call the complete
programs on [Authentication](./authentication): save those three beside your script as
`kakitu.mjs`, `kakitu.py` and `kakitu.php`, and export `KAKITU_PRIVATE_KEY` before running
anything. cURL cannot sign by itself, so the shell examples make the same EIP-191 signature
through one helper function that calls Foundry's `cast`.

<details>
<summary><code>kakitu.sh</code> &mdash; the shell signer every cURL example on this page calls</summary>

```bash title="kakitu.sh"
# kakitu.sh - sign a Kakitu request from the shell and send it.
#   Needs curl, openssl and Foundry's `cast` (https://getfoundry.sh).
#   Keep the key in the environment or a secret store: KAKITU_PRIVATE_KEY=0x...
#   Never in a script, a ticket, or your shell history.
KAKITU_BASE_URL=${KAKITU_BASE_URL:-https://walletapi.kakitu.org}

# kakitu METHOD TARGET [BODY] [extra curl args...]
kakitu() {
  local method=$1 target=$2 body=${3-}
  shift $(( $# < 3 ? $# : 3 ))
  local ts hash addr sig
  ts=$(date +%s)                                   # seconds, within 120s of server time
  hash=$(printf '%s' "$body" | openssl dgst -sha256 | awk '{print $NF}')
  addr=$(cast wallet address --private-key "$KAKITU_PRIVATE_KEY")
  # `cast wallet sign` is EIP-191 personal_sign - the same thing the other three programs do.
  sig=$(cast wallet sign --private-key "$KAKITU_PRIVATE_KEY" "$method $target $ts $hash")
  # An array, not an unquoted ${body:+...}: that splits differently in bash and zsh.
  local args=(-sS -X "$method" "$KAKITU_BASE_URL$target"
    -H "X-Kakitu-Address: $addr"
    -H "X-Kakitu-Timestamp: $ts"
    -H "X-Kakitu-Signature: $sig")
  [ -n "$body" ] && args+=(-H "Content-Type: application/json" --data-raw "$body")
  curl "${args[@]}" "$@"
}
```

`source kakitu.sh` once per shell, then call `kakitu METHOD TARGET [BODY] [curl args...]`.
`TARGET` is the path plus `?query` when there is one, byte for byte as it will be sent: the
query string is inside the signed message, so quote it and change it nowhere else.

</details>


## GET /v1/events

Your own events, newest first. Signed request, no body.

<Tabs groupId="lang">
<TabItem value="curl" label="cURL" default>

```bash
# The query is INSIDE the signed message, so pass the whole target as one quoted argument.
kakitu GET '/v1/events?status=abandoned&limit=50'

# Everything still undelivered after a bad day, with the reason for the last attempt.
kakitu GET '/v1/events?status=abandoned&limit=100' \
  | jq -r '.data[] | [.id, .type, .attempts, .last_error] | @tsv'

# A filter value outside its set is invalid_request, not an empty page.
kakitu GET '/v1/events?type=charge.payed'     # 400: the typo is told to you
```

</TabItem>
<TabItem value="ts" label="TypeScript">

```ts title="list-events.mjs"
import { Wallet } from "ethers";
import { call } from "./kakitu.mjs";

const wallet = new Wallet(process.env.KAKITU_PRIVATE_KEY);

let target = "/v1/events?status=abandoned&limit=50";
for (;;) {
  const { body } = await call(wallet, "GET", target);   // the query is part of the signature
  for (const e of body.data) {
    // charge_id is NULLABLE now: exactly one of charge_id and payout_id is set. Reading
    // charge_id and assuming a string breaks on the first payout event you receive.
    const subject = e.charge_id ?? e.payout_id;
    console.log(e.id, e.type, subject, e.status, e.attempts, e.last_error ?? "");
    // payload is the exact body we sent, already parsed - no second JSON.parse.
    console.log(e.payload.type);
  }
  if (!body.next_cursor) break;
  target = `/v1/events?status=abandoned&limit=50&cursor=${encodeURIComponent(body.next_cursor)}`;
}
```

</TabItem>
<TabItem value="py" label="Python">

```python title="list_events.py"
import os
from urllib.parse import quote

from eth_account import Account
from kakitu import call

account = Account.from_key(os.environ["KAKITU_PRIVATE_KEY"])

target = "/v1/events?status=abandoned&limit=50"
while target:
    _, body = call(account, "GET", target)   # the query is part of the signature
    for e in body["data"]:
        # charge_id is NULLABLE now: exactly one of charge_id and payout_id is set. Reading
        # charge_id and assuming a str breaks on the first payout event you receive.
        subject = e["charge_id"] or e["payout_id"]
        print(e["id"], e["type"], subject, e["status"], e["attempts"], e.get("last_error", ""))
        # payload is the exact body we sent, already parsed - no second json.loads.
        print(e["payload"]["type"])
    cursor = body["next_cursor"]
    target = f"/v1/events?status=abandoned&limit=50&cursor={quote(cursor)}" if cursor else None
```

</TabItem>
<TabItem value="php" label="PHP">

```php title="list-events.php"
<?php
declare(strict_types=1);
require __DIR__ . '/kakitu.php';

$key = getenv('KAKITU_PRIVATE_KEY');

$target = '/v1/events?status=abandoned&limit=50';
while ($target !== null) {
    [, $body] = kakitu_call($key, 'GET', $target);   // the query is part of the signature
    foreach ($body['data'] as $e) {
        // charge_id is NULLABLE now: exactly one of charge_id and payout_id is set. Reading
        // charge_id and assuming a string breaks on the first payout event you receive.
        $subject = $e['charge_id'] ?? $e['payout_id'];
        echo $e['id'], ' ', $e['type'], ' ', $subject, ' ', $e['status'], ' ',
             $e['attempts'], ' ', ($e['last_error'] ?? ''), PHP_EOL;
        // payload is the exact body we sent, already decoded - no second json_decode.
        echo $e['payload']['type'], PHP_EOL;
    }
    $cursor = $body['next_cursor'];
    $target = $cursor === null
        ? null
        : '/v1/events?status=abandoned&limit=50&cursor=' . rawurlencode($cursor);
}
```

</TabItem>
</Tabs>

| Parameter | Rules |
|---|---|
| `type` | Any one of the thirteen: `charge.paid`, `charge.settled`, `charge.failed`, `transfer.received`, `payout.approved`, `payout.rejected`, `payout.expired`, `payout.cancelled`, `payout.paid`, `payout.failed`, `payout_destination.added`, `payout_destination.removed`, `payout_lock.changed`. |
| `status` | `pending`, `delivered` or `abandoned`. |
| `charge_id` | The id of one of your charges. There is no `payout_id` filter — narrow with a `type` such as `payout.expired` and match the id in the payload. |
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
      "payout_id": null,
      "created_at": "2026-10-26T09:14:02Z",
      "status": "abandoned",
      "attempts": 12,
      "next_attempt_at": null,
      "last_attempt_at": "2026-10-27T08:40:11Z",
      "delivered_at": null,
      "last_error": "http_502",
      "payload": { "id": "4e7c2b18-0f2a-4a1b-9a44-1b2c3d4e5f60", "type": "charge.settled", "created_at": "2026-10-26T09:14:02Z", "charge": { "id": "a1f0c9d2-55b1-4f3e-8a0d-77c1e2b3a4d5", "reference": "order-1042", "amount": 500, "currency": "KES", "status": "settled", "paid_at": "2026-10-26T09:13:44Z", "settled_at": "2026-10-26T09:14:02Z", "fee_kes": 15, "credited_kes": 485 } }
    }
  ],
  "next_cursor": "MjAyNi0xMC0yNlQwOToxNDowMloucy4u"
}
```

| Field | Meaning |
|---|---|
| `charge_id` | The charge this event is about. **Nullable:** it is `null` on every event that is not about a charge. |
| `payout_id` | The payout this event is about. `null` on every event that is not about a payout. **Both are `null` on `transfer.received` and on the three controls events**: read the id from `payload`. |
| `status` | `pending` (not yet delivered), `delivered` (your endpoint answered 2xx), `abandoned` (the 24-hour budget is spent). |
| `attempts` | How many attempts have failed so far. |
| `next_attempt_at` | When we will try again. **`null` unless the event is `pending`** — a next attempt that is not coming would be a lie. |
| `last_attempt_at` | When we last tried. `null` if we never have. |
| `delivered_at` | When your endpoint accepted it. |
| `last_error` | Why the last attempt failed. Absent if none has. See the table below. |
| `payload` | The exact body we sent, as JSON rather than as a quoted string, so you can read it without a second parse. Its shape is [the payload](#the-payload), decided by `type`. |

:::warning charge_id is nullable now
`charge_id` used to be present on every event, because a charge was the only thing an event
could be about. **At most one of `charge_id` and `payout_id` is set**, and on `transfer.received`
and the three controls events neither is.

A client that reads `charge_id` and assumes a string breaks on the first event that is not about
a charge. Check which one is set before you use it, and read the subject from `payload`.
:::

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
  "payout_id": null,
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

<Tabs groupId="lang">
<TabItem value="curl" label="cURL" default>

```bash
# No body, and NO Idempotency-Key: replay is idempotent by construction.
kakitu POST /v1/events/4e7c2b18-0f2a-4a1b-9a44-1b2c3d4e5f60/replay

# Requeue everything that was abandoned, once your endpoint is fixed.
kakitu GET '/v1/events?status=abandoned&limit=100' | jq -r '.data[].id' \
  | while read -r ID; do kakitu POST "/v1/events/$ID/replay" >/dev/null; done
```

</TabItem>
<TabItem value="ts" label="TypeScript">

```ts title="replay.mjs"
import { Wallet } from "ethers";
import { call } from "./kakitu.mjs";

const wallet = new Wallet(process.env.KAKITU_PRIVATE_KEY);

// No body, and NO Idempotency-Key: requeuing an already-requeued event sets the same row to
// the same state, so calling this five times is one replay.
const { body: page } = await call(wallet, "GET", "/v1/events?status=abandoned&limit=100");
for (const e of page.data) {
  const { status, body } = await call(wallet, "POST", `/v1/events/${e.id}/replay`);
  // 202, not 200: nothing has been delivered when this returns. And the event id does not
  // change, which is the point - your receiver can still dedupe on it.
  console.log(status, body.id === e.id, body.status, body.attempts);   // 202 true pending 0
}
```

</TabItem>
<TabItem value="py" label="Python">

```python title="replay.py"
import os

from eth_account import Account
from kakitu import call

account = Account.from_key(os.environ["KAKITU_PRIVATE_KEY"])

# No body, and NO Idempotency-Key: requeuing an already-requeued event sets the same row to
# the same state, so calling this five times is one replay.
_, page = call(account, "GET", "/v1/events?status=abandoned&limit=100")
for e in page["data"]:
    status, body = call(account, "POST", f"/v1/events/{e['id']}/replay")
    # 202, not 200: nothing has been delivered when this returns. And the event id does not
    # change, which is the point - your receiver can still dedupe on it.
    print(status, body["id"] == e["id"], body["status"], body["attempts"])
```

</TabItem>
<TabItem value="php" label="PHP">

```php title="replay.php"
<?php
declare(strict_types=1);
require __DIR__ . '/kakitu.php';

$key = getenv('KAKITU_PRIVATE_KEY');

// No body, and NO Idempotency-Key: requeuing an already-requeued event sets the same row to
// the same state, so calling this five times is one replay.
[, $page] = kakitu_call($key, 'GET', '/v1/events?status=abandoned&limit=100');
foreach ($page['data'] as $e) {
    [$status, $body] = kakitu_call($key, 'POST', '/v1/events/' . $e['id'] . '/replay');
    // 202, not 200: nothing has been delivered when this returns. And the event id does not
    // change, which is the point - your receiver can still dedupe on it.
    echo $status, ' ', var_export($body['id'] === $e['id'], true), ' ',
         $body['status'], ' ', $body['attempts'], PHP_EOL;
}
```

</TabItem>
</Tabs>

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
