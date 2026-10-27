import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

/**
 * Verifies a webhook delivery. The scheme is the server's own (webhookout/signer.go):
 *
 *   header  Kakitu-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>
 *
 * Pass the RAW body bytes, not re-serialised JSON: re-marshalling reorders keys and changes
 * whitespace, and you would then verify a different string than the one that was signed.
 *
 * Delivery is AT-LEAST-ONCE. The `Kakitu-Event-Id` header (and `id` in the payload) is stable
 * across every attempt and across a replay — dedupe on it, or you will double-count.
 */
export function verifyWebhookSignature(opts: {
  payload: string | Uint8Array;
  header: string;
  secret: string;
  toleranceSeconds?: number;
  now?: () => number; // unix seconds
}): boolean {
  const tol = opts.toleranceSeconds ?? 300;
  const now = (opts.now ?? (() => Math.floor(Date.now() / 1000)))();
  let t = "";
  const sigs: string[] = [];
  for (const part of opts.header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") sigs.push(v.toLowerCase());
  }
  if (!/^\d+$/.test(t) || sigs.length === 0) return false;
  if (Math.abs(now - Number(t)) > tol) return false;
  const body = typeof opts.payload === "string" ? opts.payload : new TextDecoder().decode(opts.payload);
  const expected = bytesToHex(hmac(sha256, utf8ToBytes(opts.secret), utf8ToBytes(`${t}.${body}`)));
  return sigs.some((s) => timingSafeEqualHex(s, expected));
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
