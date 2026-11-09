---
sidebar_position: 3
title: Cash out
---

# Cash out

**A business takes its money out the same way a person does: from the Kakitu app, to M-Pesa.** The [payouts API](./payouts) can do the same from a server (to a phone, a till, a paybill or a bank account), but it is off until an operator switches it on for your merchant, and it is meant for paying other people, under caps.

The whole path is: open your business wallet in the app with its recovery phrase, then **Withdraw to M-Pesa**.

## 1. Open the business wallet in the app

You need the wallet's **12-word recovery phrase**. If you made the wallet with the [quickstart](./quickstart#1-make-a-wallet-for-the-business) or the [browser sign-up](/signup), you wrote it down then. The app derives the same address from it (BIP-39, path `m/44'/60'/0'/0/0`), so after importing you see the same balance your server sees.

1. Install the Kakitu app ([Android](https://play.google.com/store/apps/details?id=com.kakitu.app); the store links are also `store_url_android` and `store_url_ios` in [`GET /config`](https://walletapi.kakitu.org/config)).
2. On the welcome screen choose **Import Wallet**, and type the 12 words.
3. Check that the address the app shows is the one you registered.

**The app holds one wallet per phone.** If your personal Kakitu wallet is on your phone, do not import the business phrase over it without its own phrase written down. A phone kept for the business is simpler.

A bare private key (a `0x…` hex string) cannot be imported into the app. If that is all you have, the only way out is to send the KSHS on chain to a wallet that does have a phrase — a [transfer](./transfers) if you are approved, or any wallet software that can send an ERC-20 on Base, which needs a little ETH on Base for gas.

## 2. A profile, once

The first time you send money out, the app asks for a **phone number, first name and last name**. The cash-out partner needs a name and number on every order; without them the server answers `profile_required` and nothing is priced. It is asked once per wallet.

The number must be a Kenyan mobile number. If it is already the number of another Kakitu wallet that can be found by its number — your personal one, say — saving is refused (`phone_in_use`). Make the other wallet not discoverable by number first, or use a different number.

From a server, the same profile is `POST /profile`, signed with the same three headers as every `/v1` call:

```http
POST /profile
Content-Type: application/json

{ "phone": "254712345678", "first_name": "Wanjiru", "last_name": "Kamau" }
```

`phone` must match `^254[17]\d{8}$`. Each name is at most 64 **bytes** after trimming, which is fewer than 64 characters if you use accents. This is the app's own route, not part of `/v1`: a refusal uses the older shape, `{"error": "invalid_request"}` or `{"error": "phone_in_use"}` with `409`.

## 3. Withdraw to M-Pesa

In the app: **Withdraw to M-Pesa**, then the amount and where it goes.

| Destination | What you enter |
|---|---|
| An M-Pesa number | The number. It does not have to be the profile's. |
| A till (Buy Goods) | The till number, 5 to 9 digits. |

Cashing out from the app to a **paybill or a bank account is closed** for now, for every wallet; the server refuses it. A merchant can pay a paybill or bank through the [payouts API](./payouts#saved-destinations-and-the-lock) once payouts are on for it.

You type the shillings that must **land**. The app quotes the KSHS it will take from your wallet, the fee, and counts down how long the price holds — a few minutes; after that, ask for a new price. Nothing leaves until you approve with your PIN.

### How much at a time

Between **KES 20 and KES 33,333 per withdrawal** landed, on 9 November 2026. That band comes from our cash-out partner and is published live as `withdraw_min_per_order_kes` and `withdraw_max_per_order_kes` in [`GET /config`](https://walletapi.kakitu.org/config); read it rather than hard-coding it. A larger sum is several withdrawals. A large amount may ask you to verify your identity first.

**The treasury can be the tighter limit.** `cashout_capacity_kes` in the same `/config` is the most KSHS one cash-out may send right now that our hot treasury can back (KSHS 9,045 when this was written). A withdrawal over it is refused at the quote, `treasury_short`, before anything is signed or taken; try a smaller amount or later.

Each withdrawal is also one gasless transfer from your wallet, so it counts against the **50 relayed transfers a day** each address gets. See [Pricing, limits and settlement](./pricing).

### What it costs

The quote shows the fee before you confirm, and that number is the one to trust. It is made of two parts:

- **Ours:** the burn spread, a fraction of a percent (30 basis points by default).
- **The cash-out partner's charge** for paying out to M-Pesa, which varies with the amount and is larger in proportion on small amounts.

On a typical amount, expect a few percent in all. We would rather you saw it on the confirm screen than trusted an estimate here. The same price is available to a program as a withdrawal quote from [`POST /v1/quotes`](./quotes), which returns `send_kes`, `receive_kes` and `fee_kes`.

### How long it takes

**Not instant.** Usually a few minutes. Your KSHS moves to our treasury first; then we fund the partner and the partner pays M-Pesa, which is a job that runs after you have confirmed, not during the request. The app shows the order as on its way until M-Pesa confirms.

It can take longer. The treasury is checked at the quote and again when you confirm, so a shortfall normally refuses the withdrawal before anything moves. If it runs short in the moment between your confirm and the payout, the order **waits** until an operator refills it: your shillings are held in the treasury, not lost, and the order is either completed or the shillings are returned. If a withdrawal is still going through after an hour, write to kakitu@kakitu.org with the reference the app shows. **Do not send it again** while it is still going through.

## USDC instead of M-Pesa

The Kakitu **browser extension** can also cash out to **USDC on Base**, to an address you name ("Cash out to USDC"). The treasury's balance is checked before your shillings are taken, so a short treasury refuses the order rather than holding it. A Base address is final and nothing can reverse a payment to the wrong one; double-check it. The phone app does not offer this. The extension is on the [Chrome Web Store](https://chromewebstore.google.com/detail/ebcjlgfjbbgoldipdhbcmciebdiadifg); see [the extension page](./extension).

## The payouts API

[`POST /v1/payouts/quote`](./payouts) and `POST /v1/payouts` are **off for a merchant until an operator switches them on**, and answer `403 payouts_disabled` until then. When they are on, they pay **other people's** M-Pesa number, till, paybill or bank account from your wallet, under an operator's caps; a payout above your hold threshold [needs a person to approve it first](./payouts#approve-first). You can also [save the places you cash out to and lock yourself to them](./payouts#saved-destinations-and-the-lock). That lock controls where cash-outs go; it does not stop KSHS transfers to other wallets.

A payout ends `paid` or `failed` and you are told by webhook ([`payout.paid`](./events#payoutpaid-and-payoutfailed), `payout.failed`). Until payouts are on for you, cash out from the app as above.
