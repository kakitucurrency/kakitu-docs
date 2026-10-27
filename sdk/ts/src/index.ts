import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { Transport, type KakituOptions, type RequestSpec } from "./transport.js";
import { autoPaginate, type Page, type PageParams } from "./pagination.js";
import type {
  Balances, Charge, CreateChargeParams, CreatePayoutParams, CreatePayoutQuoteParams,
  CreateQuoteParams, EIP712Domain, Event, EventStatus, EventType, Limits, ListChargesParams,
  ListEventsParams, ListPayoutsParams, Merchant, MerchantState, Order, OrderStatus, Payout,
  PayoutBeneficiary, PayoutLimits, PayoutQuote, PayoutState, Quote, QuoteBeneficiary,
  RegisterMerchantParams, SignedTransfer, Transfer, WithdrawalBand, ChargeStatus,
} from "./types.js";

export { KakituError, SERVER_ERROR_CODES, type KakituErrorCode, type ServerErrorCode } from "./errors.js";
export { verifyWebhookSignature } from "./webhooks.js";
export { DEFAULT_BASE_URL, type KakituOptions } from "./transport.js";
export { autoPaginate, type Page, type PageParams } from "./pagination.js";
export type {
  Balances, Charge, ChargeStatus, CreateChargeParams, CreatePayoutParams, CreatePayoutQuoteParams,
  CreateQuoteParams, EIP712Domain, Event, EventStatus, EventType, Limits, ListChargesParams,
  ListEventsParams, ListPayoutsParams, Merchant, MerchantState, Order, OrderStatus, Payout,
  PayoutBeneficiary, PayoutLimits, PayoutQuote, PayoutState, Quote, QuoteBeneficiary,
  RegisterMerchantParams, SignedTransfer, Transfer, WithdrawalBand,
} from "./types.js";

export interface RequestOptions {
  /**
   * Supply your own Idempotency-Key to retry safely across process restarts. Reuse the SAME key
   * to repeat the SAME request; use a new key for a new one. Max 255 chars.
   *
   * It is accepted only on the three methods the server requires a key for — `charges.create`,
   * `transfers.create` and `payouts.create`. The server refuses to even look at one on
   * `quotes.create`, `payouts.quote` or `events.replay`, so this SDK never sends one there.
   */
  idempotencyKey?: string;
}

/** Drops undefined entries so an omitted filter is not sent as "undefined". */
function query(p?: object): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(p ?? {})) {
    if (v !== undefined && v !== null) out[k] = v as string | number | boolean;
  }
  return out;
}

export class Kakitu {
  readonly #t: Transport;

  readonly merchants: {
    register(params: RegisterMerchantParams): Promise<Merchant>;
    me(): Promise<Merchant>;
  };

  /**
   * Charges: an M-Pesa prompt on a payer's phone, settled to your wallet.
   *
   * `create` REQUIRES an Idempotency-Key and this SDK generates one (a fresh UUID) unless you
   * pass your own. Pass your own, derived from your order id and stored, if you want a retry
   * after a crash or a process restart to be safe — the generated one lives only in memory.
   */
  readonly charges: {
    create(params: CreateChargeParams, opts?: RequestOptions): Promise<Charge>;
    get(id: string): Promise<Charge>;
    list(params?: ListChargesParams): Promise<Page<Charge>>;
    /** Walks every page, yielding charges. See {@link autoPaginate}. */
    listAll(params?: Omit<ListChargesParams, "cursor">): AsyncGenerator<Charge, void, undefined>;
  };

  /**
   * Gasless transfers of KSHS.
   *
   * **This SDK does NOT sign the transfer.** `v/r/s` is an EIP-2612 permit signature and
   * `iv/ir/is` an EIP-712 `Relay(owner,to,value,deadline,nonce)` intent signature, and you
   * produce BOTH with your own wallet key before calling this. Kakitu holds no keys, signs
   * nothing on your behalf, and never decides who pays whom; it only pays the gas. The
   * `X-Kakitu-Signature` this SDK does add authenticates the HTTP request and authorises
   * nothing on chain — the two are unrelated.
   */
  readonly transfers: {
    create(transfer: SignedTransfer, opts?: RequestOptions): Promise<Transfer>;
  };

  /** Your own KSHS and USDC balances on Base. */
  readonly balances: {
    retrieve(): Promise<Balances>;
  };

  /** Your own ramp orders (deposits and withdrawals). */
  readonly orders: {
    get(id: string): Promise<Order>;
  };

  /** The withdrawal band, and — for a merchant — your own payout limits. */
  readonly limits: {
    retrieve(): Promise<Limits>;
  };

  /**
   * Prices. A quote creates nothing and moves no money, so the server takes NO Idempotency-Key
   * here and this SDK sends none.
   */
  readonly quotes: {
    create(params: CreateQuoteParams): Promise<Quote>;
  };

