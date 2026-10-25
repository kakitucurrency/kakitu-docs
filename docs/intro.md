---
sidebar_position: 1
slug: /intro
title: Introduction
---

# Kakitu developer API

Kakitu is a Kenyan-shilling stablecoin. **KSHS is an ERC-20 token on Base, backed one to one by USDC held in reserve, and 1 KSHS is 1 KES.** Wallets are self-custody: the key is generated on the device and never reaches us. Reserve backing is public at [`https://walletapi.kakitu.org/reserves`](https://walletapi.kakitu.org/reserves).

The developer API lets a business **collect** money by M-Pesa and be credited in KSHS directly to its own wallet. The payer gets an M-Pesa PIN prompt, pays, and the shilling amount arrives as KSHS at the address you registered. We never hold it for you.

:::caution What works today, and what does not
This page is the status board. Read it before you plan anything.

| Feature | Status |
|---|---|
| Sign requests with a wallet key | Live |
| `POST /v1/merchants`, register a merchant | Live |
| `GET /v1/merchants/me`, read your merchant | Live |
| `POST /v1/charges`, `GET /v1/charges/{id}`, collections | **Not yet available.** Documented from the code as it is being written. |
| Webhook delivery | **Not yet available.** |
| Operator approval of a merchant | Live, manual. Required before collections work. |
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
