---
sidebar_position: 1
---

# Kakitu Developer Documentation

:::danger These docs have been withdrawn

Everything that used to be published here described an **earlier version of
Kakitu built on Nano**. It is no longer accurate in any part — not the
endpoints, not the units, not the authentication, not the payment rails.

Rather than leave it up, we have taken it down. Working from it would have cost
you real time and, if you got far enough, real money.

:::

## What was wrong

The previous documentation described:

- a **Nano RPC proxy** at `POST /api`, taking an `action` in the request body
- amounts in **raw units at 10<sup>30</sup>**
- M-Pesa cash-in and cash-out through **Safaricom Daraja**

None of those exist. Kakitu has never held a Daraja integration, and the Nano
node was replaced well before this site was last updated.

## What Kakitu actually is today

**KSHS is an ERC-20 token on Base**, backed one-to-one by USDC held in reserve.
One KSHS is one Kenyan shilling. Wallets are **self-custody** — the key is
generated on the device and never leaves it. Cash in and cash out run through
licensed partner rails rather than a direct mobile-money integration.

Reserve backing is public and live at
[`https://walletapi.kakitu.org/reserves`](https://walletapi.kakitu.org/reserves).

## What is coming

We are building a proper developer API, with collections first — so a business
can charge a customer by M-Pesa and be credited directly into its own wallet.
Alongside it: signed webhooks, idempotency on everything that moves money, a
documented error set, and SDKs so you never have to hand-roll request signing.

## In the meantime

If you are building on Kakitu now, write to **kakitu@kakitu.org** and we will
work with you directly rather than point you at a page. We would rather have
that conversation than publish something else you cannot rely on.
