/**
 * Error codes from apiv1/errors.go (a closed set; the server never changes a code).
 *
 * The PAYOUT codes are deliberately not the collection ones. `payout_daily_cap_exceeded` is a
 * different budget from `daily_cap_exceeded`, on a different setting and a different counter:
 * asking an operator to raise your collection cap when it is the payout cap that ran out changes
 * nothing. Likewise `payout_amount_above_maximum` is 400, not 429 — no amount of waiting makes
 * that payout acceptable, only a smaller one.
 */
export type ServerErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "merchant_not_registered"
  | "merchant_not_approved"
  | "merchant_suspended"
  | "merchant_name_frozen"
  | "idempotency_key_required"
  | "idempotency_key_invalid"
  | "idempotency_key_reuse"
  | "idempotency_key_in_progress"
  | "idempotency_key_acted"
  | "idempotency_unavailable"
  | "request_too_large"
  | "amount_below_minimum"
  | "amount_above_maximum"
  | "daily_cap_exceeded"
  | "payer_velocity_exceeded"
  | "rate_limited"
  | "charge_not_found"
  | "reference_reused"
  | "rail_unavailable"
  | "order_not_found"
  | "event_not_found"
  | "payouts_disabled"
  | "payout_daily_cap_exceeded"
  | "payout_amount_above_maximum"
  | "payout_not_found"
  | "payout_quote_not_found"
  | "profile_required"
  | "identity_verification_required"
  | "internal";

/** SDK-side additions: "network_error" (no HTTP response) and "unknown" (code not in this SDK's list). */
export type KakituErrorCode = ServerErrorCode | "network_error" | "unknown";

export const SERVER_ERROR_CODES: readonly ServerErrorCode[] = [
  "invalid_request", "unauthorized", "merchant_not_registered", "merchant_not_approved",
  "merchant_suspended", "merchant_name_frozen", "idempotency_key_required", "idempotency_key_invalid",
  "idempotency_key_reuse", "idempotency_key_in_progress", "idempotency_key_acted",
  "idempotency_unavailable", "request_too_large", "amount_below_minimum", "amount_above_maximum",
  "daily_cap_exceeded", "payer_velocity_exceeded", "rate_limited", "charge_not_found",
  "reference_reused", "rail_unavailable", "order_not_found", "event_not_found",
  "payouts_disabled", "payout_daily_cap_exceeded", "payout_amount_above_maximum",
  "payout_not_found", "payout_quote_not_found", "profile_required",
  "identity_verification_required", "internal",
];

export class KakituError extends Error {
  /** Switch on this. Never on `message`, which may be reworded at any time. */
  readonly code: KakituErrorCode;
  /** Quote this to Kakitu support. May be "" for a network error or an auth-layer rejection with no header. */
  readonly requestId: string;
  readonly status: number;
  /** The code string exactly as the server sent it (differs from `code` only when code is "unknown"). */
  readonly rawCode: string;
  /**
   * Auth-layer failures (bad signature, replay, clock skew) do not use the normal envelope; the
   * server sends {"error":"unauthorized","reason":"..."}. The reason lands here:
   * missing_auth_headers, bad_timestamp, timestamp_out_of_range, unreadable_body, bad_signature,
   * replay, auth_unavailable.
   */
  readonly reason?: string;

  constructor(init: {
    code: KakituErrorCode; message: string; requestId: string; status: number; rawCode?: string; reason?: string;
  }) {
    super(init.message);
    this.name = "KakituError";
    this.code = init.code;
    this.requestId = init.requestId;
    this.status = init.status;
    this.rawCode = init.rawCode ?? init.code;
    if (init.reason !== undefined) this.reason = init.reason;
  }
}

const known = new Set<string>(SERVER_ERROR_CODES);

export function errorFromResponse(status: number, headerRequestId: string, text: string): KakituError {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { parsed = undefined; }
  const root = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const err = root["error"];
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    const raw = typeof e["code"] === "string" ? e["code"] : "";
    return new KakituError({
      code: known.has(raw) ? (raw as ServerErrorCode) : "unknown",
      rawCode: raw || "unknown",
      message: typeof e["message"] === "string" ? e["message"] : `HTTP ${status}`,
      requestId: typeof e["request_id"] === "string" && e["request_id"] ? e["request_id"] : headerRequestId,
      status,
    });
  }
  if (typeof err === "string") {
    // auth middleware shape
    const reason = typeof root["reason"] === "string" ? root["reason"] : undefined;
    const raw = err;
    return new KakituError({
      code: known.has(raw) ? (raw as ServerErrorCode) : "unknown",
      rawCode: raw,
      message: reason ? `Authentication failed: ${reason}` : `Authentication failed (HTTP ${status}).`,
      requestId: headerRequestId,
      status,
      ...(reason !== undefined ? { reason } : {}),
    });
  }
  return new KakituError({
    code: status >= 500 ? "internal" : "unknown",
    rawCode: "unknown",
    message: `Unexpected HTTP ${status} response.`,
    requestId: headerRequestId,
    status,
  });
}
