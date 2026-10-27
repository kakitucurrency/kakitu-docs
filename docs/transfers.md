---
sidebar_position: 6
title: Transfers
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# Transfers

A transfer moves KSHS from your own wallet to another address, and **Kakitu's relayer pays the gas.** You hold no ETH and you never need any.

That is the only thing we do for you. **You sign the transfer with your own key and send us the signed result.** We hold no key of yours, we cannot change who is paid, and we cannot send anything you did not sign. If our relayer vanished tomorrow, your signed intent would still be a thing anyone could submit — the forwarder is permissionless.

## Who can call it

An **approved** merchant, and nobody else. A wallet that has not registered gets `404 merchant_not_registered`; one that is `pending` or `rejected` gets `403 merchant_not_approved`; a suspended one gets `403 merchant_suspended`.

The reason is money, not ceremony. Our relayer pays Base gas out of one small ETH balance, and when that balance empties **every transfer in the country stops**, not just this API. Addresses are free, so an open route here would be a free tap on it. See [Going live](./going-live).

## Running these examples

Every example on this page is **signed**. An unsigned request is `401 unauthorized`, so a
shorter version would not be worth printing.

None of them writes a fourth signer. The TypeScript, Python and PHP snippets call the complete
programs on [Authentication](./authentication): save those three beside your script as
`kakitu.mjs`, `kakitu.py` and `kakitu.php`, and export `KAKITU_PRIVATE_KEY` before running
anything. cURL cannot sign by itself, so the shell examples make the same EIP-191 signature
through one helper function that calls Foundry's `cast`.

<details>
<summary><code>kakitu.sh</code> &mdash; the shell signer every cURL example on this page calls</summary>

```bash title="kakitu.sh"
# kakitu.sh - sign a Kakitu request from the shell and send it.
#   Needs curl, openssl and Foundry's `cast` (https://getfoundry.sh).
#   Keep the key in the environment or a secret store: KAKITU_PRIVATE_KEY=0x...
#   Never in a script, a ticket, or your shell history.
KAKITU_BASE_URL=${KAKITU_BASE_URL:-https://walletapi.kakitu.org}

# kakitu METHOD TARGET [BODY] [extra curl args...]
kakitu() {
  local method=$1 target=$2 body=${3-}
  shift $(( $# < 3 ? $# : 3 ))
  local ts hash addr sig
  ts=$(date +%s)                                   # seconds, within 120s of server time
  hash=$(printf '%s' "$body" | openssl dgst -sha256 | awk '{print $NF}')
  addr=$(cast wallet address --private-key "$KAKITU_PRIVATE_KEY")
  # `cast wallet sign` is EIP-191 personal_sign - the same thing the other three programs do.
  sig=$(cast wallet sign --private-key "$KAKITU_PRIVATE_KEY" "$method $target $ts $hash")
  # An array, not an unquoted ${body:+...}: that splits differently in bash and zsh.
  local args=(-sS -X "$method" "$KAKITU_BASE_URL$target"
    -H "X-Kakitu-Address: $addr"
    -H "X-Kakitu-Timestamp: $ts"
    -H "X-Kakitu-Signature: $sig")
  [ -n "$body" ] && args+=(-H "Content-Type: application/json" --data-raw "$body")
  curl "${args[@]}" "$@"
}
```

`source kakitu.sh` once per shell, then call `kakitu METHOD TARGET [BODY] [curl args...]`.
`TARGET` is the path plus `?query` when there is one, byte for byte as it will be sent: the
query string is inside the signed message, so quote it and change it nowhere else.

</details>

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

<Tabs groupId="lang">
<TabItem value="curl" label="cURL" default>

Needs Foundry's `cast`, `jq`, `curl` and `kakitu.sh` from the top of this page.
`cast wallet sign --data` signs EIP-712 typed data; the plain form signs EIP-191.

