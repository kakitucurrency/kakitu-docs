/**
 * Request signing. Mirrors auth/wallet.go in kakitu_wallet_server exactly:
 *
 *   message   = "{METHOD} {path}{?rawQuery} {timestamp} {sha256hex(body)}"
 *   signature = EIP-191 personal_sign(message), 65 bytes r||s||v with v = 27/28, 0x-hex
 *
 * You never call this directly; the client does it on every request.
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

export const HEADER_ADDRESS = "X-Kakitu-Address";
export const HEADER_TIMESTAMP = "X-Kakitu-Timestamp";
export const HEADER_SIGNATURE = "X-Kakitu-Signature";

/** lowercase hex sha256 of the raw body. Empty bytes for GET/DELETE. */
export function bodyHash(body: Uint8Array): string {
  return bytesToHex(sha256(body));
}

/**
 * The exact string that is signed. `pathWithQuery` is the URL path plus "?" and the raw query
 * string exactly as sent, only when the query is non-empty.
 */
export function buildMessage(
  method: string,
  pathWithQuery: string,
  timestamp: number | string,
  body: Uint8Array,
): string {
  return `${method.toUpperCase()} ${pathWithQuery} ${timestamp} ${bodyHash(body)}`;
}

/** EIP-191 personal_sign digest: keccak256("\x19Ethereum Signed Message:\n" + len + msg). */
export function personalMessageHash(message: string): Uint8Array {
  const msg = utf8ToBytes(message);
  const prefix = utf8ToBytes(`\x19Ethereum Signed Message:\n${msg.length}`);
  const all = new Uint8Array(prefix.length + msg.length);
  all.set(prefix, 0);
  all.set(msg, prefix.length);
  return keccak_256(all);
}

/** Parse a 32-byte hex private key. Error text never contains the key. */
export function parsePrivateKey(input: string): Uint8Array {
  const hex = typeof input === "string" ? input.trim().replace(/^0x/i, "") : "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new TypeError("privateKey must be a 32-byte hex string (64 hex characters, optional 0x prefix).");
  }
  const bytes = hexToBytes(hex);
  if (!secp256k1.utils.isValidPrivateKey(bytes)) {
    throw new TypeError("privateKey is not a valid secp256k1 key.");
  }
  return bytes;
}

/** EIP-55 checksummed address for a private key. */
export function addressFromPrivateKey(priv: Uint8Array): string {
  const pub = secp256k1.getPublicKey(priv, false); // 65 bytes, 0x04 || X || Y
  const lower = bytesToHex(keccak_256(pub.slice(1)).slice(12));
  const hash = bytesToHex(keccak_256(utf8ToBytes(lower)));
  let out = "0x";
  for (let i = 0; i < 40; i++) {
    const c = lower[i]!;
    out += parseInt(hash[i]!, 16) >= 8 ? c.toUpperCase() : c;
  }
  return out;
}

/** personal_sign. Deterministic (RFC 6979), low-s, v = 27/28, like the Go server's auth.Sign. */
export function signMessage(priv: Uint8Array, message: string): string {
  const sig = secp256k1.sign(personalMessageHash(message), priv, { lowS: true });
  const out = new Uint8Array(65);
  out.set(sig.toCompactRawBytes(), 0);
  out[64] = sig.recovery + 27;
  return "0x" + bytesToHex(out);
}

export interface SignedHeaders {
  [HEADER_ADDRESS]: string;
  [HEADER_TIMESTAMP]: string;
  [HEADER_SIGNATURE]: string;
}

export function signRequest(
  priv: Uint8Array,
  address: string,
  method: string,
  pathWithQuery: string,
  timestamp: number,
  body: Uint8Array,
): SignedHeaders {
  const message = buildMessage(method, pathWithQuery, timestamp, body);
  return {
    [HEADER_ADDRESS]: address,
    [HEADER_TIMESTAMP]: String(timestamp),
    [HEADER_SIGNATURE]: signMessage(priv, message),
  };
}
