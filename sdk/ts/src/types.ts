/**
 * The wire shapes of the Kakitu developer API, taken field by field from the server's own view
 * structs (controller/v1_*.go). Timestamps are RFC 3339 strings exactly as the server sends them.
 *
 * Amounts in KES are whole shillings and arrive as JSON numbers. Amounts in wei, and the USDC
 * balance, arrive as STRINGS and must stay strings: they do not fit a JavaScript number without
 * loss, and a rounded value_wei is a signature that will not verify.
 */

import type { PageParams } from "./pagination.js";

// ---------------------------------------------------------------- merchants

export type MerchantState = string; // server returns pending | approved | suspended | rejected (not an enumerated contract)

/** GET /v1/merchants/me and POST /v1/merchants answer with this (controller/v1_merchant_c.go). */
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

// ------------------------------------------------------------------ charges

export type ChargeStatus =
  | "pending" | "prompted" | "paid" | "settled" | "failed" | "expired" | "cancelled";

/** A charge (controller/v1_charge_c.go chargeView). `amount` is whole KES. */
export interface Charge {
  id: string;
  reference: string;
  amount: number;
  currency: string;
  status: ChargeStatus;
  created_at: string;
  paid_at: string | null;
  settled_at: string | null;
}

export interface CreateChargeParams {
  /** Whole KES. */
  amount: number;
  /** Payer's Kenyan mobile number. */
  phone: string;
  /** Your own unique reference, 1-128 chars. Reusing one gives `reference_reused`. */
  reference: string;
}

export interface ListChargesParams extends PageParams {
  status?: ChargeStatus;
  reference?: string;
  /** RFC 3339, e.g. "2026-10-25T00:00:00Z". */
  created_after?: string;
}

// ---------------------------------------------------------------- transfers

/**
 * A transfer YOU have already signed with your own wallet key.
 *
 * Kakitu holds no keys and signs nothing on your behalf. This SDK does not and cannot produce
 * `v/r/s` or `iv/ir/is`; it carries them. See {@link Kakitu.transfers}.
 */
export interface SignedTransfer {
  /** Your own wallet address. The server refuses a transfer whose `from` is not the caller. */
  from: string;
  /** The recipient's address. */
  to: string;
  /** Amount in wei, as a decimal string. Never a number: 1e21 wei does not survive a float. */
  value_wei: string;
  /** Unix seconds. Must be in the future when the server sees it. */
  deadline: number;
  /** EIP-2612 permit signature (spender = the forwarder), signed under the TOKEN's domain. */
  v: number;
  r: string;
  s: string;
  /** EIP-712 `Relay(owner,to,value,deadline,nonce)` intent signature, under the FORWARDER's domain. */
  iv: number;
  ir: string;
  is: string;
  /**
   * Your note on this payment, such as an order number: 1 to 64 characters from `[A-Za-z0-9._:-]`.
   * It is not signed. The payee reads it on `GET /transfers` and in `transfer.received`. It is
   * the PAYER's claim and not proof of anything: the payee still checks amount and recipient.
   * Omit it when there is none.
   */
  reference?: string;
}

/** POST /v1/transfers answers with this. `id` is the transaction hash. */
export interface Transfer {
  id: string;
  /** "confirmed" when the chain already has it (HTTP 200); "pending" when it is in flight (202). */
  status: "pending" | "confirmed";
}

// ----------------------------------------------------------------- balances

export interface Balances {
  /** KSHS, in whole shillings, on Base. */
  kshs: { amount_kes: number; network: string };
  /** USDC on Base. A decimal STRING, not a number. */
  usdc: { amount: string; network: string };
}

// ------------------------------------------------------------------- orders

/**
 * The closed, public set of order statuses. The server collapses its internal pipeline steps to
 * these, and anything it has no mapping for arrives as "processing" — so a new internal step can
 * never leak a pipeline word into your switch.
 */
export type OrderStatus =
  | "awaiting_payment" | "completed" | "failed" | "refunding" | "refunded" | "processing";

/** A ramp order (GET /v1/orders/{id}). */
export interface Order {
  id: string;
  type: "deposit" | "withdrawal";
  status: OrderStatus;
  /** Deposit: shillings paid in. Withdrawal: KSHS sent. */
  amount_kes: number;
  /** Deposit: KSHS received. Withdrawal: shillings paid out. */
  receive_kes: number;
  fee_kes: number;
  created_at: string;
  /** Present only while the order is awaiting payment. */
  expires_at?: string;
}

// ------------------------------------------------------------------- limits

export interface WithdrawalBand {
  min_kes: number;
  max_kes: number;
  /** "live" when read from the payout route, "estimated" when it is the configured fallback. */
  source: "live" | "estimated";
}

/**
 * Your own payout governance. Present only for a caller that is a registered merchant.
 *
 * `hold_above_kes` is the one to act on: a payout above it is ACCEPTED and held for a person to
 * review, which is a normal outcome and not an error. Knowing the number lets you warn before
 * asking someone to sign, rather than after.
 *
 * `enabled` is one fact, not two: whether it is the global switch or your own that is off is not
 * published, deliberately.
 */
