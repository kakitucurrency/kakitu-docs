---
sidebar_position: 1
slug: /intro
title: Introduction
---

# Kakitu developer API

Kakitu is a Kenyan-shilling stablecoin. **KSHS is an ERC-20 token on Base, backed one to one by USDC held in reserve, and 1 KSHS is 1 KES.** Wallets are self-custody: the key is generated on the device and never reaches us. Reserve backing is public at [`https://walletapi.kakitu.org/reserves`](https://walletapi.kakitu.org/reserves).

## Accepting KSHS today

**The way a business gets paid on Kakitu today is a plain KSHS transfer to its own wallet address.** No registration, no approval, no API call: the payer sends KSHS from their wallet to yours, and it is yours the moment the block is mined. We never hold it for you.

| Where you sell | What you show the payer | Documented at |
|---|---|---|
| A website, on desktop | A **Pay with Kakitu** button that calls `window.kakitu.pay()` in the Kakitu browser extension | [Login and pay with the extension](./extension#pay-pay) |
| A website, on a phone | A `kakitu:` payment link, which opens the Kakitu app with your address and the amount filled in | [Pay with Kakitu on a phone](./extension#pay-with-kakitu-on-a-phone) |
| A shop counter | A QR code of your address. In the Kakitu app, **Receive → Lipa na Kakitu** makes a printable card | [QR codes](./extension#pay-with-kakitu-on-a-phone) |

**You confirm the payment yourself, on chain.** Nothing tells you that you were paid: no webhook, no push, no SMS, and no order reference travels with the transfer. A screenshot of a payer's phone is not a payment. Look for a `Transfer` log on the KSHS contract (`kshs_contract` in [`GET /config`](https://walletapi.kakitu.org/config)) to your address, for the amount you priced, in a mined block, and match it to exactly one order. [The extension page](./extension#pay-pay) has the rule in full.

**Then cash out.** Import your wallet's 12-word recovery phrase into the Kakitu app and withdraw to an M-Pesa number, till or paybill. See [Cash out](./cash-out), and [Pricing, limits and settlement](./pricing) for what it costs and how much fits in one go.

The [quickstart](./quickstart) sets up a wallet for this in ten minutes.

:::warning M-Pesa collections and payouts are not open yet
The API below can also **collect** by M-Pesa (a PIN prompt on the payer's phone, settled to you as KSHS) and **pay out** to M-Pesa. Both are switched off for every merchant today. `POST /v1/charges` answers `503 rail_unavailable` and rings nobody, and the payout routes answer `403`. Do not build a checkout that depends on either until we announce them. Registering is safe, and the request and response shapes below are final.
:::

## The developer API

The developer API is in private release. Registration is open; a Kakitu operator activates each merchant. See [Going live](./going-live).

| Endpoint | Status | Documented at |
|---|---|---|
| Sign requests with a wallet key | Final | [Authentication](./authentication) |
| `POST /v1/merchants` | Open: anyone can register | [Merchants](./merchants) |
| `GET /v1/merchants/me` | Open | [Merchants](./merchants) |
| `POST /v1/charges` | **Not open.** Answers `503 rail_unavailable` | [Collections](./collections) |
| `GET /v1/charges` | Open (empty until collections open) | [Collections](./collections) |
| `GET /v1/charges/{id}` | Open | [Collections](./collections) |
| `POST /v1/transfers` | Approved merchants | [Transfers](./transfers) |
| `POST /v1/quotes` | Open | [Quotes](./quotes) |
| `GET /v1/orders/{id}` | Open | [Orders](./orders) |
| `GET /v1/balances` | Open | [Balances](./balances) |
| `GET /v1/limits` | Open | [Limits](./limits) |
| `GET /v1/events` | Open | [Events](./events) |
| `POST /v1/events/{id}/replay` | Open | [Events](./events) |
| `POST /v1/payouts/quote` | **Not open.** Off globally and per merchant | [Payouts](./payouts) |
| `POST /v1/payouts` | **Not open.** Off globally and per merchant | [Payouts](./payouts) |
| `GET /v1/payouts` | Open: a signed request is enough | [Payouts](./payouts) |
| `GET /v1/payouts/{id}` | Open: a signed request is enough | [Payouts](./payouts) |
| Webhook delivery | For charge and payout events only | [Webhooks](./webhooks) |
| Operator approval of a merchant | A person, not an endpoint | [Going live](./going-live) |

Sixteen routes. **Only the routes that move money check approval**: `POST /v1/charges` and `POST /v1/transfers` refuse a merchant that is not `approved`, and so do the two payout routes, which also need payouts switched on. Every other route needs a signed request and nothing more. Routes scoped to a merchant (`GET /v1/merchants/me`, the charge reads and the event routes) answer `404 merchant_not_registered` until you register; quotes, orders, balances, limits and the payout reads answer any signing wallet.

Paying money **out** is a second decision on top of approval, off by default both globally and per merchant. See [Payouts](./payouts#payouts-are-off-by-default).

## How it fits together

1. Your **wallet address is your API credential.** There are no API keys to leak or rotate. You prove you own the address by signing each request. See [Authentication](./authentication).
2. You **register** a merchant. It starts as `pending`. See [Merchants](./merchants).
3. A Kakitu operator **approves** it. This is a person, not an automated step. See [Going live](./going-live).
4. Once approved you can send [transfers](./transfers) with us paying the gas, and — when they open — create [charges](./collections).

Alongside: [quotes](./quotes), [orders](./orders), [balances](./balances), [limits](./limits) and your webhook [events](./events).

## Base URL

```
https://walletapi.kakitu.org
```

All paths in these docs are relative to it. All bodies are JSON. All errors share one shape, described in [Errors](./errors).

## A note on the old documentation

An earlier version of this site described a Nano RPC proxy, raw-unit amounts and a Safaricom Daraja integration. None of that was ever accurate for the product in production, and it was withdrawn. If you built against it, none of it carries over. Everything here is checked against the running server's code.

## Help

Write to **kakitu@kakitu.org**. When you report a problem, include the `request_id` from the error body. It is the only thing that lets us find your request in the logs.
