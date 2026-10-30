# Docs status report (updated 2026-10-30)

Supersedes the 2026-10-25 rewrite report. Status: on branch `fix/merchant-audit-2026-10-30`,
not pushed (a push to `main` deploys developer.kakitu.org). `npm run build` passes and
`static/openapi.yaml` lints clean with `@redocly/cli@1.25.0`.

## What the site says now

- **Accepting KSHS is the lead.** Intro, quickstart and going-live start from being paid in
  KSHS at your own address (`window.kakitu.pay()`, `kakitu:` links, QR / "Lipa na Kakitu")
  and verifying the `Transfer` on chain. Nothing notifies a merchant of an incoming payment.
- **M-Pesa collections and payouts are stated as not open.** In production
  `merchant_collections_enabled` and `merchant_payouts_enabled` are off: `POST /v1/charges`
  answers `503 rail_unavailable` and the payout-sending routes answer `403`.
- **Credited amount.** A settled charge credits the KSHS minted for it, which is less than
  `amount` (partner fee and mint spread). No credited/fee field exists on the charge yet.
- **Quickstart** generates a 12-word BIP-39 phrase (ethers, `m/44'/60'/0'/0/0`, the same path
  as `Kakitu_wallet_flutter/lib/core/crypto/mnemonic.dart`), so the wallet can be imported
  into the app to cash out. The signer scripts on Authentication are read-only when run.
- **New pages:** Cash out (app import → Withdraw to M-Pesa; profile; band; timing; USDC via the
  extension; payouts API off) and Pricing, limits and settlement (values from `/config` on
  2026-10-30 and server defaults in `settings/settings.go` and `main.go`, with the caveat that
  they change).
- **Spec:** `GET /config` added (`security: []`); per-IP limiter, its `X-RateLimit-*` headers
  and `{"error":"too_many_requests"}` body documented; quote 30/min limit; `profile_required`
  points to `POST /profile`; business name "may" appear in the M-Pesa prompt (it is passed as
  the account-holder name, `charge/service/service.go`); burned reference on a post-rail 503;
  payouts may stay `dispatched`; payout quote and budget are spent before the signature check;
  transfer body > 4 KiB is `400`; `Retry-After` optional on most 429s; `info.license`.

## Known gaps (not docs fixes)

From `MERCHANT_AUDIT_2026-10-30.md`: no "you were paid" webhook or push; `kakitu:` amounts are
in wei and carry no reference; payouts never reach `paid`/`failed`; no `/v1` profile or
cash-out route; SDKs not on any registry; no sandbox, status page or changelog;
`docs.kakitu.org` deep links and the mobile "Developers" link are kakitu.org issues.
