---
sidebar_position: 2
title: Quickstart
---

# Quickstart

A business wallet that takes KSHS today, an application to become a verified merchant, and, if you want it, the developer API, in about ten minutes.

## 1. Set up the business wallet

**The business wallet is made in the Kakitu app, never on a website and never by these docs.** Then:

1. **Create the business wallet in the Kakitu app** ([Android](https://play.google.com/store/apps/details?id=com.kakitu.app)) and **write down its 12 words** on paper. They are the whole wallet: anyone who has them can spend everything at that address, and if you lose them the money is gone. We cannot recover them.
2. **Add the Kakitu extension to Chrome** from the [Chrome Web Store](https://chromewebstore.google.com/detail/kakitu-wallet/ebcjlgfjbbgoldipdhbcmciebdiadifg) and choose **Restore**, using the same 12 words. The extension shows the same address as the app.
3. **Go to [kakitu.org/merchant](https://kakitu.org/merchant), sign in with the extension and apply.** Signing in cannot move money. Kakitu reviews the application; the page tells you when you are approved, and opens your payments dashboard. See [Merchants](./merchants).

Kakitu will never ask for your 12 words on a website, in an email or in a ticket.

**Make a wallet for the business and use it for nothing else.** Not the wallet you already spend from, and not the 12 words behind your personal Kakitu app. Those words open your entire personal balance, and if you use the API, this wallet's key is going to sit on a server.

### Why a separate wallet

- **A key on a server is not a secret you keep.** Your deploy tooling reads it, your CI reads it, your backups contain it, and anyone with production access can get at it. That is a fair risk for a float holding today's takings. It is not a fair risk for everything a person owns.
- **The address is a pot of money, not only a login.** Payments land in it. A separate wallet keeps the business's money apart from the owner's, which is what a business wants anyway.
- **It bounds the damage.** If this key leaks, what is at risk is what it has received since you last cashed out — not your whole balance.

Move takings out on whatever schedule suits you: at a Kakitu agent, by [cash-out](./cash-out) to your own M-Pesa number once it is on, or by sending KSHS on to another wallet. There is no sweep endpoint and nothing we do for you here.

None of this is enforced. The server verifies a signature and nothing more. It cannot tell one key from another and it will not stop you using the wrong one.

So pick the wallet you mean to keep. **There is no key rotation**: the address *is* the merchant, so changing keys means applying with a new wallet and being approved again.

## 2. Take a payment

You can be paid at that address now, before you apply for anything:

- **On a website**, paste the [Lipa na Kakitu button](./extension#lipa-na-kakitu-button), or call `window.kakitu.pay({ to: "<your address>", amountKes: "1250", reference: "ORDER-1" })` yourself. See [the extension](./extension#pay-pay).
- **On a phone or at a counter**, show a `kakitu:` link or its QR code. See [Pay with Kakitu on a phone](./extension#pay-with-kakitu-on-a-phone).

**Then check every payment, every time.** Once you are approved, your dashboard at kakitu.org/merchant lists each payment with its reference, and, if you use the API and set a `callback_url`, a payment to your address reaches it as a signed [`transfer.received`](./events#transferreceived) webhook. Before approval you are not notified. Either way, nothing on the payer's screen is proof, and a reference is the payer's claim, not proof: check Base for a `Transfer` of KSHS to your address, for the amount you priced, in a mined block, matched to one order. [The extension page](./extension#pay-pay) has the rule; `GET https://walletapi.kakitu.org/config` has the contract address.

## 3. Copy the signer and check who you are

The rest of this page is for the [developer API](./intro#the-developer-api). Skip it if the dashboard is all you need.

**Your server signs with the business wallet's key.** The Kakitu app and the extension do not export a bare key, so derive it from the 12 words, once, on the machine that will keep it, and put it straight into your secret store. The app and the extension use the standard path (BIP-39, `m/44'/60'/0'/0/0`), so the same words give the same address:

```ts title="derive-key.mjs"
// node derive-key.mjs - Node 18+, `npm install ethers@6`. Run it once, offline, on the server.
// It DERIVES the key of the wallet you made in the Kakitu app. It does not make a wallet.
import { Wallet } from "ethers";
import { createInterface } from "node:readline/promises";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const words = await rl.question("12 words (they are not stored or sent anywhere): ");
rl.close();
const wallet = Wallet.fromPhrase(words.trim());
console.log("address", wallet.address);     // must be the address the app and kakitu.org/merchant show
console.log("key    ", wallet.privateKey);  // put this in your secret store, then clear the terminal
```

Check that the address is the one the app shows. Keep the key out of source code: an environment variable or a secret store, never a file you commit:

```bash
export KAKITU_PRIVATE_KEY=0x...   # yours; never paste it into code or a ticket
```

The [Authentication](./authentication) page has a complete, runnable signer in TypeScript, Python and PHP. Each reads `KAKITU_PRIVATE_KEY`. The examples below use TypeScript.

```bash
npm install ethers@6
# save the TypeScript program from the Authentication page as kakitu.mjs
node kakitu.mjs
```

Run on its own, `kakitu.mjs` makes one call, `GET /v1/merchants/me`, and changes nothing. Once you have applied at kakitu.org/merchant it returns your merchant record, and `state` says where your application is (`pending`, then `approved`). A wallet that has not applied gets:

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

That still means your signature verified: apply at [kakitu.org/merchant](https://kakitu.org/merchant) with the same wallet. A `401` means your signature did not verify; go to the troubleshooting list on the Authentication page.

## 4. Set your contact email and callback URL

The application at kakitu.org/merchant gives Kakitu your business name, where you are and a contact phone. For the API you also want a contact email and, to receive webhooks, a `callback_url`. Set them with a signed `POST /v1/merchants`. **Send `business_name` exactly as you applied with it**: once Kakitu has reviewed you the name is frozen, and a different one is refused with `409 merchant_name_frozen`.

Save this beside `kakitu.mjs`. It reads your details from the environment, so nothing about your business is written into the file:

```ts title="contact.mjs"
// node contact.mjs - uses call() from kakitu.mjs
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
KAKITU_CALLBACK_URL="https://shop.example.com/kakitu/webhooks" \
node contact.mjs
```

The answer is your merchant record, `200`. You cannot set `state`, limits or a webhook secret from the request. See [Merchants](./merchants) for every field and rule.

**Webhooks need two things from Kakitu's side as well**: an approved merchant, and the webhook secret Kakitu gives you once, at approval. See [Webhooks](./webhooks).

## What approval gets you today

- **The verified badge.** Shoppers paying you from the Kakitu extension see **Verified Kakitu merchant** and your business name (from extension 0.2.7, rolling out).
- **The dashboard** at kakitu.org/merchant: payments in, with their references; totals for today, 7 and 30 days; a CSV export.
- [`transfer.received`](./events#transferreceived) webhooks for payments to your address, once you have set a `callback_url`.
- [Transfers](./transfers): send KSHS from the signing wallet and let us pay the gas.
- Everything else on the API was already open to you: [balances](./balances), [limits](./limits), [`GET /transfers`](./transfers#get-transfers) and your webhook [events](./events).

[Collections](./collections) (as KSHS payment requests) and [payouts](./payouts) (rebuilt on KCB) are coming soon. To take your own money out, see [Cash out](./cash-out).
