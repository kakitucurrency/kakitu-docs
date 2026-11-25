/**
 * The resources added for the rest of the developer API: idempotency where the server demands
 * it and nowhere else, the one cursor pager, and the shapes that carry caller-produced
 * signatures the SDK must never invent.
 */
import { describe, it, expect } from "vitest";
import vectors from "./vectors.json" with { type: "json" };
import { createHmac } from "node:crypto";
import { Kakitu, autoPaginate, verifyWebhookSignature, type Page, type SignedTransfer } from "../src/index.js";

type Call = { url: string; init: RequestInit };
function harness(responses: Array<() => Response | Promise<Response>>) {
  const calls: Call[] = [];
  let ms = 1_758_240_000_000;
  let i = 0;
  const k = new Kakitu({
    privateKey: vectors.privateKey,
    baseUrl: "https://example.test",
    random: () => 0.5,
    now: () => ms,
    sleep: async (d) => { ms += d; },
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return responses[Math.min(i++, responses.length - 1)]!();
    }) as unknown as typeof fetch,
  });
  return { k, calls };
}
const json = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const headersOf = (c: Call) => c.init.headers as Record<string, string>;

/** A transfer the CALLER signed. The SDK must carry these bytes through untouched. */
const signed: SignedTransfer = {
  from: vectors.address,
  to: "0x000000000000000000000000000000000000dEaD",
  value_wei: "1000000000000000000000",
  deadline: 1_758_240_600,
  v: 27,
  r: "0x" + "11".repeat(32),
  s: "0x" + "22".repeat(32),
  iv: 28,
  ir: "0x" + "33".repeat(32),
  is: "0x" + "44".repeat(32),
};

