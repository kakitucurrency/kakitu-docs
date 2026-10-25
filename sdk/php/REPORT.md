# PHP SDK report

## Built
`composer.json` (PSR-4 `Kakitu\`, PHP >=8.1), `src/` (Kakitu client, Signer, Webhook, ErrorCode, Resources\Merchants / Charges, 10 typed exceptions + ErrorFactory, Transport (cURL, swappable)), `tests/` (43 tests, 166 assertions), README, this report.

## Verified against the Go source
- Headers, message format `"{METHOD} {path}{?query} {ts} {sha256hex(body)}"`, empty-body hash, query only when non-empty (auth/wallet.go).
- Ran `go run ./cmd/kakitu-vectors` in the worktree: the PHP signer's output is byte-identical to the Go server's signatures for all six vectors (GET no body, GET query, POST body, POST empty body, POST body+query, UTF-8 body). Same address derived (0x9858...Da94). These are pinned in SignerTest. Key used is the public BIP-39 "abandon" test key.
- Error envelope and all 22 codes (apiv1/errors.go); every code is mapped and tested to a typed exception.
- Merchant endpoints, request fields, view fields (controller/v1_merchant_c.go).
- Ran suite on PHP 8.1.23 and 8.5.8: green.

## Surprises / deviations
1. **Skew window is 120s, not 300s.** wallet.go: `maxSkew = 120s`; 300s is only the replay-key TTL. README says ~2 minutes.
2. **Auth failures do NOT use the envelope.** The auth middleware answers `{"error":"unauthorized","reason":"..."}` (error is a string, no request_id). ErrorFactory handles both; `reason` is exposed on the exception.
3. **Retries would be replay-rejected.** Identical request in the same second is refused, so retries must re-sign. Signer bumps the timestamp +1s when it has already signed the identical request at that second.
4. **429 is not always retryable.** `daily_cap_exceeded` and `payer_velocity_exceeded` are 429 but are policy limits; only `rate_limited` is retried. Deliberate deviation from "retry 429".
5. Idempotency-Key is sent on ALL POSTs, not only money-moving ones: the idempotency middleware refuses any POST without one, and it may wrap /v1/merchants.
6. Network errors are also retried (safe: key reused).
7. **Webhook scheme is not in code yet.** Only the plan (task 10) defines it: `t=<unix>,v1=<hex hmac "t.body">`; header name undecided. Implemented as provisional, caller passes the header value. Must be re-checked when webhookout ships.
8. **Charges**: no controller exists. Routes/filters follow the plan only; params pass through untouched. Marked NOT YET AVAILABLE everywhere. `create` field names (amount, phone, reference) are provisional (Charge JSON uses `amount`; service uses AmountKES/Phone/Reference).
9. CONTRACT.md lacks the codeTable statuses (blank section); errors.go was used instead.
10. PHP/Composer were not installed; I used static PHP builds in the scratchpad (outside the repo) to run tests.
