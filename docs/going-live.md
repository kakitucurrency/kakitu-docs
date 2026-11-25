---
sidebar_position: 16
title: Going live
---

# Going live

There is one environment: `https://walletapi.kakitu.org`. There is no separate sandbox for the developer API yet. Applying is safe, because a `pending` merchant can do nothing that costs money.

## What is live, and what is not {#what-is-live}

| | Status today |
|---|---|
| Being paid in KSHS at your address (`pay()`, the Lipa na Kakitu button, `kakitu:` links, QR) | **Live.** Needs no registration. See [the quickstart](./quickstart#2-take-a-payment). |
| Applying at [kakitu.org/merchant](https://kakitu.org/merchant), and the payments dashboard once approved | **Live.** |
| The signed developer API: reading, [transfers](./transfers) and [`transfer.received`](./events#transferreceived) webhooks once approved | **Live on the server**, but server-side signing for wallets made in the Kakitu app is **coming soon**: there is no safe way yet to put their key on a server. See [the quickstart](./quickstart#server-side-signing). |
| Cash at a Kakitu agent | **Live.** |
| [Cash-out](./cash-out) to your own M-Pesa number, in the Kakitu app or the extension | **Not available.** `mpesa_rails_visible` is `false` in [`GET /config`](./config): M-Pesa is hidden, and its routes answer `409 mpesa_hidden` even when cash-out is switched on. `kes_offramp_enabled` is `true` only once both are on. |
| The verified-merchant badge in the extension's payment sheet | **Not shown yet.** It needs Kakitu extension 0.2.8 or later and the server's verified-merchant lookup, which is not live. [What the extension shows today](./extension#the-verified-merchant-badge). |
| M-Pesa top-ups | **Not available.** Hidden with the rest of M-Pesa (`409 mpesa_hidden`); `kes_onramp_enabled` in [`GET /config`](./config) is `true` once they are on. |
| [`POST /v1/charges`](./collections) | **Not available.** Coming back as a KSHS payment request. Take a transfer with a `reference` today. |
| [`POST /v1/payouts`](./payouts), the other payout-sending routes and saving a payout destination | **Not available.** Coming back, paid through KCB. |
| [`POST /v1/quotes`](./quotes) | Not available today. |

## Why a person approves you

**A transfer spends gas we pay for, and a verified badge will tell shoppers they can trust you.** If anyone could get either, the API would be a way to drain our relayer and the badge would mean nothing. So every merchant is reviewed by a person at Kakitu. This is manual, deliberately.

## The path

1. **Make the business wallet in the Kakitu app** and write down its 12 words. Use a wallet made for the business, not your personal one ([why](./quickstart#why-a-separate-wallet)).
2. **Add the Kakitu extension to Chrome** and restore the same wallet there with the 12 words.
3. **Apply at [kakitu.org/merchant](https://kakitu.org/merchant).** This is the only way to become a merchant; no API route makes one. Sign in with the extension (signing in cannot move money), then give your business name, the kind of business, where it is, and a contact phone. Use your real trading name: it is what Kakitu vets, it is what shoppers will see on the badge, and it is frozen after review.
4. **Approval.** A person at Kakitu reviews the application and sets your state to `approved`. The page shows your state whenever you sign in; a rejection comes with the reason, and you can fix the application and send it again.
5. **Use it.** The dashboard at kakitu.org/merchant opens: payments in, totals for today, the last 7 and the last 30 days, and a CSV export.
6. **For the API**, wait for server-side signing ([coming soon](./quickstart#server-side-signing)). Never type your 12 words into a script or tool to get a key. When it opens, you confirm with `GET /v1/merchants/me` that `state` is `approved` and set your `callback_url` with [`POST /v1/merchants`](./merchants#post-v1merchants). Your **webhook secret** is made at approval and shown once, to the Kakitu person who approves you; no page or route shows it to you. Write to kakitu@kakitu.org to receive it, and store it in a secret manager at once. If it was not kept, or you lose it, Kakitu issues a new one.

## Checklist before you take real payments

- [ ] The wallet you applied with was made for this business in the Kakitu app, not your personal wallet ([why](./quickstart#why-a-separate-wallet)).
- [ ] The 12-word recovery phrase is written down and stored offline, and it has been typed into nothing but the Kakitu app and the Kakitu extension. It is both your credential and where your money lands. Losing it loses both.
- [ ] If you use the API once server-side signing opens: the key is in a secret manager or environment variable, not in code, not in git.
- [ ] You know how you will take the money out: at a Kakitu agent today. M-Pesa [cash-out](./cash-out) is not available today.
- [ ] You verify every payment on chain, and never accept a screenshot.
- [ ] Your `callback_url` is https, public, and punycode if non-ASCII.
- [ ] You give every order its own `reference`, and match each payment to exactly one order.
- [ ] You generate a fresh `Idempotency-Key` per transfer and reuse it only to retry that transfer.
- [ ] You branch on `code`, never on `message`.
- [ ] You log the `request_id` from every error.
- [ ] Your server clock is correct (NTP). Signatures fail beyond 120 seconds of skew.

## If your key is compromised

There is no key rotation, and this is the part to plan for before it happens rather than
after. The address **is** the merchant: there is no way to attach a new key to an existing
merchant, and no way for us to disable the old one on your behalf.

What to do, in this order:

1. **Move the money first.** Anything sitting at that address can be spent by whoever holds
   the key. Send it to a wallet you control, straight away.
2. **Tell us.** Write to kakitu@kakitu.org and ask for the merchant to be **suspended**. A
   suspended merchant gets no transfer through the API, no verified badge and no dashboard,
   so an attacker holding your key cannot move money or be shown as your business. (Reading
   its own record and events still works.)
3. **Apply again** with a new wallet made in the Kakitu app, and be approved again. It is a new
   merchant: new webhook secret, and your integration must use the new address.

Payments already received are on chain, at an address somebody else now has the key to, and
nothing about that is reversible.

Rotate on your own terms too — before an employee with production access leaves, for instance.
The steps are the same minus the hurry.

## Changes that need Kakitu

- Renaming the business.
- Raising limits.
- Getting a new webhook secret.
- Reinstating a suspended merchant. (A rejected one fixes its application at kakitu.org/merchant and sends it again.)

Write to kakitu@kakitu.org and quote your address.
