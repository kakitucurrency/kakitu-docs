---
sidebar_position: 4
title: Pricing, limits and settlement
---

# Pricing, limits and settlement

What it costs to be paid in KSHS and to take the money out, how much fits in one go, and how long each step takes.

:::info These numbers change
Every value here is configuration, and Kakitu can change most of them without a release.
The live ones are published at [`GET https://walletapi.kakitu.org/config`](https://walletapi.kakitu.org/config),
unauthenticated, and that is the source to read in code. The table says which field to read.
Values marked **default** are the server's built-in defaults; production may differ, and they
are not published in `/config`.
:::

## Fees

| What | Who pays | Cost | Where it is published |
|---|---|---|---|
| Being paid in KSHS (`pay()`, the Lipa na Kakitu button, `kakitu:` link, QR, any wallet-to-wallet transfer through Kakitu) | Nobody | **Free.** We pay the Base gas. | — |
| [Cash-out](./cash-out) to your own M-Pesa number (**not available today**: M-Pesa is hidden) | You | **1%**, at least **KES 10**, added on top of the payout | `kes_offramp_fee_bps` **100** and `kes_offramp_fee_min_kes` **10** in `/config` |
| Cash in or out at a Kakitu agent | The customer | The agent fee, of which Kakitu's platform fee is a part | `agent_fee_bps` **100** (1%), capped at `agent_fee_cap_kshs` **150**; `platform_fee_bps` **20** (0.20%), capped at `platform_fee_cap_kshs` **30** |
| [Collections](./collections) (`POST /v1/charges`) | — | **Not open for integration.** Planned as a KSHS payment request. | — |
| [Payouts](./payouts) to other people | — | **Not open for integration.** Planned to come back, paid through KCB. | — |

**The platform fee is not a fee on merchant payments.** `platform_fee_bps` is Kakitu's share of an agent's counter fee, paid inside the agent fee, never on top of it. A payment from a customer's wallet to yours carries no fee at all.

**The cash-out fee is on top.** Cash out KES 1,000 and KSHS 1,010 leave your wallet: KES 1,000 land on your M-Pesa and 10 is the fee. See [Cash out](./cash-out#limits-and-fees).

## Limits

| Limit | Value today | Read it from |
|---|---|---|
| Largest single KSHS transfer we relay | **KES 50,000** | `relay_max_per_tx_kes` in `/config` |
| Smallest single transfer | KES 1 | — |
| Relayed transfers per sending address per day (UTC) | **50** (**default**) | — |
| Relayed transfers per day, all wallets together | 5,000 (**default**) | — |
| Of those, relayed transfers per day from wallets that have never brought money in (not an agent, never received newly minted KSHS, never settled an agent order) | 15% of the daily total: 750 (**default**) | — |
| One cash-out to your own M-Pesa number | **KES 100 to KES 20,000** landed | `kes_offramp_min_kes`, `kes_offramp_max_kes` in `/config` |
| Cash-outs per wallet, rolling 24 hours | **KES 50,000** | Set by Kakitu |
| How long a quoted price holds | 10 minutes for agent orders | `order_expiry_minutes` in `/config` |

What these mean for a business:

- **The 50-a-day count is on the sender.** Receiving payments does not use it. Your own cash-outs and transfers from the business wallet do: each is one relayed transfer. Cash out fewer, larger amounts.
- **A sale above KES 50,000 is more than one transfer.** The payer's wallet refuses a single transfer over the ceiling (`LIMIT_EXCEEDED` from `pay()`, `amount_above_maximum` from the API).
- **Taking out more than KES 20,000 is several cash-outs**, each priced on its own, up to KES 50,000 in 24 hours.
- **When the day's relayer budget is spent, every relayed transfer stops** until 00:00 UTC, for everyone. It is sized not to be reached by ordinary trade. Wallets that have never brought money in share a smaller lane inside it; when that lane is full, only they are refused until 00:00 UTC. Either refusal is `503 rail_unavailable` from the API and `RELAY_UNAVAILABLE` from `pay()`.

The developer API's own limits — requests per minute and body sizes — are on [Rate limits](./rate-limits) and [`GET /v1/limits`](./limits).

## Settlement

| Step | How long |
|---|---|
| A KSHS payment to your address | Seconds. The relayer waits for the receipt. Final once mined. |
| A cash-out to your own M-Pesa number | **Minutes**, and after a person's approval above KES 10,000. Your KSHS go to the treasury, Kakitu pays M-Pesa, and the KSHS are burned only once the payout is final. A payout that cannot be made is refunded in full. See [Cash out](./cash-out#what-happens). |
| A cash-out to USDC (browser extension) | Minutes. Refused up front if the treasury cannot pay it. |
| Cash at a Kakitu agent | At the counter. |

Reserves backing every KSHS are public at [`GET /reserves`](https://walletapi.kakitu.org/reserves).
