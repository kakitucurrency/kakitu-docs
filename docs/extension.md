---
sidebar_position: 16
title: Login and pay with the Kakitu extension
---

# Login and pay with the Kakitu extension

The Kakitu Wallet Chrome extension lets a website **sign a customer in** with their Kakitu address
and **take a KSHS payment** from them, with no API key in your front end. The relayer pays the
Base gas, so your customer needs KSHS and nothing else.

:::note Installing the extension
The extension is on the [Chrome Web Store](https://chromewebstore.google.com/detail/ebcjlgfjbbgoldipdhbcmciebdiadifg)
(extension id `ebcjlgfjbbgoldipdhbcmciebdiadifg`). It is Chrome only, and most of your customers
will still not have it, so always offer the [phone flow](#pay-with-kakitu-on-a-phone) beside a
**Lipa na Kakitu** button, and build for `getKakituWallet()` resolving `null`.
:::

## Which version your customers have {#which-version}

**The Chrome Web Store has version 0.2.4 today. Version 0.2.8 is being submitted to the store.**
Chrome updates an installed extension by itself, but not on the day a version is published, so
for a while your customers will have either. Build for both: the [Lipa na Kakitu
button](#lipa-na-kakitu-button) already does.

| Behaviour | 0.2.4 (the store today) | 0.2.8 and later |
|---|---|---|
| `pay()` from a site that is not connected | Rejects with `NOT_CONNECTED`: call `connect()`, then `pay()` again | Shows the connect sheet, then the payment sheet |
| `reference` on `pay()` | Shown to the customer and echoed back, but **not sent with the payment**: it never reaches `GET /transfers` or `transfer.received`. Not checked, so spaces are accepted | Sent with the payment. Anything outside `A-Z a-z 0-9 . _ : -` or longer than 64 is refused with `INVALID_PARAMS` |
| A second request while one is waiting | Rejects with `INVALID_PARAMS` | Rejects with `ALREADY_PENDING` |
| Too many payment requests from sites that are not connected | No such limit | Rejects with `RATE_LIMITED` |
| The recipient line on the payment sheet | "Not a Kakitu merchant…" for every site | The [verified-merchant badge](#the-verified-merchant-badge) |

The extension does not tell your page its own version number. (`kakitu.version` is the version of
the page-facing API, `1.1.0` in both.) Branch on the rejection you get, not on a version.

This page is the website side. Nothing here uses the signed `/v1` API: a business can accept
extension payments before, or without, becoming a [verified merchant](./merchants). Becoming one
will put the verified badge on your shoppers' payment sheet, once it is switched on ([what
they see today](#the-verified-merchant-badge)).

| You want to | You call | Internal request |
|---|---|---|
| Know who this visitor is | `kakitu.connect()` | `CONNECT` |
| Log them in, cryptographically | `kakitu.signIn()` | `SIGN_IN` |
| Take their money | `kakitu.pay()`; `connect()` first on 0.2.4, not needed from 0.2.8 ([versions](#which-version)) | `PAY` |
| Decide what to render, without a prompt | `kakitu.getState()` | `GET_STATE` |

The internal names appear in the extension's own logs and error reports.

Beside the four methods the provider has:

- `kakitu.version`: the page-facing API version, `"1.1.0"`. Not the extension's version.
- `kakitu.chainId`: `8453`.
- `kakitu.on(event, listener)`, which returns a function that unsubscribes, and
  `kakitu.off(event, listener)`. The events are `accountsChanged`, `locked`, `unlocked` and
  `disconnected`.

`getState()` resolves to:

```ts
{
  status: 'no_wallet' | 'locked' | 'unlocked';
  chainId: 8453;
  connected: boolean;          // whether YOUR origin has been granted access
  address: string | null;      // null unless your origin is connected AND the wallet is unlocked
  balanceKes: null;            // always null for a page: you do not see a customer's balance
  maxPerTxKes: string | null;  // the per-transfer ceiling from GET /config, null if not fetched yet
  locksAt: number | null;      // epoch ms of the next auto-lock, null when locked or no wallet
  connections: [];             // always empty for a page
}
```

## Detecting the extension

**The extension does not inject `window.ethereum`, and it does not answer on
`eip6963:announceProvider`.** It holds one token on one chain and has no `eth_sendTransaction` or
`eth_signTypedData`, so wagmi, ethers and viem will not find it. That is deliberate: a library
listening on the EIP-6963 channel would immediately call `eth_requestAccounts` on it.

What it does instead is the **EIP-6963 mechanism on its own channel**:

- It installs a read-only global, `window.kakitu`, at `document_start`, with `isKakitu === true`.
- It dispatches `kakitu:announceProvider` on load, and again every time the page dispatches
  `kakitu:requestProvider`.
- The event's `detail` is `{ info, provider }`, where `info` has the EIP-6963 shape:

| `info` field | Value |
|---|---|
| `uuid` | `7b9d2f4c-3a1e-4c8b-9f52-6e0a4d8c1b73` (fixed, so de-duplication works) |
| `name` | `Kakitu Wallet` |
| `rdns` | `org.kakitu.wallet` |
| `icon` | An inline SVG `data:` URI you can put straight into an `<img src>` |

If you already have EIP-6963 discovery code, change only the event names:

```js
// Resolves to the provider, or to null if no Kakitu extension announces itself.
function getKakituWallet({ timeoutMs = 1500 } = {}) {
  if (window.kakitu?.isKakitu) return Promise.resolve(window.kakitu);

  return new Promise((resolve) => {
    const onAnnounce = (event) => {
      if (event.detail?.info?.rdns !== 'org.kakitu.wallet') return;
      window.removeEventListener('kakitu:announceProvider', onAnnounce);
      clearTimeout(timer);
      resolve(event.detail.provider);
    };
    const timer = setTimeout(() => {
      window.removeEventListener('kakitu:announceProvider', onAnnounce);
      resolve(null);
    }, timeoutMs);

    window.addEventListener('kakitu:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('kakitu:requestProvider'));   // for a page that attached late
  });
}
```

The wallet runs in **top-level `https://` documents only**. No iframe can reach it, not even a
same-origin one, and an `http://` page is refused. (A copy of the extension loaded unpacked for
development also accepts `http://localhost`; the store version never does.) A desktop browser
without the extension resolves `null`: offer the [phone flow](#pay-with-kakitu-on-a-phone) instead.

## CONNECT: `connect()`

```ts
await kakitu.connect({ appName?: string })
// resolves to
{
  address: string;       // 0x…, EIP-55 checksummed
  chainId: 8453;         // Base mainnet, always
  connectedAt: string;   // ISO-8601 UTC, when this origin was first granted access
}
```

- The first call from your origin raises an approval screen. Later calls resolve without one, so
  it is safe to call on page load to restore a session.
- On a locked wallet, a site that is **already connected** gets `LOCKED` at once: the customer has
  to open the extension themselves. A site that is not connected yet gets the approval window,
  which asks the customer to unlock first.
- `appName` (at most 64 characters, one line) is shown **under** your verified origin, never
  instead of it. The customer is asked to trust `shop.example`, not the name you typed.

## SIGN_IN: `signIn()`

```ts
await kakitu.signIn({
  nonce: string;            // REQUIRED. 8 to 64 letters and digits, from YOUR server, single use
  statement?: string;       // one line, at most 200 characters, shown verbatim
  expirationTime?: string;  // RFC 3339 (any offset), at most 64 characters
  notBefore?: string;       // RFC 3339 (any offset), at most 64 characters
  requestId?: string;       // your own correlation id, at most 128 characters
  resources?: string[];     // at most 8 absolute https URIs
})
// resolves to
{
  address: string;          // EIP-55 checksummed
  message: string;          // the EXACT text that was signed: verify against this
  signature: string;        // 65-byte EIP-191 personal_sign signature, 0x-prefixed
  domain: string;
  uri: string;
  chainId: 8453;
  nonce: string;
  issuedAt: string;
}
```

**You cannot supply the message text.** The extension composes `domain`, `uri`, `address`,
`chainId` and `issuedAt` itself from the origin the browser verified; your page contributes the
nonce, one line of statement and the optional fields.

### The message the extension signs

It is [EIP-4361 (Sign-In with Ethereum)](https://eips.ethereum.org/EIPS/eip-4361), byte for byte,
lines joined with `\n`. For a page at `https://shop.example`:

```text
shop.example wants you to sign in with your Ethereum account:
0x9858EfFD232B4033E47d90003D41EC34EcaEda94

Sign in to Duka Online to complete your order.

URI: https://shop.example
Version: 1
Chain ID: 8453
Nonce: k3F9x2LmQ7
Issued At: 2026-10-31T09:00:00.000Z
Expiration Time: 2026-10-31T09:05:00.000Z
```

- `domain` is your page's host, and `URI:` is your page's origin.
- Without a statement there are **two** blank lines between the address and `URI:`, as the
  EIP-4361 grammar requires.
- `Expiration Time`, `Not Before`, `Request ID` and a `Resources:` list (one `- uri` per line)
  appear only when you passed them, in that order.

### Verifying a sign-in on your server

A resolved `signIn()` is something the customer's browser told you. **Verify it on your server.**
Recover the signer, then check every field against values *you* chose, never against values read
out of the message itself:

```js
// verify-signin.mjs - Node 18+, `npm install viem`
import { verifyMessage, getAddress } from 'viem';

const MY_DOMAIN = 'shop.example';
const MY_ORIGIN = 'https://shop.example';

// `nonces` is your own single-use store: take() returns true once, then deletes the nonce.
export async function verifyKakituSignIn({ address, message, signature }, nonces) {
  // 1. The signature: an EIP-191 personal_sign over the exact message text.
  const ok = await verifyMessage({ address: getAddress(address), message, signature });
  if (!ok) throw new Error('bad signature');

  // 2. The fields, read from the signed text and pinned to OUR values.
  const lines = message.split('\n');
  const field = (name) => lines.find((l) => l.startsWith(`${name}: `))?.slice(name.length + 2);

  if (lines[0] !== `${MY_DOMAIN} wants you to sign in with your Ethereum account:`) throw new Error('wrong domain');
  if (getAddress(lines[1]) !== getAddress(address)) throw new Error('address mismatch');
  if (field('URI') !== MY_ORIGIN) throw new Error('wrong uri');
  if (field('Version') !== '1') throw new Error('wrong version');
  if (field('Chain ID') !== '8453') throw new Error('wrong chain');

  const exp = field('Expiration Time');
  if (exp && Date.parse(exp) <= Date.now()) throw new Error('expired');
  const nbf = field('Not Before');
  if (nbf && Date.parse(nbf) > Date.now()) throw new Error('not yet valid');

  // 3. The nonce LAST, so a bad request cannot burn a good nonce. Single use.
  if (!(await nonces.take(field('Nonce')))) throw new Error('unknown or reused nonce');

  return getAddress(address);   // your session's user id
}
```

With ethers instead of viem, step 1 is
`ethers.verifyMessage(message, signature) === ethers.getAddress(address)`. The `siwe` npm package
also verifies these messages unchanged. There is no Kakitu endpoint that verifies a sign-in for
you: it is a standard signature and you check it like any other.

## PAY: `pay()` {#pay-pay}

**From extension 0.2.8, `pay()` needs no `connect()` first.** If your site is not connected yet,
the extension shows its connect sheet and then, if the customer approves, the payment sheet for
the same call, the way MetaMask does. Your site is connected from then on, and the result is the
same object as below. If the customer declines the connect, `pay()` rejects with `USER_REJECTED`
and nothing is signed. A site that is not connected may make at most 3 such payment requests a
minute, and all sites that are not connected together at most 10 (`RATE_LIMITED`). One request
per site, and one per browser tab, waits at a time (`ALREADY_PENDING`), and at most 8 wait in
all.

**On 0.2.4, the version on the store today**, `pay()` from a site that is not connected rejects
with `NOT_CONNECTED`: call `connect()`, then `pay()` again. The [Lipa na Kakitu
button](#lipa-na-kakitu-button) does that for you. See [which version](#which-version).

```ts
await kakitu.pay({
  to: string;          // REQUIRED. your 0x address
  amountKes: string;   // REQUIRED. a STRING of shillings: "1250" or "1250.50", at most 2 places
  reference?: string;  // your order reference: 1 to 64 of A-Z a-z 0-9 . _ : -, shown, sent with the payment and echoed back
  memo?: string;       // one line for the customer, at most 140 characters, not on chain
  chargeId?: string;   // opaque, carried for your reconciliation only
})
// resolves to
{
  txHash: string;
  from: string;
  to: string;
  amountKes: string;
  valueWei: string;    // KSHS has 18 decimals
  reference?: string;
  submittedAt: string; // when the RELAY accepted it, not when it was mined
  confirmed: boolean;
}
```

- `amountKes` is a string, always. A number throws immediately. The field is `amountKes`, not
  `amountKshs`.
- `confirmed: false` is **not** a failure. The relayer submitted the transfer and no receipt came
  back in its window. Treat it as "watch the chain", never as "failed" and never as "paid".
- Every promise settles only when the customer acts. An approval nobody answers rejects with
  `TIMEOUT` after three minutes. One approval per site at a time.

**From 0.2.8, the `reference` travels with the payment.** It is sent to the relay beside the signed
transfer (it is not itself signed), and it reaches you on the transfer row ([`GET /transfers`](./transfers#get-transfers))
and in the [`transfer.received`](./events#transferreceived) webhook. A reference with spaces or emoji (anything outside
those characters, or longer than 64) is refused by `pay()` with `INVALID_PARAMS` before the customer sees
anything, so a bad order number cannot cost them an approval.

**On 0.2.4, the version on the store today, the reference is shown and echoed back but never sent.**
A payment from 0.2.4 reaches you with no reference at all, so match it by amount and time (a
per-order amount makes that unambiguous) rather than waiting for a reference that will not come.
Sanitise references on your page either way.

**A reference is the payer's claim, not proof.** Anybody can pay your address with any reference.
Use it to find the order, then check the amount and the recipient against that order.

### A resolved `pay()` is not proof of payment {#not-proof}

If you are an approved merchant, wait for
`transfer.received`; either way, confirm on Base from your server: a `Transfer` log on the KSHS
contract (`kshs_contract` in `GET https://walletapi.kakitu.org/config`), to your address, for at
least the amount *your server* priced, in a mined block, matched to exactly one order.

## Lipa na Kakitu button {#lipa-na-kakitu-button}

A ready-made **Lipa na Kakitu** button for any web page. Paste it in, put your own address in
`data-to`, and set `data-amount` and `data-reference` for each order. A shopper with the Kakitu
extension clicks it and the payment sheet opens. A shopper without it sees **Install Kakitu to
pay**, and a click goes to the Chrome Web Store.

```html
<!-- Lipa na Kakitu. Set data-amount (shillings, e.g. "1250" or "1250.50") and data-reference (your order number) for each order. -->
<button type="button" class="lipa-na-kakitu" data-to="0xYOUR_KAKITU_ADDRESS" data-amount="100" data-reference="ORDER-1">Lipa na Kakitu</button>
<a class="lipa-na-kakitu-install" href="https://chromewebstore.google.com/detail/kakitu-wallet/ebcjlgfjbbgoldipdhbcmciebdiadifg" target="_blank" rel="noopener" hidden>Install Kakitu to pay</a>
<script>
(function () {
  var STORE = 'https://chromewebstore.google.com/detail/kakitu-wallet/ebcjlgfjbbgoldipdhbcmciebdiadifg';
  function findKakitu(ms) {
    if (window.kakitu && window.kakitu.isKakitu) return Promise.resolve(window.kakitu);
    return new Promise(function (resolve) {
      var done = false;
      function finish(p) { if (done) return; done = true; window.removeEventListener('kakitu:announceProvider', onAnnounce); resolve(p); }
      function onAnnounce(e) { if (e.detail && e.detail.info && e.detail.info.rdns === 'org.kakitu.wallet') finish(e.detail.provider); }
      window.addEventListener('kakitu:announceProvider', onAnnounce);
      window.dispatchEvent(new Event('kakitu:requestProvider'));
      setTimeout(function () { finish(null); }, ms);
    });
  }
  function pay(kakitu, params) {
    return kakitu.pay(params).catch(function (e) {
      // Kakitu extensions before 0.2.7 ask the site to connect first.
      if (e && e.reason === 'NOT_CONNECTED') return kakitu.connect({}).then(function () { return kakitu.pay(params); });
      throw e;
    });
  }
  var buttons = document.querySelectorAll('button.lipa-na-kakitu');
  findKakitu(1500).then(function (kakitu) {
    if (!kakitu) document.querySelectorAll('a.lipa-na-kakitu-install').forEach(function (a) { a.hidden = false; });
  });
  buttons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      findKakitu(1500).then(function (kakitu) {
        if (!kakitu) { window.location.href = STORE; return; }
        var params = { to: btn.dataset.to, amountKes: String(btn.dataset.amount) };
        if (btn.dataset.reference) params.reference = btn.dataset.reference;
        btn.disabled = true;
        pay(kakitu, params).then(function (result) {
          btn.disabled = false;
          btn.dispatchEvent(new CustomEvent('kakitu:paid', { bubbles: true, detail: result }));
        }, function (e) {
          var reason = e && e.reason;
          if (reason !== 'UNCONFIRMED') btn.disabled = false;
          btn.dispatchEvent(new CustomEvent('kakitu:payfailed', { bubbles: true, detail: { reason: reason, message: e && e.message, txHash: e && e.data && e.data.txHash } }));
        });
      });
    });
  });
})();
</script>
```

- `data-amount` is shillings, as a string (`"1250"` or `"1250.50"`); `data-reference` is your
  order number, within the [`reference` rules](#pay-pay).
- It makes no network call of its own and loads no third-party script. It calls `pay()` directly.
  On 0.2.4, the version on the store today, which answers `NOT_CONNECTED`, it calls `connect()` once and
  tries again, so the button works on every published version.
- On `UNCONFIRMED` the button **stays disabled**: the money may have moved, and re-enabling it
  invites a second payment. Every other outcome re-enables it.

The result comes back as a DOM event from the button. Listen on the button or any parent:

| Event | `detail` | When |
|---|---|---|
| `kakitu:paid` | The `pay()` result: `txHash`, `confirmed`, `reference` and the rest | The relay accepted the transfer. |
| `kakitu:payfailed` | `{ reason, message, txHash }`; `txHash` only for `UNCONFIRMED` | The customer said no, or it did not go through. `reason` is one of the [error reasons](#errors). |

```js
document.addEventListener('kakitu:paid', (e) => {
  // Not proof of payment. Tell your server the order may be paid, and let it check.
  fetch('/orders/check', { method: 'POST', body: JSON.stringify({ txHash: e.detail.txHash }) });
});
```

**A `kakitu:paid` event is not proof of payment; confirm on your server.** It is something the
shopper's browser told you. See [A resolved `pay()` is not proof](#not-proof).

**If your site sets a `Content-Security-Policy` that forbids inline scripts**, move the body of
the `<script>` into a file you host yourself and load it with `<script src="/lipa-na-kakitu.js"></script>`.
Nothing else changes.

### The verified-merchant badge

**Not shown yet.** The badge needs two things: Kakitu extension 0.2.8 or later, and the server's
public lookup, `GET /merchants/verified/{address}`, which is **not live yet** (it answers `404`
today). [Apply at kakitu.org/merchant](https://kakitu.org/merchant) so your shoppers see it once
both are in place.

What the payment sheet shows about the recipient, by version:

| Extension | What the shopper sees, for any address, approved merchant or not |
|---|---|
| 0.2.4 (the store today) | A grey line: "Not a Kakitu merchant. Most sites are not — it only means Kakitu has not checked this one, so trust it the way you would any other site." It never looks anything up. |
| 0.2.8, while the lookup is not live | A warning: "Kakitu could not check this recipient right now — only pay if you trust this site." |
| 0.2.8, once the lookup is live | For an approved merchant's address: **Verified Kakitu merchant** and the business name, with a line saying Kakitu has not checked that the site belongs to that business. For any other address: "Not a verified Kakitu merchant — only pay if you trust this site." |

The badge is about the address being paid, never about the site.

Once it is live, the lookup is public:

```http
GET /merchants/verified/{address}
Host: walletapi.kakitu.org
```

No signature: anybody may ask.

```json
{ "verified": true, "business_name": "Mama Njeri Groceries" }
```

or `{"verified": false}`, which is the same answer, byte for byte, for an address that never
applied and for one that is pending, rejected or suspended. A malformed address is
`400 invalid_address`; `503 unavailable` means the lookup could not be made, and is never a no.
Answers are cached for 60 seconds, and the route allows 60 requests a minute per IP. Until it is
live it answers `404`, which the extension treats as "could not check", never as a no.

## Errors

Every rejection carries `code` (the EIP-1193 number) and `reason` (the Kakitu code). Branch on
`reason`; `code` is lossy on purpose.

| `reason` | `code` | Meaning | What to do |
|---|---|---|---|
| `USER_REJECTED` | 4001 | The customer said no. | Nothing. Not an error. |
| `LOCKED` | 4100 | The wallet is locked. | Ask them to open the extension. |
| `NO_WALLET` | 4100 | No wallet on this browser yet. | Point them at onboarding. |
| `NOT_CONNECTED` | 4100 | Your origin has no access, or it was revoked. Sign-in, and `pay()` on 0.2.4. | Call `connect()`. |
| `FORBIDDEN` | 4100 | Refused, including for flooding the wallet. | Slow down. |
| `INVALID_PARAMS` | -32602 | Your arguments. On 0.2.4, also a second request while one is waiting. | `message` names the field. |
| `ALREADY_PENDING` | -32002 | A request from your site or tab is already waiting for the customer. From 0.2.8. | Wait for it. |
| `RATE_LIMITED` | -32005 | More than 3 payment requests a minute from a site that is not connected, or 10 from all of them. From 0.2.8. | Wait a minute. |
| `LIMIT_EXCEEDED` | -32005 | Over the per-transaction or daily cap. | `data.limitKes` is the cap. |
| `INSUFFICIENT_FUNDS` | -32005 | Not enough KSHS. | Offer a top-up. |
| `RELAY_UNAVAILABLE` | -32005 | The relayer cannot pay gas right now. | Nothing moved. Retry shortly. |
| `WOULD_REVERT` | -32005 | The chain refused it before any gas was spent. | Nothing moved. |
| `UNCONFIRMED` | -32005 | Submitted; outcome unknown. | **The money may have moved, check before retrying.** `data.txHash` is real: look it up on Base. Retrying blindly is how a customer pays twice. |
| `TIMEOUT` | -32603 | Nobody answered the approval. | `data.waitedMs`. Offer to try again. |
| `NETWORK` | -32603 | Kakitu's API or the Base RPC was unreachable. | Retry. |
| `INTERNAL` | -32603 | A bug, or the extension reloaded mid-flow. | Ask them to reload the page. |

## Pay with Kakitu on a phone

**Mobile browsers cannot run Chrome extensions**, so `window.kakitu` never exists on a phone. On
mobile, show a `kakitu:` payment link (and the same text as a QR code on a desktop checkout). The
link opens the Kakitu app, which registers the `kakitu` URL scheme. The app is on Google Play;
it is **not on the App Store yet**, so an iPhone customer cannot install it today.

The format the app parses:

```text
kakitu:<address>?amount=<wei>
```

| Part | Rule |
|---|---|
| `kakitu:` | The scheme. The app also accepts `ethereum:<address>?value=<wei>`. |
| `<address>` | Your `0x` address, 40 hex digits. All-lowercase is accepted; a mixed-case address must be a valid EIP-55 checksum or the link is ignored. |
| `amount` | **Wei, not shillings.** 1 KSHS = 10^18 wei, so append eighteen zeros to the shilling amount. |
| Whole shillings only | An `amount` that is not a whole number of shillings (for example 1.5 KSHS) is dropped, and the customer is asked to type the amount. At least 1 KSHS. |

Example: KSHS 1,250 to `0x9858EfFD232B4033E47d90003D41EC34EcaEda94` (an example address: use your
own):

```text
kakitu:0x9858EfFD232B4033E47d90003D41EC34EcaEda94?amount=1250000000000000000000
```

```html
<a href="kakitu:0x9858EfFD232B4033E47d90003D41EC34EcaEda94?amount=1250000000000000000000">
  Pay KSHS 1,250 with Kakitu
</a>
```

```js
// Build it from whole shillings; BigInt keeps all 18 zeros exact.
const link = (address, shillings) => `kakitu:${address}?amount=${BigInt(shillings) * 10n ** 18n}`;
```

What the customer sees: the app opens Send with your address and the amount filled in (straight
to the confirm screen when their balance covers it), and they approve with their PIN.

**QR codes.** Encode the same `kakitu:` string, unchanged, in the QR. The app's scanner reads it.
Use medium or higher error correction and leave a quiet zone around it; the whole link is under
90 characters, so any QR library's automatic sizing produces a small code.

**A reference.** Add `&ref=<reference>` (1 to 64 of `A-Z a-z 0-9 . _ : -`) and a Kakitu app that
reads it sends it with the payment, so it reaches you in `transfer.received` as with `pay()`. An
app that does not read `ref` ignores it and still pays, and then there is no reference on the
transfer: match it the way you would without one. There is no memo field.

```text
kakitu:0x9858EfFD232B4033E47d90003D41EC34EcaEda94?amount=1250000000000000000000&ref=ORD-1042
```

As with `pay()`, **a reference is the payer's claim, not proof**: check the amount and the
recipient against the order, and match each order to one transfer (a per-order amount, or a fresh
receiving address per order, makes the match unambiguous). If the app is not installed, the link
does nothing, so show a store link beside it (`store_url_android` in `GET /config`;
`store_url_ios` is empty until the app is on the App Store).