describe("idempotency is not uniform, and the SDK does not pretend it is", () => {
  it("sends a generated Idempotency-Key on the three methods that require one", async () => {
    for (const run of [
      (k: Kakitu) => k.charges.create({ amount: 500, phone: "0712345678", reference: "o-1" }),
      (k: Kakitu) => k.transfers.create(signed),
      (k: Kakitu) => k.payouts.create({ quote_id: "pq_1", transfer: signed }),
    ]) {
      const { k, calls } = harness([json(200, {})]);
      await run(k);
      const key = headersOf(calls[0]!)["Idempotency-Key"];
      expect(key, calls[0]!.url).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("honours a caller's own key on those methods", async () => {
    const { k, calls } = harness([json(200, {}), json(200, {}), json(200, {})]);
    await k.charges.create({ amount: 1, phone: "p", reference: "r" }, { idempotencyKey: "mine-c" });
    await k.transfers.create(signed, { idempotencyKey: "mine-t" });
    await k.payouts.create({ quote_id: "q", transfer: signed }, { idempotencyKey: "mine-p" });
    expect(calls.map((c) => headersOf(c)["Idempotency-Key"])).toEqual(["mine-c", "mine-t", "mine-p"]);
  });

  it("sends NO Idempotency-Key where the server refuses one", async () => {
    const { k, calls } = harness([json(200, {}), json(200, {}), json(202, {}), json(201, {})]);
    await k.quotes.create({ type: "deposit", amount_kes: 1000, phone: "0712345678" });
    await k.payouts.quote({ amount_kes: 1000, beneficiary: { phone: "254712345678", name: "A N" } });
    await k.events.replay("ev-1");
    await k.merchants.register({ business_name: "B", contact_email: "a@b.co" });
    expect(calls.map((c) => c.url)).toEqual([
      "https://example.test/v1/quotes",
      "https://example.test/v1/payouts/quote",
      "https://example.test/v1/events/ev-1/replay",
      "https://example.test/v1/merchants",
    ]);
    for (const c of calls) expect(headersOf(c)["Idempotency-Key"], c.url).toBeUndefined();
  });

  it("sends no Idempotency-Key on any read", async () => {
    const { k, calls } = harness([json(200, { data: [], next_cursor: null })]);
    await k.balances.retrieve();
    await k.limits.retrieve();
    await k.orders.get("o-1");
    await k.payouts.get("p-1");
    await k.events.list();
    await k.payouts.list();
    for (const c of calls) expect(headersOf(c)["Idempotency-Key"], c.url).toBeUndefined();
  });
});

describe("cursor pagination: one contract, one pager", () => {
  const page = <T>(data: T[], next: string | null): Page<T> => ({ data, next_cursor: next });

  it("autoPaginate walks a two-page response and stops on a null next_cursor", async () => {
    const seen: Array<string | undefined> = [];
    const pages = [page([1, 2], "cur-2"), page([3], null)];
    const out: number[] = [];
    for await (const n of autoPaginate<number>(async (cursor) => {
      seen.push(cursor);
      return pages[seen.length - 1]!;
    })) out.push(n);
    expect(out).toEqual([1, 2, 3]);
    expect(seen).toEqual([undefined, "cur-2"]);
  });

  it("stops rather than loop for ever if the server repeats a cursor", async () => {
    let n = 0;
    const out: number[] = [];
    for await (const v of autoPaginate<number>(async () => page([n++], "same"))) out.push(v);
    expect(out).toEqual([0, 1]); // the repeat is followed once, then the walk ends
  });

  it("listAll sends the previous page's next_cursor back unchanged, on all three lists", async () => {
    for (const [path, run] of [
      ["/v1/charges", (k: Kakitu) => k.charges.listAll({ limit: 2 })],
      ["/v1/events", (k: Kakitu) => k.events.listAll({ limit: 2 })],
      ["/v1/payouts", (k: Kakitu) => k.payouts.listAll({ limit: 2 })],
    ] as const) {
      const { k, calls } = harness([
        json(200, { data: [{ id: "a" }, { id: "b" }], next_cursor: "op-aque==" }),
        json(200, { data: [{ id: "c" }], next_cursor: null }),
      ]);
      const ids: string[] = [];
      for await (const row of run(k)) ids.push((row as { id: string }).id);
      expect(ids, path).toEqual(["a", "b", "c"]);
      expect(calls.map((c) => c.url), path).toEqual([
        `https://example.test${path}?limit=2`,
        `https://example.test${path}?limit=2&cursor=op-aque%3D%3D`,
      ]);
    }
  });

  it("list() returns the raw page so a caller can hold the cursor itself", async () => {
    const { k } = harness([json(200, { data: [{ id: "p1" }], next_cursor: "c2" })]);
    const first = await k.payouts.list({ status: "held", limit: 1 });
    expect(first.next_cursor).toBe("c2");
    expect(first.data).toHaveLength(1);
  });

  it("transfers.listAll walks GET /transfers by next_before and stops when it is absent", async () => {
    const { k, calls } = harness([
      json(200, { transfers: [{ tx_hash: "0xa" }, { tx_hash: "0xb" }], next_before: "2026-11-07T08:21:09.1Z" }),
      json(200, { transfers: [{ tx_hash: "0xc", reference: "ORD-1" }] }),
    ]);
    const hashes: string[] = [];
    for await (const t of k.transfers.listAll({ limit: 2 })) hashes.push(t.tx_hash);
    expect(hashes).toEqual(["0xa", "0xb", "0xc"]);
    expect(calls.map((c) => c.url)).toEqual([
      "https://example.test/transfers?limit=2",
      "https://example.test/transfers?limit=2&before=2026-11-07T08%3A21%3A09.1Z",
    ]);
    expect(headersOf(calls[0]!)["Idempotency-Key"]).toBeUndefined();
  });

  it("transfers.listAll stops on a repeated next_before instead of looping", async () => {
    const { k, calls } = harness([json(200, { transfers: [{ tx_hash: "0xa" }], next_before: "same" })]);
    const hashes: string[] = [];
    for await (const t of k.transfers.listAll()) hashes.push(t.tx_hash);
    expect(hashes).toEqual(["0xa", "0xa"]);
    expect(calls).toHaveLength(2);
  });

  it("omits undefined filters from the query string", async () => {
    const { k, calls } = harness([json(200, { data: [], next_cursor: null })]);
    await k.events.list({ type: "payout.expired" });
    expect(calls[0]!.url).toBe("https://example.test/v1/events?type=payout.expired");
  });
});

describe("the caller's own signatures are carried, never produced", () => {
  it("POSTs the signed transfer byte for byte", async () => {
    const { k, calls } = harness([json(202, { id: "0xabc", status: "pending" })]);
    const out = await k.transfers.create(signed);
    expect(out).toEqual({ id: "0xabc", status: "pending" });
    const body = JSON.parse(new TextDecoder().decode(calls[0]!.init.body as Uint8Array));
    expect(body).toEqual(signed);
    // value_wei must survive as a string: through a float it would become 1e+21.
    expect(body.value_wei).toBe("1000000000000000000000");
  });

  it("POSTs the payout confirm as {quote_id, transfer} with the signature untouched", async () => {
    const { k, calls } = harness([json(202, { id: "po_1", status: "held" })]);
    const out = await k.payouts.create({ quote_id: "pq_9", transfer: signed });
    expect(out.status).toBe("held");
    const body = JSON.parse(new TextDecoder().decode(calls[0]!.init.body as Uint8Array));
    expect(body).toEqual({ quote_id: "pq_9", transfer: signed });
  });
});

describe("read routes", () => {
  it("parses balances, limits with the merchant payout block, and an order", async () => {
    const { k } = harness([
      json(200, { kshs: { amount_kes: 4200, network: "base" }, usdc: { amount: "12.345678", network: "base" } }),
    ]);
    const b = await k.balances.retrieve();
    expect(b.kshs.amount_kes).toBe(4200);
    expect(b.usdc.amount).toBe("12.345678"); // a string, never a float

    const { k: k2 } = harness([json(200, {
      withdrawal: { min_kes: 50, max_kes: 150000, source: "live" },
      payout: {
        enabled: true, max_kes: 70000, daily_cap_kes: 500000, hold_above_kes: 20000,
        remaining_today_kes: null, note: "n",
      },
      max_staleness_seconds: 300, note: "n",
    })]);
    const l = await k2.limits.retrieve();
    expect(l.payout?.hold_above_kes).toBe(20000);
    // null is "could not be read", NOT zero.
    expect(l.payout?.remaining_today_kes).toBeNull();

    const { k: k3, calls } = harness([json(200, { id: "o1", type: "deposit", status: "awaiting_payment" })]);
    await k3.orders.get("o1/../x");
    expect(calls[0]!.url).toBe("https://example.test/v1/orders/o1%2F..%2Fx"); // id is escaped
  });

  it("surfaces the payout error codes as themselves, not as the collection ones", async () => {
    const { k } = harness([json(429, {
      error: { code: "payout_daily_cap_exceeded", message: "m", request_id: "r" },
    })]);
    await expect(k.payouts.create({ quote_id: "q", transfer: signed })).rejects.toMatchObject({
      code: "payout_daily_cap_exceeded",
    });
  });
});

describe("merchant contact, webhook secret and payload_raw", () => {
  it("update sends only the fields given, and {} when none are", async () => {
    const { k, calls } = harness([json(200, {})]);
    await k.merchants.update({ callback_url: "https://shop.example/hook" });
    await k.merchants.update({});
    const body = (i: number) => new TextDecoder().decode(calls[i]!.init.body as Uint8Array);
    expect(body(0)).toBe('{"callback_url":"https://shop.example/hook"}');
    expect(body(1)).toBe("{}");
    expect(headersOf(calls[0]!)["Idempotency-Key"]).toBeUndefined();
  });

  it("update carries the one-time webhook_secret through", async () => {
    const { k } = harness([json(200, { address: "0xMe", webhook_secret: "s3" })]);
    const m = await k.merchants.update({ callback_url: "https://shop.example/hook" });
    const secret: string | undefined = m.webhook_secret;
    expect(secret).toBe("s3");
  });

  it("rotateWebhookSecret posts no body and no key, and returns the secret", async () => {
    const { k, calls } = harness([json(200, { webhook_secret: "new" })]);
    expect(await k.merchants.rotateWebhookSecret()).toEqual({ webhook_secret: "new" });
    expect(calls[0]!.url).toBe("https://example.test/v1/merchants/me/webhook-secret");
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.body).toBeUndefined();
    expect(headersOf(calls[0]!)["Idempotency-Key"]).toBeUndefined();
  });

  it("rotateWebhookSecret is not resent after a network error: a late first request would void the answer", async () => {
    const { k, calls } = harness([() => { throw new TypeError("fetch failed"); }]);
    await expect(k.merchants.rotateWebhookSecret()).rejects.toMatchObject({ code: "network_error" });
    expect(calls).toHaveLength(1);
  });

  it("a kept Kakitu-Signature verifies over an event's payload_raw", async () => {
    const raw = '{"id":"e1","note":"a<b \u00e9"}';
    const header = `t=100,v1=${createHmac("sha256", "sec").update("100." + raw).digest("hex")}`;
    const { k } = harness([json(200, { data: [{ id: "e1", payload: JSON.parse(raw), payload_raw: raw }], next_cursor: null })]);
    const got: string | undefined = (await k.events.list()).data[0]!.payload_raw;
    expect(got).toBe(raw);
    expect(verifyWebhookSignature({ payload: got!, header, secret: "sec", toleranceSeconds: Infinity })).toBe(true);
  });
});
