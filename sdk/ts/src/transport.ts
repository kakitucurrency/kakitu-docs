import { KakituError, errorFromResponse } from "./errors.js";
import { addressFromPrivateKey, parsePrivateKey, signRequest } from "./signing.js";
import { utf8ToBytes } from "@noble/hashes/utils";

export const DEFAULT_BASE_URL = "https://walletapi.kakitu.org";

export interface KakituOptions {
  /** 32-byte hex wallet private key. Load it from an environment variable or secret store, never source code. */
  privateKey: string;
  baseUrl?: string;
  /** Retries after the first attempt, on 429 rate_limited and 5xx only. Default 3. Never on other 4xx. */
  maxRetries?: number;
  /** Per-attempt timeout in ms. Default 30000. */
  timeoutMs?: number;
  /** Test hooks. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number; // ms
  random?: () => number;
}

export interface RequestSpec {
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  idempotencyKey?: string;
  /** True if re-sending after a network failure cannot double-apply (GET, or POST with a key / upsert). */
  safeToRetry: boolean;
}

/** Query string exactly as it is both signed and sent (leading "?" only when non-empty). */
export function buildQueryString(q?: RequestSpec["query"]): string {
  if (!q) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? "?" + parts.join("&") : "";
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Transport {
  readonly address: string;
  readonly baseUrl: string;
  // ES private field: not enumerable, not on JSON.stringify, not on console.log.
  readonly #key: Uint8Array;
  readonly #opts: KakituOptions;

  constructor(opts: KakituOptions) {
    this.#key = parsePrivateKey(opts.privateKey);
    this.address = addressFromPrivateKey(this.#key);
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.#opts = opts;
  }

  async request<T>(spec: RequestSpec): Promise<T> {
    const o = this.#opts;
    const doFetch = o.fetch ?? fetch;
    const sleep = o.sleep ?? defaultSleep;
    const nowMs = o.now ?? Date.now;
    const rand = o.random ?? Math.random;
    const maxRetries = o.maxRetries ?? 3;

    const qs = buildQueryString(spec.query);
    const signedPath = spec.path + qs;
    // Serialise once; these exact bytes are hashed AND sent.
    const bodyBytes = spec.body === undefined ? new Uint8Array(0) : utf8ToBytes(JSON.stringify(spec.body));

    let lastTs = 0;
    for (let attempt = 0; ; attempt++) {
      // Every attempt is re-signed with a fresh timestamp. The server rejects an identical
      // (address, method, path, timestamp, body) as a replay, so a retry in the same second
      // would be refused; wait for the clock to move on.
      let ts = Math.floor(nowMs() / 1000);
      if (ts <= lastTs) {
        await sleep((lastTs + 1) * 1000 - nowMs() + 5);
        ts = Math.max(Math.floor(nowMs() / 1000), lastTs + 1);
      }
      lastTs = ts;

      const headers: Record<string, string> = {
        ...signRequest(this.#key, this.address, spec.method, signedPath, ts, bodyBytes),
        Accept: "application/json",
        "User-Agent": "kakitu-sdk-ts/0.1.0",
      };
      if (spec.body !== undefined) headers["Content-Type"] = "application/json";
      if (spec.idempotencyKey) headers["Idempotency-Key"] = spec.idempotencyKey;

      let res: Response | undefined;
      let netErr: unknown;
      try {
        const init: RequestInit = {
          method: spec.method,
          headers,
          signal: AbortSignal.timeout(o.timeoutMs ?? 30000),
        };
        if (spec.body !== undefined) init.body = bodyBytes as unknown as BodyInit;
        res = await doFetch(this.baseUrl + signedPath, init);
      } catch (e) {
        netErr = e;
      }

      if (!res) {
        if (spec.safeToRetry && attempt < maxRetries) {
          await sleep(backoff(attempt, undefined, rand));
          continue;
        }
        throw new KakituError({
          code: "network_error",
          message: `Network error talking to Kakitu: ${netErr instanceof Error ? netErr.name : "unknown"}.`,
          requestId: "",
          status: 0,
        });
      }

      const text = await res.text();
      if (res.ok) {
        try { return JSON.parse(text) as T; } catch {
          throw new KakituError({
            code: "unknown", message: "Server returned a non-JSON success body.",
            requestId: res.headers.get("x-request-id") ?? "", status: res.status,
          });
        }
      }

      const err = errorFromResponse(res.status, res.headers.get("x-request-id") ?? "", text);
      // 5xx: retry. 429: only the transient limiter. daily_cap_exceeded and payer_velocity_exceeded
      // will not clear in seconds, so retrying them only burns budget. Every other 4xx: never.
      const retryable = res.status >= 500 || (res.status === 429 && (err.code === "rate_limited" || err.code === "unknown"));
      if (retryable && attempt < maxRetries) {
        await sleep(backoff(attempt, res.headers.get("retry-after"), rand));
        continue;
      }
      throw err;
    }
  }
}

function backoff(attempt: number, retryAfter: string | null | undefined, rand: () => number): number {
  const ra = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(ra) && ra >= 0) return Math.min(ra, 30) * 1000;
  const base = Math.min(8000, 500 * 2 ** attempt);
  return base / 2 + rand() * (base / 2);
}
