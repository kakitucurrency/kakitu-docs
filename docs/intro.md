---
sidebar_position: 1
slug: /intro
title: Introduction
---

# Kakitu developer API

Kakitu is a Kenyan-shilling stablecoin. **KSHS is an ERC-20 token on Base, backed one to one by USDC held in reserve, and 1 KSHS is 1 KES.** Wallets are self-custody: the key is generated on the device and never reaches us. Reserve backing is public at [`https://walletapi.kakitu.org/reserves`](https://walletapi.kakitu.org/reserves).

## Accepting KSHS today

**A business gets paid on Kakitu with a plain KSHS transfer to its own wallet address.** The payer sends KSHS from their wallet to yours, and it is yours the moment the block is mined. We never hold it for you. Being paid needs no registration and no API call.

| Where you sell | What you show the payer | Documented at |
|---|---|---|
| A website, on desktop | A **Lipa na Kakitu** button that calls `window.kakitu.pay()` in the Kakitu browser extension | [The extension](./extension#lipa-na-kakitu-button) |
| A website, on a phone | A `kakitu:` payment link, which opens the Kakitu app with your address and the amount filled in | [Pay with Kakitu on a phone](./extension#pay-with-kakitu-on-a-phone) |
| A shop counter | A QR code of your address. In the Kakitu app, **Receive → Lipa na Kakitu** makes a printable card | [QR codes](./extension#pay-with-kakitu-on-a-phone) |

**Become a verified merchant to be told and to be trusted.** Make your business wallet in the Kakitu app, add it to the Kakitu Chrome extension, sign in at [kakitu.org/merchant](https://kakitu.org/merchant) and apply. That is the only way to become a merchant. Once Kakitu approves you:

- your dashboard at kakitu.org/merchant lists every payment in, with its reference, and exports a CSV;
- shoppers paying you from Kakitu extension versions 0.2.7 and later see **Verified Kakitu merchant** and your business name (the store's 0.2.4 does not; [by version](./extension#the-verified-merchant-badge));
- a payment to your address can reach your server as a signed [`transfer.received`](./events#transferreceived) webhook, with the payer's order `reference` if one was sent. Setting the callback URL needs a signed API request, and server-side signing is [coming soon](./quickstart#server-side-signing).

See [Merchants](./merchants) for the steps.

**A reference is the payer's claim, not proof.** Anybody can pay your address with any reference. A screenshot of a payer's phone is not a payment either. Check that there is a `Transfer` log on the KSHS contract (`kshs_contract` in [`GET /config`](https://walletapi.kakitu.org/config)) to your address, for the amount you priced, in a mined block, and match it to exactly one order. [The extension page](./extension#pay-pay) has the rule in full.

:::info How money gets in and out
Take payment as KSHS: a transfer to your address, with an optional `reference` ([Transfers](./transfers), the extension's [`pay()`](./extension#pay-pay)). Buy or sell KSHS for cash at a Kakitu agent. **M-Pesa is not available today**: `mpesa_rails_visible` is `false` in [`GET /config`](./config), and while it is, M-Pesa cash-out and top-up are refused with `409 mpesa_hidden` even when they are switched on. See [Cash out](./cash-out).
:::

The [quickstart](./quickstart) sets a business up in about ten minutes.

## The developer API

The developer API lets a business's server sign requests with its own wallet key. It is in private release: a Kakitu person approves each merchant. See [Going live](./going-live).

**Server-side signing is coming soon.** Every route is signed with the merchant wallet's own key, and there is no safe way yet to put the key of a wallet made in the Kakitu app on a server. See [the quickstart](./quickstart#server-side-signing).

| Endpoint | Status | Documented at |
|---|---|---|
| Sign requests with a wallet key | Final | [Authentication](./authentication) |
| `POST /v1/merchants` | A merchant updates its contact details and callback URL. It does not make a merchant | [Merchants](./merchants#post-v1merchants) |
| `GET /v1/merchants/me` | Open | [Merchants](./merchants) |
| `POST /v1/transfers` | Approved merchants | [Transfers](./transfers) |
| `GET /transfers` | Open: your wallet's own history, with each payment's `reference` | [Transfers](./transfers#get-transfers) |
| `GET /config` | Public, unsigned: the live contract addresses, limits and switches | [Configuration](./config) |
| `GET /v1/balances` | Open | [Balances](./balances) |
| `GET /v1/events` | Open | [Events](./events) |
| `POST /v1/events/{id}/replay` | Open | [Events](./events) |
| `GET /v1/payout-destinations`, `DELETE /v1/payout-destinations/{id}`, `POST /v1/payout-destinations/lock` | A merchant reads, removes and locks | [Payouts](./payouts#saved-destinations-and-the-lock) |
| `POST /v1/payout-destinations` | **Not available** while payouts are off (`403 payouts_disabled`) | [Payouts](./payouts#saved-destinations-and-the-lock) |
| `GET /v1/limits` | Open | [Limits](./limits) |
| `GET /v1/orders/{id}` | Open: history of past orders | [Orders](./orders) |
| `GET /v1/charges`, `GET /v1/charges/{id}` | Open: history of past charges | [Collections](./collections) |
| `GET /v1/payouts`, `GET /v1/payouts/{id}` | Open: history of past payouts | [Payouts](./payouts) |
| `POST /v1/charges` | **Not available**: coming back as a KSHS payment request | [Collections](./collections) |
| `POST /v1/payouts/quote`, `POST /v1/payouts`, `POST /v1/payouts/requests` | **Not available**: coming back, paid through KCB | [Payouts](./payouts) |
| `POST /v1/quotes` | Not available today | [Quotes](./quotes) |
| Webhook delivery | Thirteen event types; `transfer.received` is the one that matters today | [Webhooks](./webhooks) |
| Approval of a merchant | A person at Kakitu, not an endpoint | [Going live](./going-live) |

**Only the routes that move money check approval**: `POST /v1/transfers` refuses a merchant that is not `approved`. Every other route needs a signed request and nothing more. Routes scoped to a merchant (`GET /v1/merchants/me`, the charge reads and the event routes) answer `404 merchant_not_registered` until your address has a merchant record.

## How it fits together

1. Your **wallet address is your API credential.** There are no API keys to leak or rotate. You prove you own the address by signing each request. See [Authentication](./authentication).
2. You **apply** at [kakitu.org/merchant](https://kakitu.org/merchant), signed in with the Kakitu extension. Your merchant starts as `pending`. See [Merchants](./merchants).
3. A person at Kakitu **approves** it. This is not an automated step. See [Going live](./going-live).
4. Once approved, your dashboard opens. When server-side signing opens, your server can send [transfers](./transfers) with us paying the gas and receive [`transfer.received`](./events#transferreceived) webhooks.

## Base URL

```
https://walletapi.kakitu.org
```

All paths in these docs are relative to it. All bodies are JSON. All errors share one shape, described in [Errors](./errors).

## A note on the old documentation

An earlier version of this site described a Nano RPC proxy, raw-unit amounts and a Safaricom Daraja integration. None of that was ever accurate for the product in production, and it was withdrawn. If you built against it, none of it carries over. Everything here is checked against the running server's code.

## Help

Write to **kakitu@kakitu.org**. When you report a problem, include the `request_id` from the error body. It is the only thing that lets us find your request in the logs.
