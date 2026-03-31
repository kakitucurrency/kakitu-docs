---
sidebar_position: 1
---

# Introduction

Kakitu is a **1 KSHS = 1 KES stablecoin** built on a fork of the Nano blockchain protocol.
Transactions are feeless and settle in under a second.

## What the API provides

| Feature | How |
|---------|-----|
| Wallet operations | `POST /api` — balance, history, send/receive blocks |
| Real-time updates | WebSocket — live balance, price, incoming block notifications |
| M-Pesa cash-in | `POST /mpesa/cashin` — STK Push, user pays KES → receives KSHS |
| M-Pesa cash-out | `POST /mpesa/cashout` — user sends KSHS → receives KES on M-Pesa |
| Alerts | `GET /alerts/{lang}` — in-app maintenance banners |

## Base URL

```
https://walletapi.kakitu.africa
```

## Quick start

```bash
curl -X POST https://walletapi.kakitu.africa/api \
  -H "Content-Type: application/json" \
  -d '{"action":"account_balance","account":"kshs_1abc123..."}'
```

Response:
```json
{
  "balance": "1000000000000000000000000000000",
  "pending": "0",
  "receivable": "0"
}
```

:::info
All balances are in **raw** units. 1 KSHS = 10³⁰ raw.
:::

Next: [Getting Started →](/docs/getting-started)