```bash title="transfer.sh"
# transfer.sh - source it after kakitu.sh:
#   . ./kakitu.sh && . ./transfer.sh && send_transfer 0xRecipient 1000

# The chain id, the token and the forwarder come from the server, never from constants.
kakitu_cfg() { curl -sS "${KAKITU_BASE_URL:-https://walletapi.kakitu.org}/config"; }

# split 0x<130 hex> -> "r s v"
split() { local h=${1#0x}; printf '0x%s 0x%s %d' "${h:0:64}" "${h:64:64}" "$((16#${h:128:2}))"; }

# sign_transfer TO VALUE_WEI DEADLINE -> the signed transfer object, as JSON
sign_transfer() {
  local to=$1 value=$2 deadline=$3 cfg chain token fwd rpc from nonce permit intent
  cfg=$(kakitu_cfg)
  chain=$(jq -r .chain_id <<<"$cfg"); token=$(jq -r .kshs_contract <<<"$cfg")
  fwd=$(jq -r .forwarder   <<<"$cfg"); rpc=$(jq -r .public_rpc_url <<<"$cfg")
  from=$(cast wallet address --private-key "$KAKITU_PRIVATE_KEY")
  # ONE nonce, read BEFORE signing, used by BOTH signatures. Read it again for every transfer.
  nonce=$(cast call "$token" "nonces(address)(uint256)" "$from" --rpc-url "$rpc" | awk '{print $1}')

  # 1. The EIP-2612 permit, in the TOKEN's domain. The spender is the FORWARDER, not the payee.
  permit=$(cast wallet sign --private-key "$KAKITU_PRIVATE_KEY" --data "$(jq -n \
    --argjson cid "$chain" --arg vc "$token" --arg o "$from" --arg sp "$fwd" \
    --arg v "$value" --arg n "$nonce" --arg d "$deadline" '{
      types: {
        EIP712Domain: [{name:"name",type:"string"},{name:"version",type:"string"},
                       {name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}],
        Permit: [{name:"owner",type:"address"},{name:"spender",type:"address"},
                 {name:"value",type:"uint256"},{name:"nonce",type:"uint256"},
                 {name:"deadline",type:"uint256"}]},
      primaryType: "Permit",
      domain: {name:"Kakitu", version:"1", chainId:$cid, verifyingContract:$vc},
      message: {owner:$o, spender:$sp, value:$v, nonce:$n, deadline:$d}}')")

  # 2. The EIP-712 intent, in the FORWARDER's domain. This is what binds the recipient.
  intent=$(cast wallet sign --private-key "$KAKITU_PRIVATE_KEY" --data "$(jq -n \
    --argjson cid "$chain" --arg vc "$fwd" --arg o "$from" --arg to "$to" \
    --arg v "$value" --arg n "$nonce" --arg d "$deadline" '{
      types: {
        EIP712Domain: [{name:"name",type:"string"},{name:"version",type:"string"},
                       {name:"chainId",type:"uint256"},{name:"verifyingContract",type:"address"}],
        Relay: [{name:"owner",type:"address"},{name:"to",type:"address"},
                {name:"value",type:"uint256"},{name:"deadline",type:"uint256"},
                {name:"nonce",type:"uint256"}]},
      primaryType: "Relay",
      domain: {name:"KakituForwarder", version:"1", chainId:$cid, verifyingContract:$vc},
      message: {owner:$o, to:$to, value:$v, deadline:$d, nonce:$n}}')")

  local pr ps pv ir is iv
  read -r pr ps pv <<<"$(split "$permit")"
  read -r ir is iv <<<"$(split "$intent")"
  jq -nc --arg from "$from" --arg to "$to" --arg value "$value" --argjson d "$deadline" \
         --arg pr "$pr" --arg ps "$ps" --argjson pv "$pv" \
         --arg ir "$ir" --arg is "$is" --argjson iv "$iv" \
    '{from:$from, to:$to, value_wei:$value, deadline:$d,
      v:$pv, r:$pr, s:$ps, iv:$iv, ir:$ir, is:$is}'
}

# send_transfer TO KSHS
send_transfer() {
  local value deadline
  value=$(cast to-wei "$2" ether)       # KSHS has 18 decimals
  deadline=$(( $(date +%s) + 300 ))     # 5 minutes; the cap is 10
  # Idempotency-Key is REQUIRED here. Without it: 400 idempotency_key_required, nothing sent.
  kakitu POST /v1/transfers "$(sign_transfer "$1" "$value" "$deadline")" \
    -H "Idempotency-Key: $(uuidgen)"
}
```

