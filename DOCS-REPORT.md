# Docs status report (updated 2026-11-09)

Supersedes the 2026-10-30 report. Branch `docs/accuracy-2026-11-09`, off `main` (3f4a18b). Not
pushed: a push to `main` deploys developer.kakitu.org.

Checked against the server exactly as deployed (`feat/kakitu-score` 073fb30 == `origin/eth` ==
production), the live settings and `GET /config` read on 2026-11-09, and that morning's boot log.
`npm run build` passes, `static/openapi.yaml` lints clean with `@redocly/cli@1.25.0`, and
`KAKITU_SERVER_DIR=<server> npm run check-docs` passes against 073fb30.

## What the site says now

- **Collections are on for approved merchants.** `merchant_collections_enabled` has been true
  since 2026-10-30. Pages give today's platform caps with their date (100,000 KES a day, 70,000 a
  charge, 30 charges a minute, 5 prompts per payer per merchant, 3 merchants per payer, EAT days)
  and say the partner's per-order ceiling (`deposit_max_per_order_usd`, USD 99, about KES 13,000)
  binds first.
- **Payouts: platform switch on, per-merchant switch off by default.** Caps today: 20,000 a
  payout, 50,000 a day, hold above 20,000. Because hold = max, approve-first only applies after
  an operator raises a merchant's per-payout maximum; the Payouts page says so.
- **Being paid in KSHS at your own address** stays the lead, with `transfer.received` for
  approved merchants.
- **Cash out:** an M-Pesa number or a till from the app. Paybill and bank cash-outs from the app
  are closed (allowlists empty); merchants reach them through payouts and saved destinations.
  `cashout_capacity_kes` (KSHS 9,045 on 2026-11-09) is documented as the tighter live limit, and
  a short treasury is refused at the quote.
- **Charge 503s:** a `503 rail_unavailable` on `POST /v1/charges` always means nobody was
  prompted; it may or may not have closed the reference. An unknown outcome is
  `409 idempotency_key_acted`.
- **`business_name` is not sent with the M-Pesa prompt** (the one collection rail ignores the
  account-holder name). The "payer may see it" claim is gone from pages, spec and sign-up.
- **Forty-four error codes:** `open_loan` (409, registration with an open loan) and
  `account_blocked` (403, operator block or cash-out hold) added to the docs, spec and all three
  SDKs.
- **Spec 0.4.0:** `cashout_capacity_kes` in `PublicConfig`, `fee_kes`/`credited_kes` described as
  present on charges, the new codes on the routes that answer them.

## Known gaps and server issues found (not docs fixes)

- `POST /v1/quotes` with a `paybill` withdrawal answers **500 internal** for every wallet:
  `ramp.ErrBankNotAllowed` is not mapped in `controller/v1_read_c.go` `v1FailQuote`. The docs
  say paybill quotes are refused and not to offer them.
- The boot log says the developer API has "twelve routes"; it has twenty-one
  (`main.go` `logDeveloperAPI`).
- With platform defaults, `merchant_payout_hold_above_kes` equals `merchant_payout_max_kes`
  (both 20,000), so the held-payout queue cannot be reached without a per-merchant raise.
- Not knowable from code and config, so left general: production values of the env-only knobs
  (`RELAY_MAX_PER_ADDRESS_PER_DAY`, `RELAY_MAX_PER_DAY`, `V1_TRANSFERS_MAX_PER_HOUR`,
  `RATE_LIMIT_PER_MINUTE`); the docs quote their code defaults and mark them as defaults. How
  long a charge takes from `paid` to `settled` is not stated as a number.
- From the 2026-10-30 audit, still open: `kakitu:` amounts are in wei; no `/v1` profile or
  cash-out route; SDKs not on any registry; no sandbox, status page or changelog.
- The PHP SDK's tests were not run on this machine (no `php`); TypeScript (62) and Python (72)
  pass.
