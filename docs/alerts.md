---
sidebar_position: 5
---

# Alerts

The alerts endpoint returns active in-app announcements — used for maintenance notices, upgrade prompts, or emergency messages.

## Endpoints

```
GET /alerts/{lang}
GET /alerts/
```

`/alerts/` returns the English alert. `/alerts/{lang}` returns the alert for the given language code.

## Example

```bash
curl https://walletapi.kakitu.africa/alerts/en
```

If there is no active alert, the response is an empty object `{}`.

## Alert object

The structure of the alert object is defined by the server's `alerts.json` configuration file. A typical alert includes a title, message, and optional action button.