</TabItem>
<TabItem value="ts" label="TypeScript">

Node 18 or newer, `npm install ethers@6`. It imports `signedHeaders` from the signer on the
[Authentication](./authentication) page &mdash; save that file as `kakitu.mjs` next to this one.

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

// Addresses and chain id come from the server, never from a constant in your code.
export async function config() {
  return await (await fetch(BASE_URL + "/config")).json();
}

// Both signatures, over one nonce. The payouts page reuses this function unchanged.
export async function signTransfer(wallet, cfg, to, value, deadline) {
  const provider = new JsonRpcProvider(cfg.public_rpc_url);
  const token = new Contract(cfg.kshs_contract, ["function nonces(address) view returns (uint256)"], provider);

  const owner = getAddress(wallet.address);
  const recipient = getAddress(to);
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

  return {
    from: owner,
    to: recipient,
    value_wei: value.toString(),
    deadline: Number(deadline),
    v: permit.v, r: permit.r, s: permit.s,
    iv: intent.v, ir: intent.r, is: intent.s,
  };
}

export async function transfer(wallet, to, kshs) {
  const cfg = await config();
  const value = BigInt(kshs) * 10n ** 18n;                       // KSHS has 18 decimals
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);  // 5 minutes; the cap is 10
  const body = await signTransfer(wallet, cfg, to, value, deadline);

  // Serialise once, sign those bytes, send those bytes. One key per logical transfer.
  const raw = JSON.stringify(body);
  const headers = await signedHeaders(wallet, "POST", "/v1/transfers", raw);
  headers["Content-Type"] = "application/json";
  // REQUIRED. Without it: 400 idempotency_key_required, and nothing is sent.
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

</TabItem>
<TabItem value="py" label="Python">

Python 3.9 or newer, `pip install "eth-account>=0.11" requests`. It imports `signed_headers`
from the signer on the [Authentication](./authentication) page &mdash; save that file as
`kakitu.py` next to this one. The token nonce is read over plain JSON-RPC, so there is no
web3.py to install.

