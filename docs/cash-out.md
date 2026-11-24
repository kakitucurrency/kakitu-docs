---
sidebar_position: 3
title: Cash out
---

# Cash out

**A business takes its money out the same way a person does: from its own wallet, in the Kakitu app or the Kakitu extension.** There are two ways out:

- **At a Kakitu agent**, for cash. Live today.
- **To your own M-Pesa number.** Kakitu pays M-Pesa itself. This is being switched on: `kes_offramp_enabled` in [`GET /config`](https://walletapi.kakitu.org/config) is `false` until it is, and every route below answers `404 kes_offramp_disabled` until then.

Paying **other people** from a server is the [payouts API](./payouts), which is coming soon.

## Cash out in the app or the extension

Open the business wallet (the one you made in the Kakitu app and restored in the extension, see [the quickstart](./quickstart)) and choose the M-Pesa cash-out. Type the shillings that must land on your phone. The confirm screen shows the fee and the KSHS that will leave the wallet; nothing leaves until you approve.

## Your own number {#your-own-number}

**The money always goes to this wallet's own proved M-Pesa number.** You never type a number for a cash-out, and a program cannot send one: the server reads the number this wallet has proved it owns in the Kakitu app.

- A wallet with no proved number is refused with `403 phone_not_verified`. Prove the number in the Kakitu app first.
- **A number proved less than 24 hours ago cannot receive a cash-out yet** (`403 phone_too_new`, with `retry_after`). The wait protects a wallet whose phone or phrase has been taken: a thief who adds their own number has to wait a day. The 24 hours is set by Kakitu.

## Limits and fees {#limits-and-fees}

| | Today | Read it from |
|---|---|---|
| One cash-out | **KES 100 to KES 20,000** landed | `kes_offramp_min_kes`, `kes_offramp_max_kes` in `/config` |
| Fee | **1%**, at least **KES 10**, on top of the payout | `kes_offramp_fee_bps` (100) and `kes_offramp_fee_min_kes` (10) in `/config` |
| Per wallet, rolling 24 hours | **KES 50,000** | Set by Kakitu |
| Waits for a person's approval | Cash-outs **above KES 10,000** | Set by Kakitu |

The values in `/config` are the live ones; read them rather than hard-coding these. The fee is added on top, so the KSHS that leave your wallet are the payout plus the fee:

```
burn_kshs = payout_kes + fee_kes
```

**Example.** You cash out KES 1,000. The fee is 1% of 1,000, which is 10, and the minimum is also 10, so `fee_kes` is 10. **KSHS 1,010 leave the wallet** and KES 1,000 land on your M-Pesa. The wallet must hold the whole 1,010: short of it, the quote is refused with `insufficient_balance`, which says what you have and what you need.

Each cash-out is also one gasless transfer from your wallet, so it counts against the **50 relayed transfers a day** each address gets. See [Pricing, limits and settlement](./pricing).

## What happens {#what-happens}

1. **Quote.** The app asks for a price (`POST /ramp/kes/quote` with `amount_kes`). The answer has `payout_kes`, `fee_kes`, `burn_kshs`, the masked number it will pay, whether it `needs_approval`, and when it expires.
2. **Confirm.** You approve, and the wallet signs one gasless transfer of `burn_kshs` to Kakitu's treasury (`POST /ramp/kes`).
3. **Payout.** Kakitu pays your M-Pesa number. A cash-out above KES 10,000 waits for a person's approval first (`awaiting_approval`).
4. **Burn.** Only after the M-Pesa payout is final are the KSHS burned. **A payout that cannot be made sends back the whole `burn_kshs`, fee included**, and the refund's transaction hash is on the order.

The app shows the order as it moves: `processing`, `awaiting_approval`, `paid` (with the M-Pesa code), `refunding`, `refunded`, `failed` or `checking`. **`processing` and `checking` mean your KSHS have left the wallet and the payout is under way or being looked at: do not send it again.** `failed` is only ever shown when nothing left your wallet. If an order is still not `paid` after an hour, write to kakitu@kakitu.org with the reference the app shows.

Kakitu can pause cash-outs for a while (`409 kes_offramp_paused`, nothing taken), and refuses a quote it cannot pay right now (`503 payout_unavailable`, nothing taken; try later or a smaller amount). Every code is on the [Errors](./errors#wallet-cash-out-codes) page.

## Locked merchants {#locked-merchants}

A merchant that has [locked itself to its saved payout destinations](./payouts#saved-destinations-and-the-lock) is refused with `403 destination_locked`, because its own phone is not one of those destinations. Lift the lock with `POST /v1/payout-destinations/lock` and `{"locked": false}`; it takes effect after `payout_cooling_off_hours`, and then the cash-out works.

## Agents

An agent wallet cashes out in the Kakitu Agent app, under the agent rules. Here it is refused with `403 use_agent_cashout`.

## USDC instead of M-Pesa

The Kakitu **browser extension** can also cash out to **USDC on Base**, to an address you name ("Cash out to USDC"). The treasury's balance is checked before your shillings are taken, so a short treasury refuses the order rather than holding it. A Base address is final and nothing can reverse a payment to the wrong one; double-check it. The phone app does not offer this. The extension is on the [Chrome Web Store](https://chromewebstore.google.com/detail/ebcjlgfjbbgoldipdhbcmciebdiadifg); see [the extension page](./extension).
