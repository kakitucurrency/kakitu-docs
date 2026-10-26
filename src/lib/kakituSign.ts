/**
 * Kakitu request signing, in the browser.
 *
 * This is the scheme described in /docs/authentication, implemented with the Web Crypto
 * API for SHA-256 and ethers for the EIP-191 personal_sign. It is deliberately a small,
 * standalone module so it can be checked against the published test vectors.
 *
 * The message that gets signed is exactly:
 *
 *     {METHOD} {path}{?query} {timestamp} {sha256hex(body)}
 *
 * with single spaces between the four parts.
 */

/** Anything that can produce an EIP-191 personal_sign signature. `ethers.Wallet` fits. */
export interface PersonalSigner {
  readonly address: string;
  signMessage(message: string): Promise<string>;
}

export interface KakituHeaders {
  'X-Kakitu-Address': string;
  'X-Kakitu-Timestamp': string;
  'X-Kakitu-Signature': string;
}

/** SHA-256 of a UTF-8 string, lowercase hex. Requires a secure context. */
export async function sha256Hex(body: string): Promise<string> {
  const bytes = new TextEncoder().encode(body);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * The exact string to sign.
 *
 * `target` is the path, plus `?` and the query byte for byte if there is one, and no `?`
 * if there is not. `body` is the exact string that will be sent ('' when there is none).
 */
export async function signingMessage(
  method: string,
  target: string,
  timestamp: string,
  body = '',
): Promise<string> {
  return `${method.toUpperCase()} ${target} ${timestamp} ${await sha256Hex(body)}`;
}

/** The three headers the API wants. `body` must be the exact string you will send. */
export async function signedHeaders(
  signer: PersonalSigner,
  method: string,
  target: string,
  body = '',
  timestamp?: number | string,
): Promise<KakituHeaders> {
  const ts = String(timestamp ?? Math.floor(Date.now() / 1000));
  const signature = await signer.signMessage(await signingMessage(method, target, ts, body));
  return {
    'X-Kakitu-Address': signer.address,
    'X-Kakitu-Timestamp': ts,
    'X-Kakitu-Signature': signature,
  };
}

/**
 * The test vectors published on /docs/authentication, produced by the server's own
 * signing code with the public BIP-39 test key. `checkTestVectors` runs the signer above
 * against them, so a signing regression shows up as a failed self-check rather than as a
 * confusing 401 for a merchant.
 */
export const TEST_KEY_ADDRESS = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94';

export const TEST_VECTORS = [
  {
    method: 'GET',
    target: '/kyc/state?country=KE&tier=basic',
    timestamp: '1758240001',
    body: '',
    message:
      'GET /kyc/state?country=KE&tier=basic 1758240001 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    signature:
      '0x3660f0431d31e727a8ba5f33c788812c6a25e8507b9c2479324ed1259ad047fe6c44925337052d4037a86ade58ef860a890f3f7bfaeec5331deaf78e1fe50e681b',
  },
  {
    method: 'POST',
    target: '/ramp/deposit',
    timestamp: '1758240002',
    body: '{"amount_kes":1000,"phone":"+254700000000"}',
    message:
      'POST /ramp/deposit 1758240002 7a4c4c0f0333102cffe5a64621024fe6d094cbcc71d771c251a3600c43ac19a6',
    signature:
      '0x300fa9012768e1bcd22614d77d7724be7cdad84bbf65f482b536860ce0eb5a4e2329986faa234254388022acfb3f9c7640778bfc2021cc6eca0848f1556f6f171c',
  },
] as const;

/**
 * Signs each published vector with the public test key and compares. Returns the first
 * failure as a string, or null if every vector reproduced.
 */
export async function checkTestVectors(testKeySigner: PersonalSigner): Promise<string | null> {
  if (testKeySigner.address.toLowerCase() !== TEST_KEY_ADDRESS.toLowerCase()) {
    return `self-check signer is ${testKeySigner.address}, expected ${TEST_KEY_ADDRESS}`;
  }
  for (const v of TEST_VECTORS) {
    const built = await signingMessage(v.method, v.target, v.timestamp, v.body);
    if (built !== v.message) {
      return `message mismatch for ${v.method} ${v.target}\n  built    ${built}\n  expected ${v.message}`;
    }
    const sig = await testKeySigner.signMessage(built);
    if (sig.toLowerCase() !== v.signature.toLowerCase()) {
      return `signature mismatch for ${v.method} ${v.target}\n  built    ${sig}\n  expected ${v.signature}`;
    }
  }
  return null;
}
