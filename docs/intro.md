---
sidebar_position: 1
slug: /intro
title: Introduction
---

# Kakitu developer API

Kakitu is a Kenyan-shilling stablecoin. **KSHS is an ERC-20 token on Base, backed one to one by USDC held in reserve, and 1 KSHS is 1 KES.** Wallets are self-custody: the key is generated on the device and never reaches us. Reserve backing is public at [`https://walletapi.kakitu.org/reserves`](https://walletapi.kakitu.org/reserves).

The developer API lets a business **collect** money by M-Pesa and be credited in KSHS directly to its own wallet. The payer gets an M-Pesa PIN prompt, pays, and the shilling amount arrives as KSHS at the address you registered. We never hold it for you.

:::info Private release
The developer API is in private release and access is granted per merchant. Registration is
open; a Kakitu operator activates each merchant before it can collect or pay out. See
[Going live](./going-live).

The request and response shapes below are final and will not change under you.
:::

## The surface

| Endpoint | Status | Documented at |
|---|---|---|
| Sign requests with a wallet key | Final | [Authentication](./authentication) |
| `POST /v1/merchants` | Private release | [Merchants](./merchants) |
| `GET /v1/merchants/me` | Private release | [Merchants](./merchants) |
| `POST /v1/charges` | Private release | [Collections](./collections) |
| `GET /v1/charges` | Private release | [Collections](./collections) |
| `GET /v1/charges/{id}` | Private release | [Collections](./collections) |
| `POST /v1/transfers` | Private release | [Transfers](./transfers) |
| `POST /v1/quotes` | Private release | [Quotes](./quotes) |
| `GET /v1/orders/{id}` | Private release | [Orders](./orders) |
| `GET /v1/balances` | Private release | [Balances](./balances) |
| `GET /v1/limits` | Private release | [Limits](./limits) |
| `GET /v1/events` | Private release | [Events](./events) |
| `POST /v1/events/{id}/replay` | Private release | [Events](./events) |
| `POST /v1/payouts/quote` | Private release · off by default per merchant | [Payouts](./payouts) |
| `POST /v1/payouts` | Private release · off by default per merchant | [Payouts](./payouts) |
| `GET /v1/payouts` | Private release · a signed request is enough | [Payouts](./payouts) |
| `GET /v1/payouts/{id}` | Private release · a signed request is enough | [Payouts](./payouts) |
| Webhook delivery | Private release | [Webhooks](./webhooks) |
| Operator approval of a merchant | A person, not an endpoint. Required before collections work. | [Going live](./going-live) |

Sixteen routes. The twelve collection-side routes are enabled together, per merchant, once an operator activates you. **The two payout routes that price and send money are not**: paying money out is a second decision, off by default both globally and per merchant, and approval does not imply it. See [Payouts](./payouts#payouts-are-off-by-default).

The two that only **read** payouts — `GET /v1/payouts` and `GET /v1/payouts/{id}` — need nothing but a signed request, because reading what you have already sent is not paying out. A wallet with no payouts gets an empty page or a `404`, not a refusal.

## How it fits together

1. Your **wallet address is your API credential.** There are no API keys to leak or rotate. You prove you own the address by signing each request. See [Authentication](./authentication).
2. You **register** a merchant. It starts as `pending`. See [Merchants](./merchants).
3. A Kakitu operator **approves** it. This is a person, not an automated step, and it is required. See [Going live](./going-live).
4. Once approved you create **charges**. See [Collections](./collections).

Alongside collections there is a second surface for an approved merchant: [transfers](./transfers) (send KSHS and we pay the gas), [quotes](./quotes), [orders](./orders), [balances](./balances), [limits](./limits) and your webhook [events](./events).

Money going the other way — out to somebody's M-Pesa — is [payouts](./payouts), which needs its own operator decision on top of approval.

## Base URL

```
https://walletapi.kakitu.org
```

All paths in these docs are relative to it. All bodies are JSON. All errors share one shape, described in [Errors](./errors).

## A note on the old documentation

An earlier version of this site described a Nano RPC proxy, raw-unit amounts and a Safaricom Daraja integration. None of that was ever accurate for the product in production, and it was withdrawn. If you built against it, none of it carries over. Everything here is checked against the running server's code.

## Help

Write to **kakitu@kakitu.org**. When you report a problem, include the `request_id` from the error body. It is the only thing that lets us find your request in the logs.
