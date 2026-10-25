import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { Transport, type KakituOptions } from "./transport.js";

export { KakituError, SERVER_ERROR_CODES, type KakituErrorCode, type ServerErrorCode } from "./errors.js";
export { verifyWebhookSignature } from "./webhooks.js";
export { DEFAULT_BASE_URL, type KakituOptions } from "./transport.js";

export type MerchantState = string; // server returns pending | approved | suspended | rejected (not an enumerated contract)

/** GET /v1/merchants/me and POST /v1/merchants answer with this (controller/v1_merchant_c.go merchantView). */
export interface Merchant {
  address: string;
  business_name: string;
  contact_email: string;
  contact_phone: string;
  callback_url: string;
  state: MerchantState;
  daily_cap_kes: number;
  per_charge_max_kes: number;
}

export interface RegisterMerchantParams {
  business_name: string;
  contact_email: string;
  /** Omit to keep the stored value; "" clears it. */
  contact_phone?: string;
  /** Omit to keep the stored value; "" clears it. */
  callback_url?: string;
}

/**
 * NOT YET AVAILABLE. The /v1/charges endpoints are being written and are not deployed. The
 * paths and field names below are PROVISIONAL (inferred from charge/service and dbmodels.Charge);
 * calls will fail until the server ships them, and the shapes may change.
 */
export interface Charge {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  status: "pending" | "prompted" | "paid" | "settled" | "failed" | "expired" | "cancelled";
  paid_at: string | null;
  settled_at: string | null;
}
/** NOT YET AVAILABLE. See {@link Charge}. */
export interface CreateChargeParams {
  /** Whole KES. */
  amount: number;
  /** Payer's Kenyan mobile number. */
  phone: string;
  /** Your own unique reference, 1-128 chars. Reusing one gives `reference_reused`. */
  reference: string;
}
/** NOT YET AVAILABLE. See {@link Charge}. */
export interface ListChargesParams { limit?: number; cursor?: string; status?: Charge["status"] }

export interface RequestOptions {
  /**
   * Supply your own Idempotency-Key to retry safely across process restarts. Reuse the SAME key
   * to repeat the SAME request; use a new key for a new one. Max 255 chars.
   */
  idempotencyKey?: string;
}

export class Kakitu {
  readonly #t: Transport;
  readonly merchants: {
    register(params: RegisterMerchantParams): Promise<Merchant>;
    me(): Promise<Merchant>;
  };
  /**
   * NOT YET AVAILABLE: the server endpoints behind `charges.*` are still being written. Do not
   * build on these yet. Paths (/v1/charges, /v1/charges/{id}) and shapes are provisional.
   */
  readonly charges: {
    create(params: CreateChargeParams, opts?: RequestOptions): Promise<Charge>;
    get(id: string): Promise<Charge>;
    list(params?: ListChargesParams): Promise<{ data: Charge[]; next_cursor?: string }>;
  };

  constructor(options: KakituOptions) {
    this.#t = new Transport(options);
    const t = this.#t;
    this.merchants = {
      // Registration is an upsert and the server mounts no Idempotency-Key on it, so none is sent.
      register: (p) => t.request<Merchant>({ method: "POST", path: "/v1/merchants", body: p, safeToRetry: true }),
      me: () => t.request<Merchant>({ method: "GET", path: "/v1/merchants/me", safeToRetry: true }),
    };
    this.charges = {
      create: (p, o) =>
        t.request<Charge>({
          method: "POST", path: "/v1/charges", body: p,
          idempotencyKey: o?.idempotencyKey ?? randomUUID(), safeToRetry: true,
        }),
      get: (id) => t.request<Charge>({ method: "GET", path: `/v1/charges/${encodeURIComponent(id)}`, safeToRetry: true }),
      list: (p) =>
        t.request({ method: "GET", path: "/v1/charges", ...(p ? { query: { ...p } } : {}), safeToRetry: true }),
    };
  }

  /** The wallet address your key signs as (your merchant identity). Safe to log. */
  get address(): string { return this.#t.address; }

  toJSON() { return { address: this.address, baseUrl: this.#t.baseUrl }; }
  [inspect.custom]() { return `Kakitu { address: ${this.address} }`; }
}
