---
title: Configuration (GET /config)
---

# Configuration: `GET /config`

```http
GET https://walletapi.kakitu.org/config
```

**Public and unsigned.** It is what the Kakitu app, the extension and your server read to talk to the chain and to know what is switched on right now. Kakitu changes most of these values without a release, so read them in code rather than copying the numbers on these pages.

Every key below is always present. A switch that is off reads `false`, an unset text value reads `""`, and an empty list reads `[]`, never `null`. The one exception is `cashout_capacity_kes`, which is `null` when it is not known.

## The chain

| Key | Meaning |
|---|---|
| `chain_id` | `8453`, Base mainnet. |
| `kshs_contract` | The KSHS token. A payment to you is a `Transfer` log on this contract. |
| `forwarder` | The forwarder that relays signed transfers (the `Relay` intent's verifying contract). See [Transfers](./transfers#signing-a-transfer). |
| `usdc_contract` | USDC on Base, which backs KSHS. |
| `treasury_address` | Kakitu's hot treasury, where a cash-out's KSHS are sent before they are burned. |
| `public_rpc_url` | A public Base RPC you may use to read the chain. |

## Sending KSHS

| Key | Meaning |
|---|---|
| `relay_max_per_tx_kes` | The largest single transfer Kakitu relays, in whole shillings. `50000` today. See [Pricing](./pricing#limits). |

## M-Pesa

**M-Pesa is not available today.** Each M-Pesa rail is offered only when its own `*_enabled` key is `true`, and each of those is already folded with `mpesa_rails_visible` and with Kakitu's pause switch. Read the `*_enabled` key; do not combine the switches yourself.

| Key | Meaning |
|---|---|
| `mpesa_rails_visible` | Whether M-Pesa is shown at all. **`false` today.** While it is `false`, a new M-Pesa cash-out or top-up quote or confirm is refused with `409 mpesa_hidden`, even when the rail is switched on. See [Errors](./errors#codes-that-are-not-in-v1). |
| `kes_offramp_enabled` | Whether [cash-out to your own M-Pesa number](./cash-out) can be used now. |
| `kes_offramp_min_kes`, `kes_offramp_max_kes` | The band for one cash-out: the shillings that land. |
| `kes_offramp_fee_bps`, `kes_offramp_fee_min_kes` | The cash-out fee, on top of the payout: `max(fee_min, ceil(payout × bps / 10000))`. |
| `kes_onramp_enabled` | Whether an M-Pesa top-up (paying M-Pesa to receive KSHS) can be used now. |
| `kes_onramp_min_kes`, `kes_onramp_max_kes` | The band for one top-up: the shillings paid. |
| `kes_onramp_fee_bps`, `kes_onramp_fee_min_kes` | The top-up fee, taken out of what is paid: `max(fee_min, ceil(pay × bps / 10000))`. |
| `kes_onramp_unproved_max_kes` | The largest top-up from an M-Pesa number the wallet has not proved it owns. |
| `kes_onramp_max_now_kes` | The largest top-up a quote would accept right now, rounded down to a thousand. `0` when nothing can be taken. |
| `cashout_capacity_kes` | The largest KSHS amount one cash-out may send right now that the treasury can back. `null` when not known, which is not `0`; `0` means nothing can be cashed out right now. |

## Agents and USDT

| Key | Meaning |
|---|---|
| `agent_fee_bps`, `agent_fee_cap_kshs` | The agent's fee for cash in or out at a counter, and its cap. |
| `platform_fee_bps`, `platform_fee_cap_kshs` | Kakitu's share of that agent fee, and its cap. Paid inside the agent fee, never on top. |
| `mint_rate_kes_per_usdc`, `mint_spread_bps` | The rate and spread an agent counter prices KSHS at. A decimal string and a number. |
| `agent_min_float_usdc` | The smallest float an agent must hold. |
| `order_expiry_minutes` | How long a quoted agent order holds its price. |
| `agency_mode` | Always `"gated"`. Kept for older app builds that read it. |
| `agent_float_networks` | Chain ids agents can load USDT float on. `[]` while that feature is off. |
| `customer_usdt_networks` | Chain ids a customer can deposit and cash out USDT on, in the Kakitu app. `[]` while that feature is off. |
| `agent_app_url_android`, `agent_app_url_ios` | The Kakitu Agent app's store pages. `""` where there is none. |

## The older ramp

| Key | Meaning |
|---|---|
| `deposit_min_per_order_usd`, `deposit_max_per_order_usd` | The band of the older deposit route, which Kakitu no longer uses. Do not price anything with them. |
| `withdraw_min_per_order_kes`, `withdraw_max_per_order_kes` | The band of the older M-Pesa withdrawal route, which Kakitu no longer uses. Do not price anything with them. |

## The apps

| Key | Meaning |
|---|---|
| `min_supported_build`, `latest_build` | Build numbers for the Kakitu app's update prompt. `0` means none. |
| `store_url_android`, `store_url_ios` | The Kakitu app's store pages. `store_url_ios` is `""` today: the app is not on the App Store. |
| `app` | Which app's release the four keys above describe (`"agent"`, or `""`). |
| `support_phone` | The support line the apps show. `""` when none is set. |
| `directory_bucket_hex`, `directory_max_buckets` | Used by the Kakitu app's contact lookup. Not for integrations. |

## What is not here

`/config` is public, so it deliberately leaves out anything that tells an attacker what to aim at: approval thresholds, daily caps, float levels and the payout switches. Your own payout limits are on [`GET /v1/limits`](./limits).
