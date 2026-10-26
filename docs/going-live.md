---
sidebar_position: 15
title: Going live
---

# Going live

There is one environment: `https://walletapi.kakitu.org`. There is no separate sandbox for the developer API yet. Registering a merchant is safe, because a `pending` merchant can do nothing that costs money.

## Why a person approves you

**A collection rings a stranger's handset with a real M-Pesa PIN prompt, showing your business name.** If anyone could start those, the API would be a way to phish people. So every merchant is reviewed by a Kakitu operator before collections work. This is manual, deliberately.

## The path

1. **Register** with `POST /v1/merchants`. Use the business name you want payers to see; it is frozen after review.
2. **Write to kakitu@kakitu.org** with your wallet address and what you sell. Expect questions.
3. **Approval.** An operator sets your state to `approved`, sets your limits, and issues your **webhook secret**. The secret is shown **once**. Store it in a secret manager at once; it cannot be retrieved later.
4. **Confirm** with `GET /v1/merchants/me` that `state` is `approved`.
5. **Collect.** Create charges, once [collections are available](./collections).

## Checklist before you take real payments

- [ ] Your private key is in a secret manager or environment variable, not in code, not in git.
- [ ] You keep a backup of that key. It is both your credential and where your money lands. Losing it loses both.
- [ ] Your `callback_url` is https, public, and punycode if non-ASCII.
- [ ] You generate a fresh `Idempotency-Key` per logical charge and reuse it only to retry that charge.
- [ ] You generate a unique `reference` per charge and a new one after a refused charge.
- [ ] You branch on `code`, never on `message`.
- [ ] You log the `request_id` from every error.
- [ ] Your server clock is correct (NTP). Signatures fail beyond 120 seconds of skew.

## Changes that need an operator

- Renaming the business.
- Raising limits.
- Getting a new webhook secret.
- Reinstating a suspended or rejected merchant.

Write to kakitu@kakitu.org and quote your address.
