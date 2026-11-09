/**
 * What the developer pitch added to the API, as the SDK carries it: a payment reference, typed
 * payout destinations, approve-first requests, saved destinations and the lock, and the event
 * types that announce them. Shapes are the server's (controller/v1_payout_c.go,
 * v1_payout_destinations_c.go, repository/payout_event.go, transfer_notify.go).
 */
import { describe, it, expect } from "vitest";
import vectors from "./vectors.json" with { type: "json" };
import {
  type Payout, type PayoutQuote,
  EVENT_TYPES, Kakitu, SERVER_ERROR_CODES,
  type EventType, type PayoutBeneficiaryInput, type SignedTransfer,
} from "../src/index.js";

type Call = { url: string; init: RequestInit };
function harness(body: unknown = {}, status = 200) {
  const calls: Call[] = [];
  const k = new Kakitu({
    privateKey: vectors.privateKey,
    baseUrl: "https://example.test",
    now: () => 1_758_240_000_000,
    sleep: async () => {},
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch,
  });
  return { k, calls };
}
const sent = (c: Call) => JSON.parse(new TextDecoder().decode(c.init.body as Uint8Array));

const signed: SignedTransfer = {
  from: vectors.address, to: "0x000000000000000000000000000000000000dEaD",
  value_wei: "1000000000000000000000", deadline: 1_758_240_600,
  v: 27, r: "0x" + "11".repeat(32), s: "0x" + "22".repeat(32),
  iv: 28, ir: "0x" + "33".repeat(32), is: "0x" + "44".repeat(32),
  reference: "ORD-1042",
};

describe("a payment reference", () => {
  it("is carried on a transfer exactly as given", async () => {
    const { k, calls } = harness({ id: "0xabc", status: "confirmed" });
    await k.transfers.create(signed);
    expect(sent(calls[0]!).reference).toBe("ORD-1042");
  });

  it("is simply absent when there is none", async () => {
    const { k, calls } = harness({ id: "0xabc", status: "confirmed" });
    const { reference: _drop, ...bare } = signed;
    await k.transfers.create(bare);
    expect("reference" in sent(calls[0]!)).toBe(false);
  });
});

describe("typed payout beneficiaries", () => {
  const cases: Array<[string, PayoutBeneficiaryInput]> = [
    ["phone, no type (the old shape)", { phone: "254712345678", name: "Jane Wanjiru" }],
    ["phone, typed", { type: "phone", phone: "254712345678", name: "Jane Wanjiru" }],
    ["till", { type: "till", till: "123456", name: "Jane Stores" }],
    ["paybill", { type: "paybill", paybill: "400200", account: "INV-77", name: "Landlord Ltd" }],
    ["bank", { type: "bank", account: "0123456789", bank_code: "01", name: "Jane Wanjiru" }],
  ];
  it.each(cases)("%s goes on the wire untouched", async (_n, beneficiary) => {
    const { k, calls } = harness({});
    await k.payouts.quote({ amount_kes: 1000, beneficiary });
    expect(sent(calls[0]!).beneficiary).toEqual(beneficiary);
  });

  it("rejects, at compile time, a till that carries a phone", () => {
    // @ts-expect-error a till beneficiary has no phone
    const bad: PayoutBeneficiaryInput = { type: "till", phone: "254712345678", name: "x" };
    expect(bad).toBeDefined();
  });
});

describe("approve first", () => {
  it("asks for approval at POST /v1/payouts/requests, with an Idempotency-Key", async () => {
    const { k, calls } = harness({ id: "p-1", status: "pending_approval" }, 202);
    const out = await k.payouts.request({ amount_kes: 9000, beneficiary: { phone: "254712345678", name: "J W" } });
    expect(calls[0]!.url).toBe("https://example.test/v1/payouts/requests");
    expect((calls[0]!.init.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(out.status).toBe("pending_approval");
  });

  it("quotes an approved request by payout_id", async () => {
    const { k, calls } = harness({});
    await k.payouts.quote({ payout_id: "p-1", amount_kes: 9000, beneficiary: { phone: "254712345678", name: "J W" } });
    expect(sent(calls[0]!).payout_id).toBe("p-1");
  });
});

describe("saved destinations and the lock", () => {
  it("lists, saves, removes and locks on the routes the server mounts", async () => {
    const { k, calls } = harness({ data: [], payout_locked: false });
    await k.payoutDestinations.list();
    await k.payoutDestinations.save({ type: "till", till: "123456" });
    await k.payoutDestinations.remove("d-1");
    await k.payoutDestinations.setLock(true);
    expect(calls.map((c) => `${c.init.method} ${new URL(c.url).pathname}`)).toEqual([
      "GET /v1/payout-destinations",
      "POST /v1/payout-destinations",
      "DELETE /v1/payout-destinations/d-1",
      "POST /v1/payout-destinations/lock",
    ]);
    expect(sent(calls[1]!)).toEqual({ type: "till", till: "123456" });
    expect(sent(calls[3]!)).toEqual({ locked: true });
  });

  it("sends no Idempotency-Key: none of the four moves money", async () => {
    const { k, calls } = harness({ data: [] });
    await k.payoutDestinations.save({ phone: "254712345678" });
    await k.payoutDestinations.setLock(false);
    for (const c of calls) expect((c.init.headers as Record<string, string>)["Idempotency-Key"]).toBeUndefined();
  });
});

describe("event types", () => {
  it("names every type the server raises, and no more", () => {
    const want: EventType[] = [
      "charge.paid", "charge.settled", "charge.failed",
      "payout.approved", "payout.rejected", "payout.expired", "payout.cancelled", "payout.paid", "payout.failed",
      "transfer.received",
      "payout_destination.added", "payout_destination.removed", "payout_lock.changed",
    ];
    expect([...EVENT_TYPES].sort()).toEqual([...want].sort());
  });

  it("knows every error code the closed set has", () => {
    for (const c of [
      "payout_approval_required", "payout_not_approved", "payout_approval_mismatch",
      "payout_open_requests_exceeded", "payout_destination_locked", "payout_destination_not_found",
      "payout_destinations_full", "bank_unavailable", "unknown_bank", "account_not_found", "insufficient_balance",
    ]) expect(SERVER_ERROR_CODES).toContain(c);
    expect(SERVER_ERROR_CODES.length).toBe(44);
  });
});

describe("response beneficiaries stay readable the old way", () => {
  it("still compiles `payout.beneficiary.phone` on a Payout and a PayoutQuote", () => {
    // Compile-level: this file is typechecked by `tsc --noEmit`. A union without `phone?` fails here.
    const phoneOf = (p: Payout, q: PayoutQuote): [string | undefined, string | undefined, string] =>
      [p.beneficiary.phone, q.beneficiary.phone, p.beneficiary.name];
    const till = { beneficiary: { type: "till", till: "123456", name: "Jane Stores" } } as Payout;
    expect(phoneOf(till, till as unknown as PayoutQuote)[0]).toBeUndefined();
  });
});
