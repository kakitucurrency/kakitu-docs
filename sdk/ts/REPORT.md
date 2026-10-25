# Report: Kakitu TypeScript SDK

## Built
`src/` signing, transport (retry, idempotency), errors, webhooks, client; `test/` 31 tests; README; package.json (exact-pinned deps).

## Verified against the Go source
- Headers and the message format `METHOD path?query ts sha256hex(body)` from auth/wallet.go; EIP-191, v = 27/28.
- Ran `go run ./cmd/kakitu-vectors` and used its output (`test/vectors.json`, public BIP-39 test key). The SDK reproduces every address, message, body hash and signature byte for byte (GET no body, GET query, POST body, POST empty, POST body+query, unicode body).
- All 22 error codes from apiv1/errors.go; merchant shapes from v1_merchant_c.go.

## Surprises in the Go code
1. The clock window is +/-120s (`maxSkew`), not 300s. 300s is only the replay-key TTL.
2. Auth failures use a different envelope: `{"error":"unauthorized","reason":"replay"}`, with a string error and no request_id. The SDK parses both and falls back to the X-Request-Id header.
3. Registration carries no Idempotency-Key (main.go says so), so the SDK sends none there.
4. An identical request in the same second is a replay, so a retry must be re-signed and land in a later second. The transport enforces a strictly increasing timestamp.
5. 429 covers `daily_cap_exceeded` and `payer_velocity_exceeded`, which are not transient. The SDK retries only `rate_limited`.
6. Charge/webhook shapes are unspecified: no /v1/charges route or webhook sender exists. Paths, fields and the webhook scheme are provisional and labelled so.
