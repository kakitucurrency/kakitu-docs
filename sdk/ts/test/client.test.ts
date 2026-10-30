import { describe, it, expect } from "vitest";
import vectors from "./vectors.json" with { type: "json" };
import { Kakitu, KakituError, verifyWebhookSignature } from "../src/index.js";
import { buildMessage, signMessage, parsePrivateKey } from "../src/signing.js";
import { utf8ToBytes, bytesToHex } from "@noble/hashes/utils";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";

type Call = { url: string; init: RequestInit };
function harness(responses: Array<() => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  let ms = 1_758_240_000_000;
  let i = 0;
  const k = new Kakitu({
    privateKey: vectors.privateKey,
    baseUrl: "https://example.test",
    random: () => 0.5,
    now: () => ms,
    sleep: async (d) => { sleeps.push(d); ms += d; },
    fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = responses[Math.min(i++, responses.length - 1)]!;
      return r();
    }) as unknown as typeof fetch,
  });
  return { k, calls, sleeps };
}
const json = (status: number, body: unknown, h: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...h } });
const env = (code: string, message = "m") => ({ error: { code, message, request_id: "req-1" } });
const merchant = { address: vectors.address, business_name: "B", state: "pending" };

describe("client signing on the wire", () => {
  it("signs GET /v1/merchants/me and sends no body", async () => {
    const { k, calls } = harness([json(200, merchant)]);
    await k.merchants.me();
    const h = calls[0]!.init.headers as Record<string, string>;
    const ts = h["X-Kakitu-Timestamp"]!;
    expect(h["X-Kakitu-Address"]).toBe(vectors.address);
    expect(h["X-Kakitu-Signature"]).toBe(
      signMessage(parsePrivateKey(vectors.privateKey),
        buildMessage("GET", "/v1/merchants/me", ts, new Uint8Array(0))));
    expect(calls[0]!.init.body).toBeUndefined();
    expect(h["Idempotency-Key"]).toBeUndefined();
  });

  it("signs the exact bytes it sends for POST register, and sends no Idempotency-Key", async () => {
    const { k, calls } = harness([json(201, merchant)]);
    await k.merchants.register({ business_name: "Wanjirũ Café", contact_email: "a@b.co" });
    const { init } = calls[0]!;
    const h = init.headers as Record<string, string>;
    const sent = init.body as Uint8Array;
    expect(new TextDecoder().decode(sent)).toBe('{"business_name":"Wanjirũ Café","contact_email":"a@b.co"}');
    expect(h["X-Kakitu-Signature"]).toBe(
      signMessage(parsePrivateKey(vectors.privateKey),
        buildMessage("POST", "/v1/merchants", h["X-Kakitu-Timestamp"]!, sent)));
    expect(h["Idempotency-Key"]).toBeUndefined();
  });

  it("includes the query in both the signed path and the URL", async () => {
    const { k, calls } = harness([json(200, { data: [] })]);
    await k.charges.list({ limit: 5, status: "paid" });
    expect(calls[0]!.url).toBe("https://example.test/v1/charges?limit=5&status=paid");
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h["X-Kakitu-Signature"]).toBe(
      signMessage(parsePrivateKey(vectors.privateKey),
        buildMessage("GET", "/v1/charges?limit=5&status=paid", h["X-Kakitu-Timestamp"]!, new Uint8Array(0))));
  });
});

// What the server verifies (auth/wallet.go RequestPath): Go's url.Path — the PERCENT-DECODED
// path — plus "?" and RawQuery exactly as received. And what it receives is not the string we
// hand to fetch but what fetch's WHATWG URL parser makes of it, which escapes ' in a query.
function serverSignedPath(sentUrl: string): string {
  const u = new URL(sentUrl);
  return decodeURIComponent(u.pathname) + u.search;
}
function expectServerAccepts(c: Call, method: string) {
  const h = c.init.headers as Record<string, string>;
  const body = (c.init.body as Uint8Array | undefined) ?? new Uint8Array(0);
  expect(h["X-Kakitu-Signature"]).toBe(
    signMessage(parsePrivateKey(vectors.privateKey),
      buildMessage(method, serverSignedPath(c.url), h["X-Kakitu-Timestamp"]!, body)));
}

describe("signs what the server sees (regressions)", () => {
  it("a query value with ' ! ( ) * signs the bytes fetch actually sends", async () => {
    const { k, calls } = harness([json(200, { data: [], next_cursor: null })]);
    await k.charges.list({ reference: "O'Brien (shop)!*" });
    expectServerAccepts(calls[0]!, "GET");
    // RFC 3986 escaping, so the URL is stable under fetch's own parsing.
    expect(calls[0]!.url).toBe("https://example.test/v1/charges?reference=O%27Brien%20%28shop%29%21%2A");
  });

  it("a path id that needs escaping is signed decoded, as the server reads it", async () => {
    const { k, calls } = harness([json(200, { id: "x" })]);
    await k.charges.get("ab c/é");
    expect(calls[0]!.url).toBe("https://example.test/v1/charges/ab%20c%2F%C3%A9");
    expectServerAccepts(calls[0]!, "GET");
  });

  it("a POST with an escaped path id is signed decoded too", async () => {
    const { k, calls } = harness([json(200, { id: "e" })]);
    await k.events.replay("evt 1");
    expectServerAccepts(calls[0]!, "POST");
  });
});

