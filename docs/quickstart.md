---
sidebar_position: 2
title: Quickstart
---

# Quickstart

This is what registering will look like, end to end, in about ten minutes. **You cannot run it yet** — no `/v1` endpoint is deployed (see [the status board](./intro)). Read it to check the shape against your own integration; when the endpoints go up, this page works unchanged.

## 1. Get a wallet key

You need an Ethereum-style secp256k1 private key. The address that key controls is your credential **and** the address your collections will be paid to, so use a key you control and keep safe. Do not use a throwaway.

Keep the key out of source code. Put it in an environment variable or a secret store, never in a file you commit:

```bash
export KAKITU_PRIVATE_KEY=0x...   # yours; never paste it into code or a ticket
```

## 2. Pick a language and copy the signer

The [Authentication](./authentication) page has a complete, runnable client in TypeScript, Python and PHP. Each reads `KAKITU_PRIVATE_KEY`, signs, and calls the API. The examples below use TypeScript.

```bash
npm install ethers@6
# save the script from the Authentication page as kakitu.mjs
```

## 3. Check who you are

```bash
node kakitu.mjs
```

The first call is `GET /v1/merchants/me`. A wallet that has never registered gets:

```json
HTTP 404
{
  "error": {
    "code": "merchant_not_registered",
    "message": "This wallet is not registered as a merchant. POST /v1/merchants to register.",
    "request_id": "…"
  }
}
```

That is a good result. It means your signature verified and the server knows you are not registered yet. A `401` means your signature did not verify; go to the troubleshooting list on the Authentication page.

## 4. Register

```http
POST /v1/merchants
Content-Type: application/json

{
  "business_name": "Mama Njeri Groceries",
  "contact_email": "njeri@example.com",
  "callback_url": "https://shop.example.com/kakitu/webhook"
}
```

```json
HTTP 201
{
  "address": "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
  "business_name": "Mama Njeri Groceries",
  "contact_email": "njeri@example.com",
  "contact_phone": "",
  "callback_url": "https://shop.example.com/kakitu/webhook",
  "state": "pending",
  "daily_cap_kes": 0,
  "per_charge_max_kes": 0
}
```

Registration is instant, and it only ever creates a `pending` merchant. You cannot set `state`, limits or a webhook secret from the request. See [Merchants](./merchants) for every field and rule.

:::warning Choose business_name carefully
The business name is what a payer reads in their M-Pesa prompt, so it is frozen once an operator has reviewed you. See [Merchants](./merchants#business_name-is-frozen).
:::

## 5. Ask for approval

Write to kakitu@kakitu.org with your registered address. Until an operator approves you, collections will not work. [Going live](./going-live) explains the checklist and why a person is in the loop.

## Where you cannot go yet

`POST /v1/charges` is not available. When it ships, [Collections](./collections) will say so and this quickstart will gain a step 6.
