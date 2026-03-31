---
sidebar_position: 3
---

# WebSocket

The WebSocket endpoint provides real-time balance updates, price feeds, and block notifications.

## Endpoint

```
wss://walletapi.kakitu.africa
```

## Keepalive

The server sends a WebSocket ping every **54 seconds**. Your client must respond with a pong within 60 seconds or the connection is closed. Most WebSocket libraries handle pong automatically.

## Subscribing to an account

Send an `account_subscribe` message after connecting:

```js
const ws = new WebSocket('wss://walletapi.kakitu.africa');

ws.onopen = () => {
  ws.send(JSON.stringify({
    action: 'account_subscribe',
    account: 'kshs_1abc123...',
    currency: 'KES',
    fcm_token_v2: '<firebase-token>',       // optional
    notification_enabled: true,             // optional
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data);
};
```

### Subscribe request fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | ✅ | Must be `account_subscribe` |
| `account` | string | ✅ | `kshs_` address to subscribe to |
| `currency` | string | | ISO currency code for price (default: `USD`). Use `KES` for Kenyan Shilling. |
| `uuid` | string | | Client session ID. Auto-generated if omitted. |
| `fcm_token_v2` | string | | Firebase Cloud Messaging token for push notifications |
| `notification_enabled` | boolean | | `true` to store FCM token, `false` to remove it |

### Subscribe response fields

| Field | Type | Description |
|-------|------|-------------|
| `account` | string | Subscribed address |
| `balance` | string | Current balance in raw |
| `frontier` | string | Latest block hash |
| `representative` | string | Current representative address |
| `open_block` | string | First block hash (null if unopened) |
| `confirmation_height` | number | Confirmed block height |
| `block_count` | number | Total block count |
| `pending_count` | number | Number of pending (unreceived) blocks |
| `price` | string | Current KSHS price in requested currency |
| `btc` | string | Current KSHS price in BTC |
| `currency` | string | Currency code |
| `uuid` | string | Session ID |

## Updating FCM token

To update push notification preferences without re-subscribing:

```js
ws.send(JSON.stringify({
  action: 'fcm_update',
  account: 'kshs_1abc123...',
  fcm_token_v2: '<new-firebase-token>',
  enabled: true,
}));
```

| Field | Type | Description |
|-------|------|-------------|
| `action` | string | Must be `fcm_update` |
| `account` | string | Address to update token for |
| `fcm_token_v2` | string | New FCM token |
| `enabled` | boolean | `true` = store token, `false` = remove token |

## Real-time server events

### Price update

Sent every 60 seconds to all connected clients:

```json
{
  "currency": "KES",
  "price": "1.00",
  "btc": "0.000000089"
}
```

### Incoming block notification

Sent when a send block targets your subscribed account:

```json
{
  "account": "kshs_1abc123...",
  "hash": "DEF456...",
  "block": { "..." : "..." },
  "is_send": "true",
  "amount": "1000000000000000000000000000000"
}
```

The `amount` is in raw units. This notification is sent alongside a Firebase push notification if the account has a registered FCM token.
