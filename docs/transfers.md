---
sidebar_position: 6
title: Transfers
---

# Transfers

A transfer moves KSHS from your own wallet to another address, and **Kakitu's relayer pays the gas.** You hold no ETH and you never need any.

That is the only thing we do for you. **You sign the transfer with your own key and send us the signed result.** We hold no key of yours, we cannot change who is paid, and we cannot send anything you did not sign. If our relayer vanished tomorrow, your signed intent would still be a thing anyone could submit — the forwarder is permissionless.

## Who can call it

An **approved** merchant, and nobody else. A wallet that has not registered gets `404 merchant_not_registered`; one that is `pending` or `rejected` gets `403 merchant_not_approved`; a suspended one gets `403 merchant_suspended`.

The reason is money, not ceremony. Our relayer pays Base gas out of one small ETH balance, and when that balance empties **every transfer in the country stops**, not just this API. Addresses are free, so an open route here would be a free tap on it. See [Going live](./going-live).

## The request

```http
POST /v1/transfers
Content-Type: application/json
Idempotency-Key: 8ab0f6c4-6c38-4f0e-9a7e-6b0a2f6b1d33

{
  "from": "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
  "to": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "value_wei": "1000000000000000000000",
  "deadline": 1761480300,
  "v": 27,
  "r": "0x1111111111111111111111111111111111111111111111111111111111111111",
  "s": "0x2222222222222222222222222222222222222222222222222222222222222222",
  "iv": 28,
  "ir": "0x3333333333333333333333333333333333333333333333333333333333333333",
  "is": "0x4444444444444444444444444444444444444444444444444444444444444444"
}
```

| Field | Type | Rules |
|---|---|---|
| `from` | string, required | Your own address. It must be the wallet that signed the HTTP request; a body naming anyone else is refused with `invalid_request`. |
| `to` | string, required | The recipient. A hex address, and not the same as `from`. |
| `value_wei` | string, required | The amount in the token's smallest unit, as a **decimal string**. KSHS has 18 decimals, so **1 KSHS is `"1000000000000000000"`**. Must be greater than zero. |
| `deadline` | integer, required | Unix time in **seconds** when the signature stops being valid. It must be in the future and **at most 10 minutes ahead**. Outside that: `invalid_request`. |
| `v`, `r`, `s` | uint8, string, string | The **EIP-2612 permit** signature. `r` and `s` are `0x` plus 32 bytes (64 hex characters). |
| `iv`, `ir`, `is` | uint8, string, string | The **EIP-712 intent** signature, in the same shape. |

`Idempotency-Key` is **required**. Without it: `400 idempotency_key_required`, and nothing is sent.

### Why there are two signatures

The permit alone would let a front-runner redirect your money.

- The **permit** is the standard EIP-2612 approval: it lets the forwarder move `value` of your KSHS. It names the forwarder as spender — not a recipient.
- The **intent** names the recipient. The forwarder checks that it recovers to `from`, and reverts if it does not.

Anyone can relay a signed intent, which is what makes the forwarder trustless. Without the second signature, "anyone" would include someone who takes your permit and pays themselves with it.

## The response

```json
HTTP 200
{
  "id": "0x4a1c…",
  "status": "confirmed"
}
```

Two fields, and only ever two.

| Status | HTTP | Meaning |
|---|---|---|
| `confirmed` | 200 | The receipt is in and the transfer succeeded. Final. |
| `pending` | 202 | Submitted, no receipt yet. It is probably seconds from landing. **Do not send it again.** |

`id` is the transaction hash. It is your handle on the transfer on Base, and the only one: there is no `GET /v1/transfers/{id}` and no way to cancel. Look it up on a Base explorer, or watch your [balance](./balances).

## Signing a transfer

This is the part worth getting right once. Both signatures are over EIP-712 typed data, and **both use the same nonce**: the token's permit nonce for your address, read **before** you sign.

| | Permit | Intent |
|---|---|---|
| Domain `name` | `Kakitu` | `KakituForwarder` |

:::warning Get the domain exactly right
The token's EIP-712 domain name is `Kakitu` — **not** `Kakitu Kenyan Shilling`, which is the
name of the retired v1 contract. The deployed token is `KSHSv2`, declared
`ERC20("Kakitu", "KSHS")` with `ERC20Permit("Kakitu")`, so the permit domain takes that name
and OpenZeppelin's default version `"1"`.

