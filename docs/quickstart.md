---
sidebar_position: 2
title: Quickstart
---

# Quickstart

Registering, end to end, in about ten minutes.

## 1. Get a wallet key

:::tip There is a page that does this for you
If you would rather not write signing code before you have registered, **[register in your
browser](/signup)**. It generates a key on your machine, signs the registration and submits it.
The key never leaves your browser, and you still have to copy it into your secret store before
you close the tab.

The rest of this page is the same thing by hand. You will need the signing code eventually
anyway — every call after registration is signed — so it is worth reading either way.
:::

You need an Ethereum-style secp256k1 private key. The address that key controls is your credential **and** the address your collections are paid to.

**Generate a key for this integration and use it for nothing else.** Not the key behind a wallet you already spend from, and not the 24-word secret phrase from the Kakitu app (Settings → Backup Secret Phrase). That phrase sits behind a PIN on a handset in your pocket and opens your entire personal balance. This key is going to sit on a server.

```ts title="newkey.mjs"
// node newkey.mjs - Node 18+, `npm install ethers@6`
import { Wallet } from "ethers";

const wallet = Wallet.createRandom();
console.log("address    ", wallet.address);    // register this; collections land here
console.log("private key", wallet.privateKey); // this is KAKITU_PRIVATE_KEY
```

Run it once, put the private key straight into your secret store, and register that address in step 4. Send nothing else to it.

### Why a separate key

- **A key on a server is not a secret you keep.** Your deploy tooling reads it, your CI reads it, your backups contain it, and anyone with production access can get at it. That is a fair risk for a float holding today's takings. It is not a fair risk for everything a person owns.
- **The address is a pot of money, not only a login.** Collections settle into it. A separate key keeps the business's money apart from the owner's, which is what a business wants anyway.
- **It bounds the damage.** If this key leaks, what is at risk is what it has collected since you last moved money out — not your whole balance.

Move collections on to your real wallet on whatever schedule suits you: nightly, weekly, after a large charge. That is an ordinary on-chain send from that wallet, or a [transfer](./transfers) once you are approved. There is no sweep endpoint and nothing we do for you here.

None of this is enforced. The server verifies a signature and nothing more. It cannot tell one key from another and it will not stop you using the wrong one.

So pick the key you mean to keep. **There is no key rotation**: the address *is* the merchant, so changing keys means registering the new address as a new merchant and being approved again. Back the key up — losing it loses both your credential and the money sitting at that address.

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

## 6. Collect

Once you are approved, `POST /v1/charges` prompts a payer for their M-Pesa PIN and the shillings land at your address as KSHS. See [Collections](./collections).

Alongside it: [transfers](./transfers) to send KSHS and let us pay the gas, [quotes](./quotes), [orders](./orders), [balances](./balances), [limits](./limits) and your webhook [events](./events).

Paying money **out** to M-Pesa is [payouts](./payouts). It is switched off by default and needs a second decision from an operator — approval alone does not enable it.