describe("idempotency", () => {
  it("auto-generates a key and reuses it across retries; override wins", async () => {
    const a = harness([json(503, env("rail_unavailable")), json(201, { id: "c" })]);
    await a.k.charges.create({ amount: 100, phone: "0700000000", reference: "r1" });
    const k0 = (a.calls[0]!.init.headers as Record<string, string>)["Idempotency-Key"];
    const k1 = (a.calls[1]!.init.headers as Record<string, string>)["Idempotency-Key"];
    expect(k0).toMatch(/^[0-9a-f-]{36}$/);
    expect(k1).toBe(k0);

    const b = harness([json(201, { id: "c" })]);
    await b.k.charges.create({ amount: 1, phone: "x", reference: "r" }, { idempotencyKey: "mine-1" });
    expect((b.calls[0]!.init.headers as Record<string, string>)["Idempotency-Key"]).toBe("mine-1");
  });
});

describe("retries", () => {
  it("retries 5xx with a fresh, strictly later timestamp (replay-safe)", async () => {
    const { k, calls } = harness([json(500, env("internal")), json(502, {}), json(200, merchant)]);
    await k.merchants.me();
    expect(calls).toHaveLength(3);
    const ts = calls.map((c) => Number((c.init.headers as Record<string, string>)["X-Kakitu-Timestamp"]));
    expect(ts[1]!).toBeGreaterThan(ts[0]!);
    expect(ts[2]!).toBeGreaterThan(ts[1]!);
  });
  it("retries 429 rate_limited and honours Retry-After", async () => {
    const { k, calls, sleeps } = harness([json(429, env("rate_limited"), { "retry-after": "2" }), json(200, merchant)]);
    await k.merchants.me();
    expect(calls).toHaveLength(2);
    expect(sleeps[0]).toBe(2000);
  });
  it.each(["daily_cap_exceeded", "payer_velocity_exceeded"])("does not retry 429 %s", async (code) => {
    const { k, calls } = harness([json(429, env(code))]);
    await expect(k.merchants.me()).rejects.toMatchObject({ code });
    expect(calls).toHaveLength(1);
  });
  it.each([[400, "invalid_request"], [401, "unauthorized"], [404, "merchant_not_registered"], [409, "idempotency_key_acted"], [403, "merchant_not_approved"]])(
    "never retries %i", async (status, code) => {
      const { k, calls } = harness([json(status as number, env(code as string))]);
      await expect(k.merchants.me()).rejects.toBeInstanceOf(KakituError);
      expect(calls).toHaveLength(1);
    });
  it("gives up after maxRetries and throws the last error", async () => {
    const { k, calls } = harness([json(503, env("rail_unavailable"))]);
    await expect(k.merchants.me()).rejects.toMatchObject({ code: "rail_unavailable", status: 503 });
    expect(calls).toHaveLength(4);
  });
});

describe("errors", () => {
  it("exposes code, message, requestId", async () => {
    const { k } = harness([json(404, env("merchant_not_registered", "not registered"))]);
    const e = await k.merchants.me().catch((x) => x);
    expect(e).toBeInstanceOf(KakituError);
    expect([e.code, e.message, e.requestId, e.status]).toEqual(["merchant_not_registered", "not registered", "req-1", 404]);
  });
  it("parses the auth-middleware shape {error:string, reason}", async () => {
    const { k } = harness([json(401, { error: "unauthorized", reason: "replay" }, { "x-request-id": "hdr-9" })]);
    const e = await k.merchants.me().catch((x) => x);
    expect(e).toMatchObject({ code: "unauthorized", reason: "replay", requestId: "hdr-9" });
  });
  it("maps an unrecognised code to 'unknown' and keeps rawCode", async () => {
    const { k } = harness([json(400, env("brand_new"))]);
    await expect(k.merchants.me()).rejects.toMatchObject({ code: "unknown", rawCode: "brand_new" });
  });
});

describe("key hygiene", () => {
  it("never exposes the private key via JSON, inspect or string", () => {
    const { k } = harness([json(200, {})]);
    const hexKey = vectors.privateKey.slice(2);
    expect(JSON.stringify(k)).not.toContain(hexKey);
    expect(JSON.stringify(Object.values(k))).not.toContain(hexKey);
    expect(String(k)).not.toContain(hexKey);
    expect(Object.getOwnPropertyNames(k).join()).not.toMatch(/key/i);
  });
});

describe("webhook verification (provisional scheme)", () => {
  const secret = "whsec_placeholder";
  const body = '{"type":"charge.paid"}';
  const t = 1_758_240_000;
  const sig = bytesToHex(hmac(sha256, utf8ToBytes(secret), utf8ToBytes(`${t}.${body}`)));
  const now = () => t + 10;
  it("accepts a valid signature", () =>
    expect(verifyWebhookSignature({ payload: body, header: `t=${t},v1=${sig}`, secret, now })).toBe(true));
  it("rejects tampered body, wrong secret, stale timestamp, garbage", () => {
    expect(verifyWebhookSignature({ payload: body + " ", header: `t=${t},v1=${sig}`, secret, now })).toBe(false);
    expect(verifyWebhookSignature({ payload: body, header: `t=${t},v1=${sig}`, secret: "x", now })).toBe(false);
    expect(verifyWebhookSignature({ payload: body, header: `t=${t},v1=${sig}`, secret, now: () => t + 1000 })).toBe(false);
    expect(verifyWebhookSignature({ payload: body, header: "nonsense", secret, now })).toBe(false);
  });
});
