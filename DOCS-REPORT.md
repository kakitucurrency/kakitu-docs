# Docs rewrite report (2026-10-25)

Status: done, not pushed. `npm run build` passes.

Pages: intro, quickstart, authentication, merchants, collections, webhooks, errors, rate-limits, going-live. OpenAPI 3.1 at static/openapi.yaml; Scalar plugin restored at /api-reference.

Collections and webhooks are marked "not yet available". Charge shapes come from the uncommitted v1_charge_c.go draft and charge/service, and are provisional. No webhook delivery code exists, so no payload or signature format is documented.

Signing examples (TypeScript/ethers 6, Python/eth-account, PHP/kornrunner+elliptic-php) were run against the server's own vectors (go run ./cmd/kakitu-vectors): all six cases match byte for byte in all three languages.

Contradictions with the brief/contract (code wins):
- Timestamp window is +-120s (auth/wallet.go maxSkew). 300s is only the replay-record TTL.
- Auth failures are not the v1 envelope: `{"error":"unauthorized","reason":...}` with 7 reasons. Documented.
- CONTRACT.md lists no per-code statuses ("raw" section empty); statuses taken from apiv1/errors.go codeTable.
- Limiter refusals write no charge row (reference stays free); only rail-stage refusals close the reference.
- Platform default limits are config, so not published. 429 body from per-IP limiter unverified.
- The intro names "Nano RPC" and "Daraja" only to describe what was removed.
