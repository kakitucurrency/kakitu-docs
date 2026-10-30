---
sidebar_position: 16
title: Going live
---

# Going live

There is one environment: `https://walletapi.kakitu.org`. There is no separate sandbox for the developer API yet. Registering a merchant is safe, because a `pending` merchant can do nothing that costs money.

## What is live, and what is not

| | Status today |
|---|---|
| Being paid in KSHS at your address (`pay()`, `kakitu:` links, QR) | **Live.** Needs no registration. See [the quickstart](./quickstart#2-take-a-payment). |
| [Cashing out](./cash-out) to M-Pesa from the Kakitu app | **Live**, within the [limits](./pricing). |
| Registering, reading, [transfers](./transfers) once approved | **Live.** |
| M-Pesa collections (`POST /v1/charges`) | **Not open.** Answers `503 rail_unavailable`; nobody is prompted. |
| Payouts (`POST /v1/payouts/quote`, `POST /v1/payouts`) | **Not open.** Off for every merchant. |

Approval does not change the last two rows. We will say here, and write to approved merchants, when they open.

## Why a person approves you

**A collection rings a stranger's handset with a real M-Pesa PIN prompt, and a transfer spends gas we pay for.** If anyone could start those, the API would be a way to phish people and drain our relayer. So every merchant is reviewed by a Kakitu operator before either works. This is manual, deliberately.

## The path

1. **Register** with `POST /v1/merchants`. Use your real trading name; it is frozen after review, and it is passed to our payment partner as the account-holder name on a collection, so a payer may see it in their M-Pesa prompt.
2. **Write to kakitu@kakitu.org** with your wallet address and what you sell. Expect questions.
3. **Approval.** An operator sets your state to `approved`, sets your limits, and issues your **webhook secret**. The secret is shown **once**. Store it in a secret manager at once; it cannot be retrieved later.
4. **Confirm** with `GET /v1/merchants/me` that `state` is `approved`.
5. **Use it.** [Transfers](./transfers) work at once. [Charges](./collections) will work when collections open.

Paying money **out** through the API is a separate request and a separate decision: approval does not switch payouts on, and they are not open for anyone yet. See [Payouts](./payouts#payouts-are-off-by-default). To get your own takings out today, [cash out](./cash-out) from the app.

## Checklist before you take real payments

- [ ] The wallet you registered was generated for this business, not your personal wallet ([why](./quickstart#why-a-separate-wallet)).
- [ ] Your private key is in a secret manager or environment variable, not in code, not in git.
- [ ] The 12-word recovery phrase is written down and stored offline. It is both your credential and where your money lands. Losing it loses both.
- [ ] You have imported the phrase into the Kakitu app and [cashed out](./cash-out) a small amount, so you know the way out works before you need it.
- [ ] You verify every payment on chain, and never accept a screenshot.
- [ ] Your `callback_url` is https, public, and punycode if non-ASCII.
- [ ] You generate a fresh `Idempotency-Key` per logical charge and reuse it only to retry that charge.
- [ ] You generate a unique `reference` per charge and a new one after a refused charge.
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
2. **Tell us.** Contact your Kakitu operator and ask for the merchant to be **suspended**. A
   suspended merchant is refused everywhere — no new charge, no payout, no transfer — so an
   attacker holding your key cannot create collections in your name.
3. **Register again** with a key generated fresh, and be approved again. It is a new merchant
   row: new webhook secret, and your integration must send the new address.

Charges already settled are settled. They are on chain, at an address somebody else now has
the key to, and nothing about that is reversible.

Rotate on your own terms too — before an employee with production access leaves, for instance.
The steps are the same minus the hurry.

## Changes that need an operator

- Renaming the business.
- Raising limits.
- Switching payouts on, and setting the payout caps. These are separate from your collection caps.
- Getting a new webhook secret.
- Reinstating a suspended or rejected merchant.

Write to kakitu@kakitu.org and quote your address.
