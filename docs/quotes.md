---
sidebar_position: 8
title: Quotes (not open for integration)
---

# Quotes (not open for integration)

:::warning Not open for integration
`POST /v1/quotes` priced deposits and withdrawals on an M-Pesa route Kakitu no longer uses. **Do not build on it or call it.** The route still exists and may answer, but a price from it is not one you can act on. Its reference has been withdrawn from these docs.
:::

What to read instead:

- **The price of a cash-out to your own M-Pesa number**: `kes_offramp_fee_bps` and `kes_offramp_fee_min_kes` in [`GET /config`](./config), or see [Cash out](./cash-out#limits-and-fees). M-Pesa is not available today (`mpesa_rails_visible` is `false`).
- **Cash at a Kakitu agent**: `agent_fee_bps` and `agent_fee_cap_kshs` in [`GET /config`](./config). See [Pricing](./pricing).
- **Your own limits**: [`GET /v1/limits`](./limits).

`POST /v1/quotes` will be documented again only if it returns, on a route Kakitu runs itself.
