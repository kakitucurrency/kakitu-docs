---
sidebar_position: 10
title: Balances
---

# Balances

## GET /v1/balances

The balances of **the wallet that signed the request**, read live from the chain. Signed request, no body, no `Idempotency-Key`.

```json
HTTP 200
{
  "kshs": { "amount_kes": 1250, "network": "base" },
  "usdc": { "amount": "3.5", "network": "base" }
}
```

| Field | Meaning |
|---|---|
| `kshs.amount_kes` | Your KSHS balance in whole shillings, as a number. 1 KSHS is 1 KES. |
| `usdc.amount` | Your USDC balance as a **decimal string**, so no precision is lost on the way through JSON. |
| `network` | The chain the balance is on. |

You do not have to be a registered merchant to read this. Any wallet that can sign can read its own balances.

## Both say their network

Both balances state `"base"`, and both will keep saying it even if we never support a second chain.

The reason is not tidiness. **A customer has already lost money sending a token to a Kakitu address on the wrong chain.** An address looks identical on every EVM network, so an integrator who has to *infer* which one an address is for will eventually infer wrong, and the money does not come back. Stating it costs one field.

A related warning worth repeating: this endpoint reads a balance, it does not create a deposit address. Sending a token to your address from outside Kakitu is not how you fund an account, and nothing credits it.

## Zero is an answer

An address with no history holds zero, and the chain says so. You get `200` with zeros, not a `404`. There is no "account not found" here, because there are no accounts — only addresses.

## You can only read your own

The subject is the address that signed the request, and nothing else can name it. An `?address=` query parameter is not honoured: it is ignored, and you get your own balances. Your credential *is* the subject. See [Authentication](./authentication).

## Errors

| `code` | HTTP | When |
|---|---|---|
| `unauthorized` | 401 | The request was not signed, or the signature did not verify. |
| `rail_unavailable` | 503 | Balance reads are temporarily unavailable. Retry shortly. |
| `internal` | 500 | The chain could not be read. Quote the `request_id`. |

A chain that cannot be reached is `internal`, not an empty balance. We would rather tell you we do not know than tell you zero.
