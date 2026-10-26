---
sidebar_position: 1
slug: /intro
title: Introduction
---

# Kakitu developer API

Kakitu is a Kenyan-shilling stablecoin. **KSHS is an ERC-20 token on Base, backed one to one by USDC held in reserve, and 1 KSHS is 1 KES.** Wallets are self-custody: the key is generated on the device and never reaches us. Reserve backing is public at [`https://walletapi.kakitu.org/reserves`](https://walletapi.kakitu.org/reserves).

The developer API lets a business **collect** money by M-Pesa and be credited in KSHS directly to its own wallet. The payer gets an M-Pesa PIN prompt, pays, and the shilling amount arrives as KSHS at the address you registered. We never hold it for you.

:::danger Nothing here is live yet — last checked 26 Oct 2026
This page is the status board, and it is honest about the one thing that matters: **no `/v1`
endpoint answers in production today.** Every path below returns `404` on
`walletapi.kakitu.org` right now. They are documented from the code as it is written, so that
you can read the contract and tell us it is wrong before it is frozen — not so that you can
call them.

| Feature | Status |
|---|---|
| Sign requests with a wallet key | Contract final. The scheme is not changing. |
| `POST /v1/merchants`, `GET /v1/merchants/me` | Built, not deployed. |
| `POST /v1/charges`, `GET /v1/charges/{id}`, collections | Built, not deployed. |
| `POST /v1/transfers`, the gasless transfer | Built, not deployed. |
| `GET /v1/balances`, `/v1/orders/{id}`, `/v1/limits`, `/v1/quotes` | Built, not deployed. |
| Webhook delivery | In progress. |
| Payouts (paying money OUT) | In progress. Default-off per merchant when it ships. |
| Operator approval of a merchant | A person, not an endpoint. Required before collections work. |

They ship together, not one at a time. This banner comes down the day they answer, and not
before.
:::

## How it fits together

1. Your **wallet address is your API credential.** There are no API keys to leak or rotate. You prove you own the address by signing each request. See [Authentication](./authentication).
2. You **register** a merchant. It starts as `pending`. See [Merchants](./merchants).
3. A Kakitu operator **approves** it. This is a person, not an automated step, and it is required. See [Going live](./going-live).
4. Once approved you create **charges**. See [Collections](./collections).

## Base URL

```
https://walletapi.kakitu.org
```

All paths in these docs are relative to it. All bodies are JSON. All errors share one shape, described in [Errors](./errors).

## A note on the old documentation

An earlier version of this site described a Nano RPC proxy, raw-unit amounts and a Safaricom Daraja integration. None of that was ever accurate for the product in production, and it was withdrawn. If you built against it, none of it carries over. Everything here is checked against the running server's code.

## Help

Write to **kakitu@kakitu.org**. When you report a problem, include the `request_id` from the error body. It is the only thing that lets us find your request in the logs.