```python title="transfer.py"
"""transfer.py - Python 3.9+, `pip install "eth-account>=0.11" requests`
   KAKITU_PRIVATE_KEY=0x... python transfer.py 0xRecipient 1000"""
import json
import os
import sys
import time
import uuid

import requests
from eth_account import Account
from eth_account.messages import encode_typed_data
from kakitu import BASE_URL, signed_headers

def split(signature: bytes) -> dict:
    """A 65-byte signature as the (v, r, s) the API wants."""
    h = bytes(signature).hex()
    return {"r": "0x" + h[0:64], "s": "0x" + h[64:128], "v": int(h[128:130], 16)}


def config() -> dict:
    """Addresses and chain id come from the server, never from a constant in your code."""
    return requests.get(BASE_URL + "/config", timeout=30).json()


def nonce_of(rpc: str, token: str, owner: str) -> int:
    """nonces(owner) on the KSHS token. Selector 0x7ecebe00, one address argument."""
    call = {"to": token, "data": "0x7ecebe00" + owner[2:].lower().rjust(64, "0")}
    res = requests.post(rpc, timeout=30, json={
        "jsonrpc": "2.0", "id": 1, "method": "eth_call", "params": [call, "latest"],
    }).json()
    return int(res["result"], 16)


def sign_typed(account, domain: dict, types: dict, message: dict) -> dict:
    signed = account.sign_message(
        encode_typed_data(domain_data=domain, message_types=types, message_data=message))
    return split(signed.signature)


def sign_transfer(account, cfg: dict, to: str, value: int, deadline: int) -> dict:
    """Both signatures, over one nonce. The payouts page reuses this unchanged."""
    owner = account.address
    # ONE nonce, read before signing, used by BOTH signatures. Read it again for every
    # transfer: it advances each time a permit of yours is spent.
    nonce = nonce_of(cfg["public_rpc_url"], cfg["kshs_contract"], owner)

    # 1. The EIP-2612 permit, in the TOKEN's domain. The spender is the forwarder.
    permit = sign_typed(
        account,
        {"name": "Kakitu", "version": "1", "chainId": cfg["chain_id"],
         "verifyingContract": cfg["kshs_contract"]},
        # encode_typed_data builds EIP712Domain from domain_data and infers the primary
        # type from this dict, so it holds exactly one entry and never EIP712Domain.
        {"Permit": [
            {"name": "owner", "type": "address"},
            {"name": "spender", "type": "address"},
            {"name": "value", "type": "uint256"},
            {"name": "nonce", "type": "uint256"},
            {"name": "deadline", "type": "uint256"},
        ]},
        {"owner": owner, "spender": cfg["forwarder"], "value": value,
         "nonce": nonce, "deadline": deadline},
    )

    # 2. The EIP-712 intent, in the FORWARDER's domain. This is what binds the recipient.
    intent = sign_typed(
        account,
        {"name": "KakituForwarder", "version": "1", "chainId": cfg["chain_id"],
         "verifyingContract": cfg["forwarder"]},
        {"Relay": [
            {"name": "owner", "type": "address"},
            {"name": "to", "type": "address"},
            {"name": "value", "type": "uint256"},
            {"name": "deadline", "type": "uint256"},
            {"name": "nonce", "type": "uint256"},
        ]},
        {"owner": owner, "to": to, "value": value, "deadline": deadline, "nonce": nonce},
    )

    return {
        "from": owner, "to": to,
        "value_wei": str(value),          # a decimal STRING, not a number
        "deadline": deadline,
        "v": permit["v"], "r": permit["r"], "s": permit["s"],
        "iv": intent["v"], "ir": intent["r"], "is": intent["s"],
    }


def transfer(account, to: str, kshs: int):
    cfg = config()
    value = int(kshs) * 10 ** 18                 # KSHS has 18 decimals
    deadline = int(time.time()) + 300            # 5 minutes; the cap is 10
    body = sign_transfer(account, cfg, to, value, deadline)

    # Serialise once, sign those bytes, send those bytes. One key per logical transfer.
    raw = json.dumps(body, separators=(",", ":")).encode()
    headers = signed_headers(account, "POST", "/v1/transfers", raw)
    headers["Content-Type"] = "application/json"
    # REQUIRED. Without it: 400 idempotency_key_required, and nothing is sent.
    headers["Idempotency-Key"] = str(uuid.uuid4())

    res = requests.post(BASE_URL + "/v1/transfers", headers=headers, data=raw, timeout=30)
    return res.status_code, res.json()


if __name__ == "__main__":
    acct = Account.from_key(os.environ["KAKITU_PRIVATE_KEY"])
    print(transfer(acct, sys.argv[1], sys.argv[2]))
```

</TabItem>
<TabItem value="php" label="PHP">

PHP 8.1 or newer with `curl` and `gmp`,
`composer require kornrunner/keccak simplito/elliptic-php`. It uses `kakitu_headers` from the
signer on the [Authentication](./authentication) page &mdash; save that file as `kakitu.php`
next to this one. There is no EIP-712 library here: the digest is assembled by hand, which is
twenty lines and no dependency.

