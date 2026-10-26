---
sidebar_position: 8
title: Orders
---

# Orders

An order is one movement of money between shillings and KSHS for your own wallet: a **deposit** (shillings in, KSHS credited) or a **withdrawal** (KSHS sent, shillings paid out).

**This API does not create orders.** There is no `POST /v1/orders`. Orders are created by Kakitu's own deposit and withdrawal flows for the wallet that owns them; this endpoint is how you read one you already have an id for. Collections are a different thing entirely and have their own ids — see [Collections](./collections).

## GET /v1/orders/\{id\}

Signed request, no body, no `Idempotency-Key`.

```json
HTTP 200
{
  "id": "6f1b7a66-7e5c-4a2e-9f3e-6d9a4a1c2b30",
  "type": "deposit",
  "status": "completed",
  "amount_kes": 1000,
  "receive_kes": 970,
  "fee_kes": 30,
  "created_at": "2026-10-26T08:55:12Z"
}
```

| Field | Meaning |
|---|---|
| `id` | The order's id. |
| `type` | `deposit` or `withdrawal`. |
| `status` | One of the six below. |
| `amount_kes` | Deposit: the shillings paid in. Withdrawal: the KSHS sent. |
| `receive_kes` | Deposit: the KSHS received. Withdrawal: the shillings paid out. |
| `fee_kes` | The difference. |
| `created_at` | When the order was created. |
| `expires_at` | **Only present while the order is `awaiting_payment`.** A deadline on an order nobody is waiting for would be noise. |

## Status

| `status` | Meaning |
|---|---|
| `awaiting_payment` | Waiting for the money to arrive. |
| `processing` | In flight. Nothing for you to do. |
| `completed` | Done. |
| `failed` | It did not complete. |
| `refunding` | Being reversed. |
| `refunded` | Reversed. |

These six are the whole set. Internally an order walks through far more steps than this — minting, funding, burning and others — and none of them appears here. A step that is not one of the six reads as `processing`, including any step added in future. That is on purpose: an integrator should never have to learn our pipeline's vocabulary, and a step we forget to translate must not leak as a raw string.

## What is not in the response

No reference, no phone number, no transaction hash, no partner name, no partner status, no partner order id, no failure text. Some of it is the payer's, some of it is a partner's, and none of it is yours to be given by us. If you need to reconcile against your own records, use the id.

## Errors

| `code` | HTTP | When |
|---|---|---|
| `unauthorized` | 401 | The request was not signed. |
| `order_not_found` | 404 | No order with that id. |
| `rail_unavailable` | 503 | Order lookup is temporarily unavailable. |
| `internal` | 500 | Something went wrong on our side. |

**`order_not_found` is one answer for four situations**: the order does not exist, it belongs to another wallet, the id is not a well-formed id at all, or it is an order this API does not expose (an order behind a merchant collection, for instance). Same status, same code, same sentence, deliberately. An error that told them apart would turn this endpoint into a way of asking whether somebody else's order id is real.