This is the one mistake that fails silently. A wrong domain still produces a perfectly
well-formed signature; it just recovers to a different address, and you get a refusal that
looks like a key problem rather than a typo. If signatures are rejected and everything else
looks right, check this line first.
:::
| Domain `version` | `1` | `1` |
| Domain `verifyingContract` | the KSHS token | the forwarder |
| Type | `Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)` | `Relay(address owner,address to,uint256 value,uint256 deadline,uint256 nonce)` |
| `spender` / `to` | the forwarder | the recipient |
| `nonce` | `token.nonces(owner)` | the same value |

The chain id, the token address and the forwarder address are not constants you should paste into your code. Read them from `GET /config`, which is public and needs no signature:

```json
{
  "chain_id": 8453,
  "kshs_contract": "0x…",
  "forwarder": "0x…",
  "public_rpc_url": "https://…",
  "relay_max_per_tx_kes": 500000
}
```

### A complete example

Node 18 or newer, `npm install ethers@6`. It imports `signedHeaders` from the signer on the [Authentication](./authentication) page — save that file as `kakitu.mjs` next to this one.

```ts title="transfer.mjs"
// transfer.mjs - Node 18+, `npm install ethers@6`
//   KAKITU_PRIVATE_KEY=0x... node transfer.mjs 0xRecipient 1000
import { randomUUID } from "node:crypto";
import { Contract, JsonRpcProvider, Wallet, getAddress } from "ethers";
import { signedHeaders } from "./kakitu.mjs";

const BASE_URL = "https://walletapi.kakitu.org";

// Split a 65-byte signature into the (v, r, s) the API wants.
function split(signature) {
  const h = signature.slice(2);
  return {
    r: "0x" + h.slice(0, 64),
    s: "0x" + h.slice(64, 128),
    v: parseInt(h.slice(128, 130), 16),
  };
}

export async function transfer(wallet, to, kshs) {
  // Addresses and chain id come from the server, never from a constant in your code.
  const cfg = await (await fetch(BASE_URL + "/config")).json();
  const provider = new JsonRpcProvider(cfg.public_rpc_url);
  const token = new Contract(cfg.kshs_contract, ["function nonces(address) view returns (uint256)"], provider);

  const owner = getAddress(wallet.address);
  const recipient = getAddress(to);
  const value = BigInt(kshs) * 10n ** 18n;                       // KSHS has 18 decimals
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);  // 5 minutes; the cap is 10
  // ONE nonce, read before signing, used by BOTH signatures. Read it again for every transfer:
  // it advances each time a permit of yours is spent.
  const nonce = await token.nonces(owner);

  // 1. The EIP-2612 permit, in the TOKEN's domain. The spender is the forwarder.
  const permit = split(
    await wallet.signTypedData(
      { name: "Kakitu", version: "1", chainId: cfg.chain_id, verifyingContract: cfg.kshs_contract },
      {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { owner, spender: cfg.forwarder, value, nonce, deadline },
    ),
  );

  // 2. The EIP-712 intent, in the FORWARDER's domain. This is what binds the recipient.
  const intent = split(
    await wallet.signTypedData(
      { name: "KakituForwarder", version: "1", chainId: cfg.chain_id, verifyingContract: cfg.forwarder },
      {
        Relay: [
          { name: "owner", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      },
      { owner, to: recipient, value, deadline, nonce },
    ),
  );

  const body = {
    from: owner,
    to: recipient,
    value_wei: value.toString(),
    deadline: Number(deadline),
    v: permit.v, r: permit.r, s: permit.s,
    iv: intent.v, ir: intent.r, is: intent.s,
  };

  // Serialise once, sign those bytes, send those bytes. One key per logical transfer.
  const raw = JSON.stringify(body);
  const headers = await signedHeaders(wallet, "POST", "/v1/transfers", raw);
  headers["Content-Type"] = "application/json";
  headers["Idempotency-Key"] = randomUUID();

  const res = await fetch(BASE_URL + "/v1/transfers", { method: "POST", headers, body: raw });
  return { status: res.status, body: await res.json() };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const wallet = new Wallet(process.env.KAKITU_PRIVATE_KEY);
  const [to, amount] = process.argv.slice(2);
  console.log(await transfer(wallet, to, amount));
}
```