```php title="transfer.php"
<?php
// transfer.php - PHP 8.1+ with ext-curl and ext-gmp.
//   composer require kornrunner/keccak simplito/elliptic-php
//   KAKITU_PRIVATE_KEY=0x... php transfer.php 0xRecipient 1000
declare(strict_types=1);
require __DIR__ . '/kakitu.php';

use Elliptic\EC;
use kornrunner\Keccak;

/** A 32-byte word from a hex string (an address, or a 32-byte hash). */
function k_word_hex(string $hex): string
{
    return str_pad(strtolower((string) preg_replace('/^0x/', '', $hex)), 64, '0', STR_PAD_LEFT);
}

/** A 32-byte word from a DECIMAL STRING, so 1000 KSHS (1e21 wei) survives the trip. */
function k_word_num(string $dec): string
{
    return str_pad(gmp_strval(gmp_init($dec, 10), 16), 64, '0', STR_PAD_LEFT);
}

function k_text(string $s): string { return Keccak::hash($s, 256); }   // hex, unprefixed

/** The EIP-712 digest: keccak(0x1901 || domainSeparator || structHash). */
function k_digest(array $domain, string $typeString, array $words): string
{
    $separator = Keccak::hash(hex2bin(
        k_text('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)')
        . k_word_hex(k_text($domain['name']))
        . k_word_hex(k_text($domain['version']))
        . k_word_num((string) $domain['chainId'])
        . k_word_hex($domain['verifyingContract'])), 256);
    $structHash = Keccak::hash(hex2bin(k_text($typeString) . implode('', $words)), 256);
    return Keccak::hash(hex2bin('1901' . $separator . $structHash), 256);
}

/** Sign a 32-byte digest. EIP-712, so NO personal_sign prefix - that is the other scheme. */
function k_sign_digest(string $privateKeyHex, string $digest): array
{
    $ec = new EC('secp256k1');
    $key = $ec->keyFromPrivate((string) preg_replace('/^0x/', '', $privateKeyHex), 'hex');
    $sig = $key->sign($digest, 'hex', ['canonical' => true]);
    return [
        'v' => 27 + $sig->recoveryParam,
        'r' => '0x' . str_pad($sig->r->toString(16), 64, '0', STR_PAD_LEFT),
        's' => '0x' . str_pad($sig->s->toString(16), 64, '0', STR_PAD_LEFT),
    ];
}

function k_address(string $privateKeyHex): string
{
    $ec = new EC('secp256k1');
    $key = $ec->keyFromPrivate((string) preg_replace('/^0x/', '', $privateKeyHex), 'hex');
    $pub = substr($key->getPublic(false, 'hex'), 2);            // drop the 04 prefix
    return '0x' . substr(Keccak::hash(hex2bin($pub), 256), 24);
}

/** nonces(owner) on the KSHS token, over plain JSON-RPC. Selector 0x7ecebe00. */
function k_nonce(string $rpc, string $token, string $owner): string
{
    $ch = curl_init($rpc);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode(['jsonrpc' => '2.0', 'id' => 1, 'method' => 'eth_call',
            'params' => [['to' => $token, 'data' => '0x7ecebe00' . k_word_hex($owner)], 'latest']]),
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30,
    ]);
    $res = json_decode((string) curl_exec($ch), true);
    curl_close($ch);
    return gmp_strval(gmp_init($res['result'], 16), 10);
}

/** Addresses and chain id come from the server, never from a constant in your code. */
function kakitu_config(): array
{
    return json_decode((string) file_get_contents(KAKITU_BASE_URL . '/config'), true);
}

/** Both signatures, over ONE nonce. The payouts page reuses this unchanged. */
function kakitu_sign_transfer(string $privateKeyHex, array $cfg, string $to,
                              string $valueWei, int $deadline): array
{
    $from = k_address($privateKeyHex);
    // ONE nonce, read before signing, used by BOTH signatures. Read it again for every
    // transfer: it advances each time a permit of yours is spent.
    $nonce = k_nonce($cfg['public_rpc_url'], $cfg['kshs_contract'], $from);

    // 1. The EIP-2612 permit, in the TOKEN's domain. The spender is the forwarder.
    $permit = k_sign_digest($privateKeyHex, k_digest(
        ['name' => 'Kakitu', 'version' => '1', 'chainId' => $cfg['chain_id'],
         'verifyingContract' => $cfg['kshs_contract']],
        'Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)',
        [k_word_hex($from), k_word_hex($cfg['forwarder']), k_word_num($valueWei),
         k_word_num($nonce), k_word_num((string) $deadline)]));

    // 2. The EIP-712 intent, in the FORWARDER's domain. This is what binds the recipient.
    $intent = k_sign_digest($privateKeyHex, k_digest(
        ['name' => 'KakituForwarder', 'version' => '1', 'chainId' => $cfg['chain_id'],
         'verifyingContract' => $cfg['forwarder']],
        'Relay(address owner,address to,uint256 value,uint256 deadline,uint256 nonce)',
        [k_word_hex($from), k_word_hex($to), k_word_num($valueWei),
         k_word_num((string) $deadline), k_word_num($nonce)]));

    return [
        'from' => $from, 'to' => $to,
        'value_wei' => $valueWei,        // a decimal STRING, not a number
        'deadline' => $deadline,
        'v' => $permit['v'], 'r' => $permit['r'], 's' => $permit['s'],
        'iv' => $intent['v'], 'ir' => $intent['r'], 'is' => $intent['s'],
    ];
}

/** A signed POST with extra headers (the Idempotency-Key these routes require). */
function kakitu_post(string $privateKeyHex, string $target, array $payload, array $extra = []): array
{
    // Encode once, sign those bytes, send those bytes.
    $raw = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    $headers = array_merge(kakitu_headers($privateKeyHex, 'POST', $target, $raw),
        ['Content-Type' => 'application/json'], $extra);
    $lines = [];
    foreach ($headers as $k => $v) {
        $lines[] = "$k: $v";
    }
    $ch = curl_init(KAKITU_BASE_URL . $target);
    curl_setopt_array($ch, [
        CURLOPT_POST => true, CURLOPT_HTTPHEADER => $lines, CURLOPT_POSTFIELDS => $raw,
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30,
    ]);
    $out = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return [$status, json_decode((string) $out, true)];
}

function kakitu_transfer(string $privateKeyHex, string $to, string $kshs): array
{
    $cfg = kakitu_config();
    $value = gmp_strval(gmp_mul(gmp_init($kshs, 10), gmp_pow(10, 18)));  // 18 decimals
    $deadline = time() + 300;                                            // 5 min; the cap is 10
    $body = kakitu_sign_transfer($privateKeyHex, $cfg, $to, $value, $deadline);
    // Idempotency-Key is REQUIRED. Without it: 400 idempotency_key_required, nothing sent.
    return kakitu_post($privateKeyHex, '/v1/transfers', $body,
        ['Idempotency-Key' => bin2hex(random_bytes(16))]);
}

if (PHP_SAPI === 'cli' && realpath($argv[0] ?? '') === __FILE__) {
    $key = getenv('KAKITU_PRIVATE_KEY') ?: exit("Set KAKITU_PRIVATE_KEY\n");
    print_r(kakitu_transfer($key, $argv[1], $argv[2]));
}
```