export interface PayoutLimits {
  enabled: boolean;
  max_kes: number;
  daily_cap_kes: number;
  hold_above_kes: number;
  /** A snapshot, and `null` when the counter could not be read — which does NOT mean zero. */
  remaining_today_kes: number | null;
  note: string;
}

export interface Limits {
  withdrawal: WithdrawalBand;
  /** Merchants only. Absent for an ordinary wallet. */
  payout?: PayoutLimits;
  /** How far behind the provider the withdrawal band can be. */
  max_staleness_seconds: number;
  note: string;
}

// ------------------------------------------------------------------- quotes

export interface QuoteBeneficiary {
  channel: string;
  number: string;
  reference?: string;
}

export type CreateQuoteParams =
  | { type: "deposit"; amount_kes: number; phone?: string }
  | { type: "withdrawal"; amount_kes: number; beneficiary: QuoteBeneficiary };

/**
 * A price, and nothing else: no id, no rail, no treasury address. A quote creates no order and
 * moves no money, which is why it takes no Idempotency-Key.
 *
 * To price and then SEND a merchant payout, use `payouts.quote` — that one mints a single-use
 * quote id, and it is the only thing `payouts.create` accepts.
 */
export interface Quote {
  type: "deposit" | "withdrawal";
  /** Deposit only: what the payer is asked for. */
  pay_kes?: number;
  /** Withdrawal only: the KSHS that would be sent. */
  send_kes?: number;
  receive_kes: number;
  fee_kes: number;
  /** A decimal string. */
  rate_kes_per_usdc: string;
  expires_at: string;
}

// ------------------------------------------------------------------- events

/**
 * Every type the server raises, in the order the Events page lists them. `EventType` is derived
 * from this, so a type cannot be in one and not the other.
 *
 * `payout_destination.*` and `payout_lock.changed` are about your OWN payout controls: if you did
 * not make the change, somebody else holds your key.
 */