  /**
   * Webhook deliveries: what we sent, where it stands, and a way to ask for it again.
   *
   * `replay` takes NO Idempotency-Key — it is idempotent by construction, since requeuing an
   * already-requeued event sets the same row to the same state — and answers HTTP 202: nothing
   * has been delivered when it returns.
   */
  readonly events: {
    list(params?: ListEventsParams): Promise<Page<Event>>;
    /** Walks every page, yielding events. */
    listAll(params?: Omit<ListEventsParams, "cursor">): AsyncGenerator<Event, void, undefined>;
    replay(id: string): Promise<Event>;
  };

  /**
   * Merchant payouts: sending KES to somebody else.
   *
   * Two steps, and they are not interchangeable. `quote` mints a SINGLE-USE quote id and tells
   * you exactly what to sign; `create` spends it. A quote from `quotes.create` is not one of
   * these and is refused here.
   *
   * **This SDK does NOT sign the payout.** `create` takes the transfer you signed with your own
   * key under the two EIP-712 domains the quote published. See {@link Kakitu.transfers}.
   *
   * A payout over your `hold_above_kes` (see `limits.retrieve`) comes back `held`, NOT sent, for
   * a person to review. That is a normal outcome, not an error: poll `payouts.get` for where it
   * ends up.
   */
  readonly payouts: {
    quote(params: CreatePayoutQuoteParams): Promise<PayoutQuote>;
    create(params: CreatePayoutParams, opts?: RequestOptions): Promise<Payout>;
    get(id: string): Promise<Payout>;
    list(params?: ListPayoutsParams): Promise<Page<Payout>>;
    /** Walks every page, yielding payouts. */
    listAll(params?: Omit<ListPayoutsParams, "cursor">): AsyncGenerator<Payout, void, undefined>;
  };

  constructor(options: KakituOptions) {
    this.#t = new Transport(options);
    const t = this.#t;
    const get = <T>(path: string, params?: object): Promise<T> =>
      t.request<T>({ method: "GET", path, query: query(params), safeToRetry: true });
    const postWithKey = <T>(path: string, body: unknown, opts?: RequestOptions): Promise<T> =>
      t.request<T>({
        method: "POST", path, body,
        idempotencyKey: opts?.idempotencyKey ?? randomUUID(), safeToRetry: true,
      });
    // No key: the server mounts no idempotency middleware on these routes.
    const postNoKey = <T>(path: string, body?: unknown): Promise<T> => {
      const spec: RequestSpec = { method: "POST", path, safeToRetry: true };
      if (body !== undefined) spec.body = body;
      return t.request<T>(spec);
    };

    this.merchants = {
      // Registration is an upsert and the server mounts no Idempotency-Key on it, so none is sent.
      register: (p) => postNoKey<Merchant>("/v1/merchants", p),
      me: () => get<Merchant>("/v1/merchants/me"),
    };

    this.charges = {
      create: (p, o) => postWithKey<Charge>("/v1/charges", p, o),
      get: (id) => get<Charge>(`/v1/charges/${encodeURIComponent(id)}`),
      list: (p) => get<Page<Charge>>("/v1/charges", p),
      listAll: (p) => autoPaginate<Charge>((cursor) => get<Page<Charge>>("/v1/charges", { ...p, cursor })),
    };

    this.transfers = {
      create: (transfer, o) => postWithKey<Transfer>("/v1/transfers", transfer, o),
    };

    this.balances = { retrieve: () => get<Balances>("/v1/balances") };

    this.orders = { get: (id) => get<Order>(`/v1/orders/${encodeURIComponent(id)}`) };

    this.limits = { retrieve: () => get<Limits>("/v1/limits") };

    this.quotes = { create: (p) => postNoKey<Quote>("/v1/quotes", p) };

    this.events = {
      list: (p) => get<Page<Event>>("/v1/events", p),
      listAll: (p) => autoPaginate<Event>((cursor) => get<Page<Event>>("/v1/events", { ...p, cursor })),
      replay: (id) => postNoKey<Event>(`/v1/events/${encodeURIComponent(id)}/replay`),
    };

    this.payouts = {
      quote: (p) => postNoKey<PayoutQuote>("/v1/payouts/quote", p),
      create: (p, o) => postWithKey<Payout>("/v1/payouts", p, o),
      get: (id) => get<Payout>(`/v1/payouts/${encodeURIComponent(id)}`),
      list: (p) => get<Page<Payout>>("/v1/payouts", p),
      listAll: (p) => autoPaginate<Payout>((cursor) => get<Page<Payout>>("/v1/payouts", { ...p, cursor })),
    };
  }

  /** The wallet address your key signs as (your merchant identity). Safe to log. */
  get address(): string { return this.#t.address; }

  toJSON() { return { address: this.address, baseUrl: this.#t.baseUrl }; }
  [inspect.custom]() { return `Kakitu { address: ${this.address} }`; }
}