</TabItem>
</Tabs>

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
| `rail_unavailable` | 503 | Transfers are temporarily unavailable. **Nothing was sent.** Retry with the same key. |
| `idempotency_key_acted` | 409 | The transfer may already have been delivered. **Do not send it again.** |

Every one of these uses a code from the closed set in [Errors](./errors).

### 503 and 409 mean opposite things here

**On this route the two statuses are a clean split, and you can rely on it.**

| Answer | What it means | What to do |
|---|---|---|
| `503 rail_unavailable` | **Nothing was sent.** | Retry with the **same** `Idempotency-Key`. |
| `409 idempotency_key_acted` | **The money may already have moved.** | **Check before doing anything.** |

An outcome we cannot determine — the transfer reached the point where it may have been broadcast and we could not record what came back — now answers `409 idempotency_key_acted`. It used to answer `503 rail_unavailable` with wording that said the outcome was unknown, so `503` carried both readings at once and a client that did the obvious thing with a `503` could send the money twice. That ambiguity was the bug. It is gone: a `503` on this route never means an unknown outcome.

### The two answers that are not "retry"

Most refusals are safe to retry. These are not, and they are the ones to write code for.

**`idempotency_key_acted`.** You can get this on your *first* attempt, not only on a retry. It means either that the relay believes this signed transfer has already been delivered — by us, or by someone else who relayed the same intent first — or that we handed it over and could not record the outcome. Do not send it again with this key **or a new one**. Check the recipient's balance, or ask support with the `request_id`.

**`invalid_request` saying the transfer was made out of date.** Another transfer from your wallet advanced your permit nonce, so this one can no longer be delivered — and nothing was. Sign a fresh transfer and send it with a **new** `Idempotency-Key`.

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
