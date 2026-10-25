import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

/**
 * PROVISIONAL. The webhook signing scheme is NOT in the Go source yet (no sender exists in
 * kakitu_wallet_server at the time of writing). This implements a Stripe-style scheme:
 *
 *   header  Kakitu-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>
 *
 * Confirm against the server before relying on it. Pass the RAW body string, not re-serialised JSON.
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
