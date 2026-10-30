---
sidebar_position: 2
title: Quickstart
---

# Quickstart

A wallet for your business that can take KSHS today, and a merchant registration for the API, in about ten minutes.

## 1. Make a wallet for the business

:::tip There is a page that does this for you
If you would rather not run code yet, **[register in your browser](/signup)**. It generates the
wallet on your machine, shows you its 12-word recovery phrase, signs the registration and submits
it. Nothing leaves your browser except the signed registration, and you still have to write the
phrase down before you close the tab.
:::

You need a wallet whose address is your credential **and** the address you are paid at. Generate it as a **12-word recovery phrase** (BIP-39), the same kind the Kakitu app makes. The phrase is what lets you open this wallet in the app later and [cash out](./cash-out) to M-Pesa; a bare private key cannot be imported there.

```ts title="newwallet.mjs"
// node newwallet.mjs - Node 18+, `npm install ethers@6`
import { Wallet } from "ethers";

// 12 words, BIP-39, derived at m/44'/60'/0'/0/0 - the same path the Kakitu app uses,
// so this phrase opens the same address in the app.
const wallet = Wallet.createRandom();
console.log("address        ", wallet.address);          // you are paid here; register this
console.log("recovery phrase", wallet.mnemonic.phrase);  // write it down; import it to cash out
console.log("private key    ", wallet.privateKey);       // the same key, for KAKITU_PRIVATE_KEY
```

Run it **once**. Then:

- **Write the 12 words on paper** and keep them somewhere safe. They are the whole wallet: anyone who has them can spend everything at that address, and if you lose them and the key, the money is gone. We cannot recover either.
- **Put the private key in your secret store** for the server that will sign API calls. It is the same wallet in the form the signing code reads.

**Generate a wallet for the business and use it for nothing else.** Not the wallet you already spend from, and not the 12-word phrase behind your personal Kakitu app. That phrase opens your entire personal balance. This key is going to sit on a server.

### Why a separate wallet

- **A key on a server is not a secret you keep.** Your deploy tooling reads it, your CI reads it, your backups contain it, and anyone with production access can get at it. That is a fair risk for a float holding today's takings. It is not a fair risk for everything a person owns.
- **The address is a pot of money, not only a login.** Payments land in it. A separate wallet keeps the business's money apart from the owner's, which is what a business wants anyway.
- **It bounds the damage.** If this key leaks, what is at risk is what it has received since you last cashed out — not your whole balance.

Move takings out on whatever schedule suits you: [cash out](./cash-out) to M-Pesa from the app, or send KSHS on to another wallet. There is no sweep endpoint and nothing we do for you here.

None of this is enforced. The server verifies a signature and nothing more. It cannot tell one key from another and it will not stop you using the wrong one.

So pick the wallet you mean to keep. **There is no key rotation**: the address *is* the merchant, so changing keys means registering the new address as a new merchant and being approved again.

Keep the key out of source code. Put it in an environment variable or a secret store, never in a file you commit:

```bash
export KAKITU_PRIVATE_KEY=0x...   # yours; never paste it into code or a ticket
```

## 2. Take a payment

You can be paid at that address now, before you register anything:

- **On a website**, call `window.kakitu.pay({ to: "<your address>", amountKes: "1250" })` from a **Pay with Kakitu** button. See [the extension](./extension#pay-pay).
- **On a phone or at a counter**, show a `kakitu:` link or its QR code. See [Pay with Kakitu on a phone](./extension#pay-with-kakitu-on-a-phone).

**Then verify it on chain, every time.** Nothing notifies you of an incoming payment, and nothing on the payer's screen is proof. Check Base for a `Transfer` of KSHS to your address, for the amount you priced, in a mined block, matched to one order. [The extension page](./extension#pay-pay) has the rule; `GET https://walletapi.kakitu.org/config` has the contract address.

## 3. Copy the signer and check who you are

The rest of this page registers you for the [developer API](./intro#the-developer-api). The [Authentication](./authentication) page has a complete, runnable signer in TypeScript, Python and PHP. Each reads `KAKITU_PRIVATE_KEY`. The examples below use TypeScript.

```bash
npm install ethers@6
# save the TypeScript program from the Authentication page as kakitu.mjs
node kakitu.mjs
```

Run on its own, `kakitu.mjs` makes one call, `GET /v1/merchants/me`, and changes nothing. A wallet that has never registered gets:

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

Save this beside `kakitu.mjs`. It reads your real trading name and email from the environment, so nothing about your business is written into the file:

```ts title="register.mjs"
// node register.mjs - uses call() from kakitu.mjs
import { Wallet } from "ethers";
import { call } from "./kakitu.mjs";

const { KAKITU_PRIVATE_KEY, KAKITU_BUSINESS_NAME, KAKITU_CONTACT_EMAIL, KAKITU_CALLBACK_URL } = process.env;
if (!KAKITU_PRIVATE_KEY || !KAKITU_BUSINESS_NAME || !KAKITU_CONTACT_EMAIL) {
  throw new Error("Set KAKITU_PRIVATE_KEY, KAKITU_BUSINESS_NAME and KAKITU_CONTACT_EMAIL");
}

const body = { business_name: KAKITU_BUSINESS_NAME, contact_email: KAKITU_CONTACT_EMAIL };
if (KAKITU_CALLBACK_URL) body.callback_url = KAKITU_CALLBACK_URL;   // optional

console.log(await call(new Wallet(KAKITU_PRIVATE_KEY), "POST", "/v1/merchants", body));
```

```bash
KAKITU_BUSINESS_NAME="Your Trading Name Ltd" \
KAKITU_CONTACT_EMAIL="you@yourbusiness.co.ke" \
node register.mjs
```

```json
HTTP 201
{
  "address": "0x…",
  "business_name": "Your Trading Name Ltd",
  "contact_email": "you@yourbusiness.co.ke",
  "contact_phone": "",
  "callback_url": "",
  "state": "pending",
  "daily_cap_kes": 0,
  "per_charge_max_kes": 0
}
```

Registration is instant, and it only ever creates a `pending` merchant. You cannot set `state`, limits or a webhook secret from the request. Running it again updates your record (`200`). See [Merchants](./merchants) for every field and rule.

:::warning Choose business_name carefully
The business name is what an operator vets, so it is frozen once you have been reviewed. It is
passed to our payment partner as the account-holder name on an M-Pesa collection, so a payer
**may** see it in their PIN prompt; what the prompt shows is the partner's decision, not ours. Use
the name your customers know you by. See [Merchants](./merchants#business_name-is-frozen).
:::

## 5. Ask for approval

Write to kakitu@kakitu.org with your registered address. [Going live](./going-live) explains the checklist and why a person is in the loop.

## What approval gets you today

- [Transfers](./transfers): send KSHS from the signing wallet and let us pay the gas.
- Everything else on the API was already open to you: [quotes](./quotes), [orders](./orders), [balances](./balances), [limits](./limits) and your webhook [events](./events).

**M-Pesa collections (`POST /v1/charges`) and payouts are not open yet**, for anyone. Until they are, `POST /v1/charges` answers `503 rail_unavailable` and rings nobody, and payouts answer `403`. Accept KSHS as in step 2, and [cash out](./cash-out) from the app.
