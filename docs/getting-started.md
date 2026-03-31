---
sidebar_position: 2
---

# Getting Started

## Base URL

```
https://walletapi.kakitu.africa
```

## Content-Type

All `POST` requests must include:
```
Content-Type: application/json
```

## Rate Limiting

| Tier | Limit |
|------|-------|
| Default | 100 requests / minute per IP |
| Admin key | Unlimited |

To use the admin tier, pass the key in the `Authorization` header:
```
Authorization: YOUR_ADMIN_API_KEY
```

## CORS

All origins are allowed. No preflight configuration needed.

## Amounts

All KSHS amounts in the API are in **raw** units:

```
1 KSHS = 1,000,000,000,000,000,000,000,000,000,000 raw  (10³⁰)
```

To convert:
```js
const KSHS_TO_RAW = BigInt('1000000000000000000000000000000'); // 10^30

// KSHS → raw
const raw = BigInt(kshs) * KSHS_TO_RAW;

// raw → KSHS
const amount = Number(rawAmount) / Number(KSHS_TO_RAW);
```

## Address format

All Kakitu addresses start with `kshs_`:
```
kshs_1abc123def456...
```

## Example: Check balance

```bash
curl -X POST https://walletapi.kakitu.africa/api \
  -H "Content-Type: application/json" \
  -d '{
    "action": "account_balance",
    "account": "kshs_1abc123..."
  }'
```

## Example: Get transaction history

```bash
curl -X POST https://walletapi.kakitu.africa/api \
  -H "Content-Type: application/json" \
  -d '{
    "action": "account_history",
    "account": "kshs_1abc123...",
    "count": 10
  }'
```

See the [API Reference](/api-reference) for all available actions.
