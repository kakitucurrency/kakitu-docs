import { describe, it, expect } from "vitest";
import vectors from "./vectors.json" with { type: "json" };
import { addressFromPrivateKey, buildMessage, parsePrivateKey, signMessage, bodyHash } from "../src/signing.js";
import { utf8ToBytes } from "@noble/hashes/utils";

const key = parsePrivateKey(vectors.privateKey);
const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("signing vs Go server vectors (cmd/kakitu-vectors)", () => {
  it("derives the same address", () => {
    expect(addressFromPrivateKey(key)).toBe(vectors.address);
  });

  // Pinned literally so a regression is visible in the diff, not hidden behind the fixture.
  it("pins GET with no body", () => {
    const m = buildMessage("GET", "/profile", 1758240000, new Uint8Array(0));
    expect(m).toBe(`GET /profile 1758240000 ${EMPTY}`);
    expect(signMessage(key, m)).toBe(
      "0x726acc038966cde70c4a8af96732a6adb5098d68551a8d8e129b4fbf1ac6803b54040d561323b41f5fe374d06538d474eb0d6694067fa7b45500a1be6f3bfe741b");
  });
  it("pins GET with a query (the ? is part of the signed path)", () => {
    const m = buildMessage("GET", "/kyc/state?country=KE&tier=basic", 1758240001, new Uint8Array(0));
    expect(m).toBe(`GET /kyc/state?country=KE&tier=basic 1758240001 ${EMPTY}`);
    expect(signMessage(key, m)).toBe(
      "0x3660f0431d31e727a8ba5f33c788812c6a25e8507b9c2479324ed1259ad047fe6c44925337052d4037a86ade58ef860a890f3f7bfaeec5331deaf78e1fe50e681b");
  });
  it("pins POST with a body", () => {
    const body = utf8ToBytes('{"amount_kes":1000,"phone":"+254700000000"}');
    expect(bodyHash(body)).toBe("7a4c4c0f0333102cffe5a64621024fe6d094cbcc71d771c251a3600c43ac19a6");
    const m = buildMessage("POST", "/ramp/deposit", 1758240002, body);
    expect(m).toBe("POST /ramp/deposit 1758240002 7a4c4c0f0333102cffe5a64621024fe6d094cbcc71d771c251a3600c43ac19a6");
    expect(signMessage(key, m)).toBe(
      "0x300fa9012768e1bcd22614d77d7724be7cdad84bbf65f482b536860ce0eb5a4e2329986faa234254388022acfb3f9c7640778bfc2021cc6eca0848f1556f6f171c");
  });

  it.each(vectors.cases)("fixture case $name", (c) => {
    const body = utf8ToBytes(c.body);
    const m = buildMessage(c.method, c.signed_path, c.timestamp, body);
    expect(bodyHash(body)).toBe(c.body_sha256_hex);
    expect(m).toBe(c.message);
    expect(signMessage(key, m)).toBe(c.signature);
  });

  it("rejects bad keys without echoing them", () => {
    try { parsePrivateKey("0xnot-a-key-SECRET123"); expect.unreachable(); }
    catch (e) { expect(String(e)).not.toContain("SECRET123"); }
  });
});
