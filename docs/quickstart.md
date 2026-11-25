---
sidebar_position: 2
title: Quickstart
---

# Quickstart

A business wallet that takes KSHS today and an application to become a verified merchant, in about ten minutes. Nothing on this page needs a server.

## 1. Set up the business wallet

**The business wallet is made in the Kakitu app, never on a website and never by these docs.** Then:

1. **Create the business wallet in the Kakitu app** ([Android](https://play.google.com/store/apps/details?id=com.kakitu.app)) and **write down its 12 words** on paper. They are the whole wallet: anyone who has them can spend everything at that address, and if you lose them the money is gone. We cannot recover them.
2. **Add the Kakitu extension to Chrome** from the [Chrome Web Store](https://chromewebstore.google.com/detail/kakitu-wallet/ebcjlgfjbbgoldipdhbcmciebdiadifg) and choose **Restore**, in the extension's own window. The extension shows the same address as the app.
3. **Go to [kakitu.org/merchant](https://kakitu.org/merchant), sign in with the extension and apply.** Signing in cannot move money. Kakitu reviews the application; the page tells you when you are approved, and opens your payments dashboard. See [Merchants](./merchants).

**Your 12 words go into the Kakitu app and the Kakitu extension, and nowhere else.** Not into a website, a script, a terminal, a support ticket or an email. Kakitu will never ask for them, and nothing in these docs ever needs them.

**Make a wallet for the business and use it for nothing else.** Not the wallet you already spend from, and not the 12 words behind your personal Kakitu app. Those words open your entire personal balance.

### Why a separate wallet

- **The address is a pot of money, not only a login.** Payments land in it. A separate wallet keeps the business's money apart from the owner's, which is what a business wants anyway.
- **It bounds the damage.** If anything about this wallet goes wrong, what is at risk is what it has received since you last cashed out — not your whole balance.

Move takings out on whatever schedule suits you: at a Kakitu agent, or by sending KSHS on to another wallet. There is no sweep endpoint and nothing we do for you here. M-Pesa [cash-out](./cash-out) is not available today.

So pick the wallet you mean to keep. **There is no key rotation**: the address *is* the merchant, so changing wallets means applying with a new wallet and being approved again.

## 2. Take a payment

You can be paid at that address now, before you apply for anything:

- **On a website**, paste the [Lipa na Kakitu button](./extension#lipa-na-kakitu-button), or call `window.kakitu.pay({ to: "<your address>", amountKes: "1250", reference: "ORDER-1" })` yourself. See [the extension](./extension#pay-pay).
- **On a phone or at a counter**, show a `kakitu:` link or its QR code. See [Pay with Kakitu on a phone](./extension#pay-with-kakitu-on-a-phone).

**Then check every payment, every time.** Once you are approved, your dashboard at kakitu.org/merchant lists each payment with its reference. Before approval, check your wallet's history in the Kakitu app or the extension. Either way, nothing on the payer's screen is proof, and a reference is the payer's claim, not proof: check Base for a `Transfer` of KSHS to your address, for the amount you priced, in a mined block, matched to one order. [The extension page](./extension#pay-pay) has the rule; `GET https://walletapi.kakitu.org/config` has the contract address.

A `pay()` from Kakitu extension 0.2.4, the version on the Chrome Web Store today, arrives **without** its `reference`: the extension sends it with the payment from 0.2.8. See [the extension page](./extension#which-version).

## 3. The developer API: server-side signing is coming soon {#server-side-signing}

The [developer API](./intro#the-developer-api) has no API keys. **Every request is signed with the merchant wallet's own key**, because the address is the merchant. So a server that calls the API has to hold that wallet's private key.

**Today there is no safe way to put the key of a wallet made in the Kakitu app on a server.** The Kakitu app and the extension do not export a private key, and Kakitu publishes no tool that does. Do not type your 12 words into a script, a website or any other tool to work one out: anything that has read your 12 words can spend everything at that address, for ever.

**Server-side signing for merchant wallets is coming soon.** Until then, an approved merchant uses:

- **The dashboard at [kakitu.org/merchant](https://kakitu.org/merchant)**: every payment in, with its reference; totals for today, the last 7 and the last 30 days; a CSV export. It is read-only, and signing in to it cannot move money.
- **The chain itself**: your server can read the KSHS `Transfer` logs to your address from Base with no key at all (`kshs_contract` and `public_rpc_url` in [`GET /config`](./config)).

What the API needs, when signing opens, is documented on the reference pages ([Authentication](./authentication), [Merchants](./merchants), [Transfers](./transfers), [Webhooks](./webhooks)). Their examples read a key from `KAKITU_PRIVATE_KEY`; none of them reads, asks for or derives anything from a recovery phrase.

**Webhooks wait for this too.** A [`transfer.received`](./events#transferreceived) webhook goes to your `callback_url`, and the only way to set a `callback_url`, and to receive your webhook secret, is a signed [`POST /v1/merchants`](./merchants#post-v1merchants). The application at kakitu.org/merchant has no callback field.

## What approval gets you today

- **The dashboard** at kakitu.org/merchant: payments in, with their references; totals for today, 7 and 30 days; a CSV export.
- **The verified badge.** Shoppers paying you from Kakitu extension versions 0.2.7 and later see **Verified Kakitu merchant** and your business name. The store's 0.2.4 does not show it: see [the verified-merchant badge](./extension#the-verified-merchant-badge).

[Collections](./collections) (as KSHS payment requests), [payouts](./payouts) (rebuilt on KCB) and server-side signing are coming soon. To take your own money out today, use a Kakitu agent; see [Cash out](./cash-out).