Keep the key in an environment variable or a secret store. Never in source, never in a ticket.

### When a signature is rejected

Check these in order.

1. **The nonce.** Both signatures must use the same one, and it must be the token's current `nonces(owner)`. If another transfer of yours landed in between, yours is stale: read it again and sign again.
2. **The domain.** A permit signed over the wrong `name`, `version`, `chainId` or `verifyingContract` recovers to a different address and the chain simply refuses it. If you suspect the token domain, compare yours against the token's own `DOMAIN_SEPARATOR()` view.
3. **The deadline.** In the future, at most 10 minutes ahead, in seconds.
4. **The intent fields.** `to` in the signed intent must be the `to` in the body. That is the whole point of the second signature.

The forwarder also exposes `hashRelay(owner, to, value, deadline, nonce)` as a view, which returns the hash it checks the intent signature against. It is the thing to reach for when you are debugging an intent the chain keeps rejecting.

## Errors

| `code` | HTTP | When |
|---|---|---|
| `idempotency_key_required` | 400 | No `Idempotency-Key`. Nothing was sent. |
| `invalid_request` | 400 | A malformed body; `from` is not you; a bad address, amount or deadline; a signature that does not verify; or the chain says this transfer would revert. In all of these **nothing was sent**. |
| `merchant_not_registered` | 404 | This wallet has not registered. |
| `merchant_not_approved` | 403 | Registered, not yet approved. |
| `merchant_suspended` | 403 | The merchant is suspended, **or** either address is frozen on the token. |
| `amount_below_minimum` | 400 | Below the smallest transfer the relayer carries. |
| `amount_above_maximum` | 400 | Above the largest single transfer allowed. `relay_max_per_tx_kes` in `GET /config` is that ceiling. |
| `daily_cap_exceeded` | 429 | This wallet has used its transfer allowance for today. |
| `rate_limited` | 429 | This merchant has reached its hourly transfer limit. Try again within the hour. |
| `rail_unavailable` | 503 | Transfers are temporarily unavailable. Usually nothing was sent — but read the next section, because one case is different. |
| `idempotency_key_acted` | 409 | The transfer has most likely already been delivered. **Do not send it again.** |

Every one of these uses a code from the closed set in [Errors](./errors).

### The three answers that are not "retry"

Most refusals are safe to retry. These are not, and they are the ones to write code for.

**`idempotency_key_acted`.** You can get this on your *first* attempt, not only on a retry. It means the relay believes this signed transfer has already been delivered — by us, or by someone else who relayed the same intent first. Do not send it again with this key **or a new one**. Check the recipient's balance, or ask support with the `request_id`.

**`invalid_request` saying the transfer was made out of date.** Another transfer from your wallet advanced your permit nonce, so this one can no longer be delivered — and nothing was. Sign a fresh transfer and send it with a **new** `Idempotency-Key`.

**`rail_unavailable` saying the outcome is not known.** The transfer reached the point where it may have been broadcast and we could not record what happened. The key is held, so a retry with it gets `idempotency_key_acted`. Check first; do not sign a replacement.

### What happens to your key on a refusal

A key is **released** by a refusal that provably happened before anything was signed or broadcast — a bad body, a frozen account, an amount over or under the limits, a daily cap, the relayer having no ETH, a would-revert. Retry those with the **same** key once you have fixed the cause.

A key is **held** by anything else, including an unknown outcome. That is deliberate: freeing a key after money may have moved makes the retry send it again, while holding one only costs you a new key.

General idempotency rules — replays, mismatched bodies, the 24-hour window — are on the [Collections](./collections#idempotency) page and apply here unchanged.

## Limits

| Limit | Code |
|---|---|
| Largest single transfer | `amount_above_maximum` |
| Smallest transfer | `amount_below_minimum` |
| Transfers per wallet per UTC day | `daily_cap_exceeded` |
| Transfers per merchant per hour | `rate_limited` |

The hourly limit is a spend control on our gas, not a courtesy limit, and it fails closed: if we cannot count, we refuse. See [Rate limits](./rate-limits).