export const EVENT_TYPES = [
  "charge.paid", "charge.settled", "charge.failed",
  "transfer.received",
  "payout.approved", "payout.rejected", "payout.expired", "payout.cancelled", "payout.paid", "payout.failed",
  "payout_destination.added", "payout_destination.removed", "payout_lock.changed",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export type EventStatus = "pending" | "delivered" | "abandoned";

/**
 * One webhook delivery: what we sent (or will send), where it stands, and why the last attempt
 * failed.
 *
 * Delivery is AT-LEAST-ONCE. `id` is stable across every attempt and across a replay, and it is
 * your dedupe key — a receiver that keys on it sees exactly-once; one that does not double-counts.
 *
 * Exactly one of `charge_id` and `payout_id` is set. `last_error` is from a closed vocabulary
 * (`http_503`, `timeout`, `no_callback_url`, ...), never a raw error string.
 */
export interface Event {
  id: string;
  type: EventType;
  charge_id: string | null;
  payout_id: string | null;
  created_at: string;
  status: EventStatus;
  attempts: number;
  /** Only meaningful, and only set, while `status` is "pending". */
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  delivered_at: string | null;
  last_error?: string;
  /** The signed body verbatim, as JSON (not a string). */
  payload: unknown;
}

export interface ListEventsParams extends PageParams {
  type?: EventType;
  status?: EventStatus;
  charge_id?: string;
}

// ------------------------------------------------------------------ payouts

/**
 * The ten payout states (models/dbmodels/payout.go). `paid`, `failed`, `cancelled`, `rejected` and
 * `expired` are all terminal: a retry is a NEW payout, never this one moving again.
 *
 *     pending_approval ──► approved ──► (you sign) ──► dispatched ──► paid
 *            │                │                              └─────► failed
 *            └──► rejected ◄──┤
 *                             └──► expired
 *
 *     quoted ──► held ──► dispatched      (a payout at or below your hold threshold)
 *        │         ├──► cancelled
 *        └─► expired └──► expired
 *
 * A payout ABOVE `hold_above_kes` starts at `pending_approval` (see `payouts.request`): a person
 * decides before anything is signed.
 */
export type PayoutState =
  | "quoted" | "pending_approval" | "approved" | "rejected" | "held" | "dispatched"
  | "paid" | "failed" | "cancelled" | "expired";

/** Where a payout can go. `phone` is the default, so a beneficiary with no `type` is a phone. */
export type PayoutDestinationType = "phone" | "till" | "paybill" | "bank";

/** An M-Pesa number, as 2547xxxxxxxx (or 2541xxxxxxxx). */
export interface PhoneBeneficiary {
  type?: "phone";
  phone: string;
  /** The person being PAID: what their M-Pesa statement shows. */
  name: string;
}

/** A Buy Goods till: 5 to 9 digits. */
export interface TillBeneficiary {
  type: "till";
  till: string;
  name: string;
}

/** A paybill number (5 to 9 digits) and the account to credit. */
export interface PaybillBeneficiary {
  type: "paybill";
  paybill: string;
  account: string;
  name: string;
}

/** A bank account. `bank_code` comes from the bank list; an unknown one is `unknown_bank`. */
export interface BankBeneficiary {
  type: "bank";
  account: string;
  bank_code: string;
  name: string;
}

/**
 * What you SEND as `beneficiary`. Give exactly the fields of one type and no others: a till with a
 * phone beside it is refused, not guessed at. A body with a phone and no `type` still means phone.
 */
export type PayoutBeneficiaryInput =
  | PhoneBeneficiary | TillBeneficiary | PaybillBeneficiary | BankBeneficiary;

/**
 * What you GET BACK as `beneficiary`. A phone payout's has no `type`, exactly as before types
 * existed, so test `type === undefined` for phone rather than for the string "phone".
 */
export type PayoutBeneficiary = PayoutBeneficiaryInput;

/** One EIP-712 domain to sign under. */
export interface EIP712Domain {
  name: string;
  version: string;
  chain_id: number;
  verifying_contract: string;
}

/**
 * A single-use payout quote: the price, plus exactly what to sign.
 *
 * `amount_kes` LANDS on the beneficiary; `send_kes` leaves your wallet; `value_wei` is `send_kes`
 * in wei and is the number the permit must be for. Sign a transfer with `from` = your address,
 * `to` = `treasury_address`, `value_wei` and a deadline no later than `deadline`.
 *
 * BOTH domains are published because they differ: the EIP-2612 permit is signed under
 * `eip712.permit` (the token's) and the Relay intent under `eip712.relay` (the forwarder's).
 * Signing the permit under the wrong one produces a signature the chain rejects with nothing to
 * read.
 */
export interface PayoutQuote {
  quote_id: string;
  /** Set when this quote spends an approved request: the payout your signature will land on. */
  payout_id?: string;
  amount_kes: number;
  fee_kes: number;
  send_kes: number;
  currency: string;
  beneficiary: PayoutBeneficiary;
  expires_at: string;
  /** A decimal string. Sign this exact value; the server compares it character for character. */
  value_wei: string;
  treasury_address: string;
  /** Unix seconds: the LATEST deadline that will be accepted. An earlier one is fine. */
  deadline: number;
  eip712: { permit: EIP712Domain; relay: EIP712Domain };
}

export interface CreatePayoutQuoteParams {
  /**
   * The id of a request a person has approved. Required for a payout above `hold_above_kes`, and
   * `amount_kes` and `beneficiary` must then match what was approved.
   */
  payout_id?: string;
  /** Whole KES. This is what LANDS on the beneficiary, not what leaves your wallet. */
  amount_kes: number;
  beneficiary: PayoutBeneficiaryInput;
}

/** POST /v1/payouts/requests: ask a person, before anything is signed. */
export interface RequestPayoutParams {
  amount_kes: number;
  beneficiary: PayoutBeneficiaryInput;
}

/** A merchant payout (POST /v1/payouts, GET /v1/payouts/{id}, GET /v1/payouts). */
export interface Payout {
  id: string;
  status: PayoutState;
  amount_kes: number;
  fee_kes: number;
  send_kes: number;
  currency: string;
  beneficiary: PayoutBeneficiary;
  created_at: string;
  /** On an `approved` payout only: sign and submit before this, or ask again. */
  approval_expires_at?: string;
  /** Kakitu's sentence about what is happening now — the only place a hold is explained. */
  message?: string;
}

export interface CreatePayoutParams {
  /** From `payouts.quote`. Single use, and it expires. */
  quote_id: string;
  /** That quote, signed with YOUR key. The SDK does not sign it. */
  transfer: SignedTransfer;
}

export interface ListPayoutsParams extends PageParams {
  status?: PayoutState;
  /** RFC 3339, e.g. "2026-10-25T00:00:00Z". */
  created_after?: string;
}

// ------------------------------------------------- saved destinations and the lock

/**
 * A saved payout destination. `status` is `cooling_off` until `active_at`, and a locked merchant
 * can pay only an `active` one. `holder_name` is the name the bank gave when a bank was saved.
 */
export interface PayoutDestination {
  id: string;
  type: PayoutDestinationType;
  phone?: string;
  till?: string;
  paybill?: string;
  account?: string;
  bank_code?: string;
  holder_name?: string;
  status: "cooling_off" | "active";
  active_at: string;
  created_at: string;
}

/**
 * The lock, as every route that shows it shows it. While `payout_unlocks_at` is set the lock is
 * still on and is coming off at that time.
 *
 * The lock controls where your CASH-OUTS can go. It does not stop KSHS transfers to other wallets.
 */
export interface PayoutLock {
  payout_locked: boolean;
  payout_unlocks_at?: string;
}

export interface PayoutDestinationList extends PayoutLock {
  data: PayoutDestination[];
}

/** One destination to save, in the beneficiary's field names, with no name: a bank gives its own. */
export type SavePayoutDestinationParams =
  | { type?: "phone"; phone: string }
  | { type: "till"; till: string }
  | { type: "paybill"; paybill: string; account: string }
  | { type: "bank"; account: string; bank_code: string };
