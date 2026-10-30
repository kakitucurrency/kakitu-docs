---
sidebar_position: 16
title: Login and pay with the Kakitu extension
---

# Login and pay with the Kakitu extension

The Kakitu Wallet Chrome extension lets a website **sign a customer in** with their Kakitu address
and **take a KSHS payment** from them, with no API key in your front end. The relayer pays the
Base gas, so your customer needs KSHS and nothing else.

:::note Installing the extension
The extension is **not on the Chrome Web Store yet**; the listing is coming soon. Until it is,
most of your customers will not have it, so always offer the [phone flow](#pay-with-kakitu-on-a-phone)
beside a **Pay with Kakitu** button, and build for `getKakituWallet()` resolving `null`.
:::

This page is the website side. Nothing here uses the signed `/v1` API: a merchant can accept
extension payments before, or without, registering as a [merchant](./merchants).

| You want to | You call | Internal request |
|---|---|---|
| Know who this visitor is | `kakitu.connect()` | `CONNECT` |
| Log them in, cryptographically | `kakitu.signIn()` | `SIGN_IN` |
| Take their money | `kakitu.pay()` | `PAY` |
| Decide what to render, without a prompt | `kakitu.getState()` | `GET_STATE` |

The internal names appear in the extension's own logs and error reports; your page only ever
calls the four methods.

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

The wallet runs in **top-level `https://` documents only**. A cross-origin iframe cannot reach it,
and an `http://` page is refused. A desktop browser without the extension resolves `null`: offer
the [phone flow](#pay-with-kakitu-on-a-phone) instead.

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
- It does not unlock the wallet. A locked wallet rejects with `LOCKED`; the customer has to open
  the extension themselves.
- `appName` (at most 64 characters, one line) is shown **under** your verified origin, never
  instead of it. The customer is asked to trust `shop.example`, not the name you typed.

## SIGN_IN: `signIn()`

```ts
await kakitu.signIn({
  nonce: string;            // REQUIRED. 8 to 64 letters and digits, from YOUR server, single use
  statement?: string;       // one line, at most 200 characters, shown verbatim
  expirationTime?: string;  // ISO-8601 UTC
  notBefore?: string;       // ISO-8601 UTC
  requestId?: string;       // your own correlation id
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

## PAY: `pay()`

```ts
await kakitu.pay({
  to: string;          // REQUIRED. your 0x address
  amountKes: string;   // REQUIRED. a STRING of shillings: "1250" or "1250.50", at most 2 places
  reference?: string;  // your order reference, at most 64 characters, shown and echoed back
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

**A resolved `pay()` is not proof of payment.** Confirm on Base from your server: a `Transfer`
log on the KSHS contract (`kshs_contract` in `GET https://walletapi.kakitu.org/config`), to your
address, for at least the amount *your server* priced, in a mined block, matched to exactly one
order.

## Errors

Every rejection carries `code` (the EIP-1193 number) and `reason` (the Kakitu code). Branch on
`reason`; `code` is lossy on purpose.

| `reason` | `code` | Meaning | What to do |
|---|---|---|---|
| `USER_REJECTED` | 4001 | The customer said no. | Nothing. Not an error. |
| `LOCKED` | 4100 | The wallet is locked. | Ask them to open the extension. |
| `NO_WALLET` | 4100 | No wallet on this browser yet. | Point them at onboarding. |
| `NOT_CONNECTED` | 4100 | Your origin has no access, or it was revoked. | Call `connect()`. |
| `FORBIDDEN` | 4100 | Refused, including for flooding the wallet. | Slow down. |
| `INVALID_PARAMS` | -32602 | Your arguments. | `message` names the field. |
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
link opens the Kakitu app on Android and iOS, which registers the `kakitu` URL scheme.

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

**What the link does not carry.** There is no reference or memo field: the app reads the address
and `amount` and ignores everything else. Match the payment to the order on your server, the same
way as for `pay()`: watch Base for a `Transfer` to your address for that amount (a per-order
amount, or a fresh receiving address per order, makes the match unambiguous). If the app is not
installed, the link does nothing, so show a store link beside it (`store_url_android` and
`store_url_ios` in `GET /config`).
