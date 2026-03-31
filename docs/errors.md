---
sidebar_position: 6
---

# Errors

## HTTP status codes

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad Request — invalid input (see message for details) |
| `409` | Conflict — `tx_hash` already used for a cashout |
| `429` | Too Many Requests — rate limit exceeded (100 req/min per IP) |
| `500` | Internal Server Error — upstream Nano RPC or Daraja failure |

## Error response format

```json
{
  "error": "invalid phone number"
}
```

## Common 400 errors

| Endpoint | Cause |
|----------|-------|
| `POST /mpesa/cashin` | Phone not in accepted format |
| `POST /mpesa/cashin` | `amount_kes` is zero or negative |
| `POST /mpesa/cashin` | `kshs_address` does not start with `kshs_` |
| `POST /mpesa/cashout` | Block not found or not confirmed |
| `POST /mpesa/cashout` | Block destination is not the treasury address |
| `POST /mpesa/cashout` | Block amount does not match `amount_kes` |

## WebSocket disconnections

| Cause | Description |
|-------|-------------|
| Ping timeout | Client did not respond to server ping within 60 seconds |
| Server restart | Reconnect with exponential backoff |

Reconnection example:

```js
function connect() {
  const ws = new WebSocket('wss://walletapi.kakitu.org');
  ws.onclose = () => setTimeout(connect, 2000);
  ws.onopen = () => { /* re-subscribe */ };
}
connect();
```
