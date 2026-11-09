---
sidebar_position: 4
title: Pricing, limits and settlement
---

# Pricing, limits and settlement

What it costs to be paid in KSHS and to take the money out, how much fits in one go, and how long each step takes.

:::info These numbers change
Every value here is configuration, and an operator can change most of them without a release.
The live ones are published at [`GET https://walletapi.kakitu.org/config`](https://walletapi.kakitu.org/config),
unauthenticated, and that is the source to read in code. The table says which field to read.
Values marked **default** are the server's built-in defaults; production may differ, and they
are not published in `/config`. Figures below were read on 9 November 2026.
:::

## Fees

| What | Who pays | Cost | Where it is published |
|---|---|---|---|
| Being paid in KSHS (`pay()`, `kakitu:` link, QR, any wallet-to-wallet transfer through Kakitu) | Nobody | **Free.** We pay the Base gas. | — |
| Cashing out KSHS to M-Pesa (a number or a till) | You | Our burn spread plus the cash-out partner's charge, shown before you confirm | Spread: 30 bps today (0.30%), not in `/config`. The full fee: a withdrawal [quote](./quotes) or the app's confirm screen |
| Buying KSHS with USDC or M-Pesa | The buyer | The mint spread, plus the partner's charge for M-Pesa | `mint_spread_bps`: **30** (0.30%), and `mint_rate_kes_per_usdc`: **131** |
| Cash in or out at a Kakitu agent | The customer | The agent fee, of which Kakitu's platform fee is a part | `agent_fee_bps` **100** (1%), capped at `agent_fee_cap_kshs` **150**; `platform_fee_bps` **20** (0.20%), capped at `platform_fee_cap_kshs` **30** |
| M-Pesa collections (`POST /v1/charges`) | The merchant | You are credited less than `amount`: the collection partner's fee and the mint spread come off | `fee_kes` and `credited_kes` on the charge and its webhooks, `null` until it is paid. `credited_kes` is `amount` less `fee_kes` |

**The platform fee is not a fee on merchant payments.** `platform_fee_bps` is Kakitu's share of an agent's counter fee, paid inside the agent fee, never on top of it. A payment from a customer's wallet to yours carries no fee at all.

**The cash-out fee is the one you will notice.** Our part is small; the partner's part is a charge for paying out to M-Pesa and weighs more on small amounts. On a typical amount expect a few percent all in. The quote is exact, and an estimate here would not be, so read the quote. See [Cash out](./cash-out#what-it-costs).

## Limits

| Limit | Value today | Read it from |
|---|---|---|
| Largest single KSHS transfer we relay | **KES 50,000** | `relay_max_per_tx_kes` in `/config` |
| Smallest single transfer | KES 1 | — |
| Relayed transfers per sending address per day (UTC) | **50** (**default**) | — |
| Relayed transfers per day, all wallets together | 5,000 (**default**) | — |
| One cash-out to M-Pesa | **KES 20 to KES 33,333** landed | `withdraw_min_per_order_kes`, `withdraw_max_per_order_kes` in `/config`, live from the partner |
| What the treasury can pay out in one cash-out right now | **KSHS 9,045** sent, on 9 November 2026. Moves all day | `cashout_capacity_kes` in `/config`; `null` when not known |
| One purchase of KSHS (deposit), and so one M-Pesa collection | up to **USD 99**, about **KES 13,000** at the current buying rate | `deposit_max_per_order_usd` in `/config` |
| How long a quoted price holds | 10 minutes for agent orders | `order_expiry_minutes` in `/config` |

What these mean for a business:

- **The 50-a-day count is on the sender.** Receiving payments does not use it. Your own cash-outs and transfers from the business wallet do: each is one relayed transfer. A busy shop cashing out many small amounts a day will meet it; cash out fewer, larger amounts.
- **A sale above KES 50,000 is more than one transfer.** The payer's wallet refuses a single transfer over the ceiling (`LIMIT_EXCEEDED` from `pay()`, `amount_above_maximum` from the API).
- **An M-Pesa collection is capped lower: about KES 13,000.** The collection partner's per-order ceiling (`deposit_max_per_order_usd`, USD 99) binds before your own `per_charge_max_kes` (70,000 by default) does, and a charge over it is `amount_above_maximum`. The figure in shillings moves with the buying rate; read the dollar cap.
- **Taking out more than KES 33,333 is several withdrawals**, each priced on its own.
- **The treasury can be the tighter limit.** `cashout_capacity_kes` is the most KSHS one cash-out may send right now that the hot treasury can back. It is in KSHS **sent**, before the fee, while the band above is in shillings **landed**. A cash-out over it is refused at the quote (`treasury_short` in the app, `503 rail_unavailable` from the API), before anything moves. When it is lower than the band, as it was when this page was written, it is the number that binds: try a smaller amount, or later.
- **When the day's relayer budget is spent, every relayed transfer stops** until 00:00 UTC, for everyone. It is sized not to be reached by ordinary trade.

The developer API's own limits — requests per minute, quotes per minute, body sizes, your collection and payout caps — are on [Rate limits](./rate-limits) and [`GET /v1/limits`](./limits).

## Settlement

| Step | How long |
|---|---|
| A KSHS payment to your address | Seconds. A Base block is about two seconds, and the relayer waits for the receipt. Final once mined. |
| A cash-out to M-Pesa | **Usually minutes. Not instant.** Your KSHS moves to the treasury, then a background job funds the partner, then the partner pays M-Pesa. It can wait longer if the hot treasury is short; your shillings are held, not lost. See [Cash out](./cash-out#how-long-it-takes). |
| A cash-out to USDC (browser extension) | Minutes. Refused up front if the treasury cannot pay it. |
| A purchase of KSHS with USDC | After 12 Base confirmations of your USDC (`mint_confirmations`, **default**). |
| An M-Pesa collection | `paid` when the payer approves the prompt, then `settled` once the KSHS is minted to your wallet. Watch [`charge.settled`](./events#chargesettled). |
| An API payout | **Not instant.** `dispatched` once the signed transfer is accepted, then `paid` or `failed` when the partner answers; you are told by [webhook](./events#payoutpaid-and-payoutfailed). |

Reserves backing every KSHS are public at [`GET /reserves`](https://walletapi.kakitu.org/reserves).
