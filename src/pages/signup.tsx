import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import BrowserOnly from '@docusaurus/BrowserOnly';
import type { HDNodeWallet } from 'ethers';

import { checkTestVectors, signedHeaders } from '../lib/kakituSign';
import styles from './signup.module.css';

const API_BASE = 'https://walletapi.kakitu.org';
const REGISTER_PATH = '/v1/merchants';

/** The public BIP-39 test key from /docs/authentication. Published everywhere; never money. */
const PUBLIC_TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const PUBLIC_TEST_PATH = "m/44'/60'/0'/0/0";

type Step = 'start' | 'details' | 'key' | 'done';

interface Details {
  business_name: string;
  contact_email: string;
  contact_phone: string;
  callback_url: string;
}

interface MerchantRecord {
  address: string;
  business_name: string;
  contact_email: string;
  contact_phone: string;
  callback_url: string;
  state: string;
  daily_cap_kes: number;
  per_charge_max_kes: number;
}

interface ApiFailure {
  title: string;
  detail: string;
  hint?: string;
  requestId?: string;
  code?: string;
}

// ---------------------------------------------------------------------------
// Validation. These mirror the documented rules so an obvious mistake is caught
// before a round trip. The server is still the authority; its message is shown.
// ---------------------------------------------------------------------------

/** Control, invisible and text-direction characters are refused by the API. */
// eslint-disable-next-line no-control-regex
const FORBIDDEN_NAME_CHARS = /[\u0000-\u001F\u007F­​-‏‪-‮⁠-⁤⁦-⁩﻿]/;
const PLAIN_EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
const PHONE_CHARS = /^[0-9+\s-]+$/;

function validate(d: Details): Partial<Record<keyof Details, string>> {
  const errors: Partial<Record<keyof Details, string>> = {};

  const name = d.business_name.trim();
  if (!name) {
    errors.business_name = 'Required. This is the name the payer sees in the M-Pesa prompt.';
  } else if (name.length > 100) {
    errors.business_name = 'At most 100 characters.';
  } else if (FORBIDDEN_NAME_CHARS.test(name)) {
    errors.business_name = 'Remove hidden or control characters — plain text only.';
  }

  const email = d.contact_email.trim();
  if (!email) {
    errors.contact_email = 'Required. This is where we write about your application.';
  } else if (email.length > 254) {
    errors.contact_email = 'At most 254 characters.';
  } else if (!PLAIN_EMAIL.test(email)) {
    errors.contact_email = 'Use a plain address like njeri@example.com, not "Name <a@b.co>".';
  }

  const phone = d.contact_phone.trim();
  if (phone) {
    if (phone.length > 20) {
      errors.contact_phone = 'At most 20 characters.';
    } else if (!PHONE_CHARS.test(phone)) {
      errors.contact_phone = 'Digits, spaces, + and - only.';
    }
  }

  const url = d.callback_url.trim();
  if (url) {
    let parsed: URL | undefined;
    try {
      parsed = new URL(url);
    } catch {
      errors.callback_url = 'That is not a valid URL.';
    }
    if (parsed) {
      if (parsed.protocol !== 'https:') {
        errors.callback_url = 'Must be https.';
      } else if (parsed.port && parsed.port !== '443') {
        errors.callback_url = 'Must be on port 443.';
      } else if (parsed.username || parsed.password) {
        errors.callback_url = 'No username or password in the URL.';
      } else if (url.length > 512) {
        errors.callback_url = 'At most 512 characters.';
      } else if (/[^ -~]/.test(parsed.hostname)) {
        errors.callback_url = 'The hostname must be ASCII. Give it in punycode (xn--…).';
      } else if (
        /^(localhost|.*\.(local|internal|lan|home|test|localhost))$/i.test(parsed.hostname) ||
        /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(parsed.hostname) ||
        parsed.hostname === '::1'
      ) {
        errors.callback_url =
          'Must be reachable from the public internet — our servers call it, not your browser.';
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Error translation. The API answers /v1/ errors with {error:{code,message,request_id}}
// and signing failures with the older {error:"unauthorized", reason:"…"}.
// ---------------------------------------------------------------------------

const CODE_HINTS: Record<string, string> = {
  invalid_request: 'Correct the field named above and try again.',
  merchant_name_frozen:
    'This wallet is already registered under a different business name, and the name is fixed once an operator has reviewed it. Write to kakitu@kakitu.org to have it changed.',
  request_too_large: 'Shorten the details and try again.',
  rate_limited: 'Too many attempts. Wait a minute and try again.',
  internal:
    'Something went wrong on our side. Try again shortly, and quote the request id below if it keeps happening.',
};

const AUTH_REASON_HINTS: Record<string, string> = {
  timestamp_out_of_range:
    "Your device's clock is more than two minutes out. Set the date and time to automatic and try again.",
  bad_timestamp: "Your device's clock could not be read correctly.",
  bad_signature: 'The request signature was not accepted. Please report this — it is our bug, not yours.',
  replay: 'That exact request was just sent. Try again.',
  missing_auth_headers: 'The request was sent without its signature. Reload the page and try again.',
  auth_unavailable: 'Our signing service is briefly unavailable. Try again in a moment.',
  unreadable_body: 'The request body could not be read. Shorten the details and try again.',
};

function describeFailure(status: number, payload: unknown): ApiFailure {
  const body = (payload ?? {}) as Record<string, unknown>;

  // Older shape from the signing layer: {"error":"unauthorized","reason":"…"}
  if (typeof body.error === 'string') {
    const reason = typeof body.reason === 'string' ? body.reason : 'unknown';
    return {
      title: 'The request was not accepted',
      detail: AUTH_REASON_HINTS[reason] ?? `The server refused the signature (${reason}).`,
      code: reason,
    };
  }

  // The /v1/ envelope: {"error":{"code","message","request_id"}}
  const err = body.error as Record<string, unknown> | undefined;
  if (err && typeof err === 'object') {
    const code = typeof err.code === 'string' ? err.code : undefined;
    const message =
      typeof err.message === 'string' && err.message.trim()
        ? err.message
        : 'The server refused the request but did not say why.';
    return {
      title: 'Registration was refused',
      detail: message,
      hint: code ? CODE_HINTS[code] : undefined,
      requestId: typeof err.request_id === 'string' ? err.request_id : undefined,
      code,
    };
  }

  return {
    title: 'Registration was refused',
    detail: `The server answered ${status} in a shape this page did not understand.`,
  };
}

// ---------------------------------------------------------------------------

function SignupFlow() {
  const [step, setStep] = useState<Step>('start');
  const [details, setDetails] = useState<Details>({
    business_name: '',
    contact_email: '',
    contact_phone: '',
    callback_url: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof Details, string>>>({});
  const [secureContext, setSecureContext] = useState<boolean | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [keyVisible, setKeyVisible] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [record, setRecord] = useState<MerchantRecord | null>(null);
  const [wasUpdate, setWasUpdate] = useState(false);

  // The key lives here and nowhere else: not in localStorage, not in sessionStorage, not
  // in the URL, not in a cookie, not sent anywhere. A refs holds it so it is not copied
  // into React state snapshots. Closing or reloading the tab destroys it.
  const walletRef = useRef<HDNodeWallet | null>(null);
  const secretsRef = useRef<{ privateKey: string; phrase: string } | null>(null);

  useEffect(() => {
    setSecureContext(window.isSecureContext === true && typeof crypto?.subtle !== 'undefined');
    // Drop the key when this page is navigated away from. Deliberately NOT on `pagehide`:
    // on Android and iOS that fires when the user switches apps, which is exactly what
    // someone does to put the key in their password manager. They must be able to come
    // back and finish.
    return () => {
      walletRef.current = null;
      secretsRef.current = null;
    };
  }, []);

  const detailsValid = useMemo(() => Object.keys(validate(details)).length === 0, [details]);

  const setField = (key: keyof Details) => (e: { target: { value: string } }) => {
    setDetails((d) => ({ ...d, [key]: e.target.value }));
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
  };

  const submitDetails = (e: FormEvent) => {
    e.preventDefault();
    const errors = validate(details);
    setFieldErrors(errors);
    if (Object.keys(errors).length === 0) {
      setStep('key');
    }
  };

  const generate = useCallback(async () => {
    setGenError(null);
    setGenerating(true);
    try {
      if (!window.isSecureContext) {
        throw new Error(
          'This page is not on a secure connection, so a key generated here could not be trusted.',
        );
      }
      if (typeof crypto?.getRandomValues !== 'function' || typeof crypto?.subtle === 'undefined') {
        throw new Error(
          'This browser does not offer a cryptographic random source. Try an up-to-date Chrome or Firefox.',
        );
      }

      // Loaded as its own chunk from this site. No third-party script is fetched.
      const { HDNodeWallet, Mnemonic, Wallet } = await import('ethers');

      // Prove the signer in THIS browser reproduces the signatures published on the
      // authentication page before anyone relies on it.
      const testSigner = HDNodeWallet.fromMnemonic(
        Mnemonic.fromPhrase(PUBLIC_TEST_MNEMONIC),
        PUBLIC_TEST_PATH,
      );
      const selfCheck = await checkTestVectors(testSigner);
      if (selfCheck) {
        throw new Error(
          `This browser did not reproduce the published signing test vectors, so the key was not generated. Please report this to kakitu@kakitu.org. (${selfCheck.split('\n')[0]})`,
        );
      }

      // ethers' browser build draws this entropy from crypto.getRandomValues.
      const wallet = Wallet.createRandom();
      walletRef.current = wallet;
      secretsRef.current = {
        privateKey: wallet.privateKey,
        phrase: wallet.mnemonic?.phrase ?? '',
      };
      setAddress(wallet.address);
      setKeyVisible(true);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  }, []);

  const copy = useCallback(async (what: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      window.setTimeout(() => setCopied(null), 2500);
    } catch {
      setCopied('failed');
    }
  }, []);

  const download = useCallback(() => {
    const s = secretsRef.current;
    if (!s || !address) return;
    const text = [
      'KAKITU MERCHANT KEY — KEEP THIS SECRET',
      '',
      'Anyone with this private key can move the money that settles to this address.',
      'Kakitu does not have a copy and cannot recover it.',
      '',
      `address      ${address}`,
      `private key  ${s.privateKey}`,
      s.phrase ? `recovery phrase  ${s.phrase}` : '',
      '',
      `created      ${new Date().toISOString()}`,
      'docs         https://developer.kakitu.org/docs/authentication',
      '',
      'Use it as KAKITU_PRIVATE_KEY on the server that talks to the Kakitu API.',
      'Do not email it, do not paste it into a chat, do not put it in your source code.',
      '',
    ].join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kakitu-merchant-key-${address.slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke promptly so the key is not reachable through a stale blob: URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [address]);

  const register = useCallback(async () => {
    const wallet = walletRef.current;
    if (!wallet) {
      setFailure({
        title: 'The key is no longer in this page',
        detail:
          'Your key was held in memory only, and this page has been reloaded since it was created. Nothing was submitted and nothing was lost. Start again to create a new key.',
      });
      return;
    }
    setFailure(null);
    setSubmitting(true);
    try {
      // Serialise once, hash that string, send that same string. Optional fields are only
      // sent when filled: an absent field means "leave it alone" to the API.
      const payload: Record<string, string> = {
        business_name: details.business_name.trim(),
        contact_email: details.contact_email.trim(),
      };
      if (details.contact_phone.trim()) payload.contact_phone = details.contact_phone.trim();
      if (details.callback_url.trim()) payload.callback_url = details.callback_url.trim();
      const raw = JSON.stringify(payload);

      const headers = await signedHeaders(wallet, 'POST', REGISTER_PATH, raw);

      let res: Response;
      try {
        res = await fetch(API_BASE + REGISTER_PATH, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: raw,
        });
      } catch {
        setFailure({
          title: 'Could not reach the Kakitu API',
          detail:
            'The request never got an answer. Check your internet connection and try again — your key is still here, nothing was lost.',
          hint: `If you are running this page somewhere other than developer.kakitu.org, the API will not accept the request from that address. Use the published page, or register from a server using the example at /docs/authentication.`,
        });
        return;
      }

      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        /* fall through to the shape-unknown message below */
      }

      if (!res.ok) {
        setFailure(describeFailure(res.status, body));
        return;
      }

      setWasUpdate(res.status === 200);
      setRecord(body as MerchantRecord);
      // Shown once, and now gone from the screen. It stays in memory only so that the
      // retry button can sign again; reloading the page destroys it.
      setKeyVisible(false);
      secretsRef.current = null;
      setStep('done');
    } finally {
      setSubmitting(false);
    }
  }, [details]);

  // -------------------------------------------------------------------------

  const stepIndex: Record<Step, number> = { start: 0, details: 1, key: 2, done: 3 };
  const current = stepIndex[step];
  const stepLabels = ['Before you start', 'Your business', 'Your key', 'Submitted'];

  return (
    <div className={styles.page}>
      <h1>Register as a Kakitu merchant</h1>
      <p className={styles.lede}>
        Collect M-Pesa payments and be paid in KSHS straight to your own wallet. This page
        creates the wallet that is both your API credential and your settlement address, and
        submits your registration for review. It takes about two minutes.
      </p>

      <ol className={styles.steps}>
        {stepLabels.map((label, i) => (
          <li
            key={label}
            className={[
              styles.step,
              i === current ? styles.stepActive : '',
              i < current ? styles.stepDone : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {i < current ? '✓' : i + 1}. {label}
          </li>
        ))}
      </ol>

      {secureContext === false && (
        <div className={styles.error}>
          <p>
            <strong>This page is not on a secure connection.</strong>
          </p>
          <p>
            A key generated here could be read by anyone on the network, so this page will not
            generate one. Open{' '}
            <a href="https://developer.kakitu.org/signup">https://developer.kakitu.org/signup</a>{' '}
            instead.
          </p>
        </div>
      )}

      {/* ---------------- step 1: what this is ---------------- */}

      {step === 'start' && (
        <>
          <div className={styles.card}>
            <h2>How Kakitu identifies you</h2>
            <p>
              There is no API key. <strong>A wallet address is the credential.</strong> Every
              request you make is signed with that wallet's private key, and the server works out
              who you are from the signature. The same address is where your collections are
              paid, so it holds your business's takings.
            </p>
            <p>
              This page generates that wallet <strong>in your browser</strong>. The private key is
              never sent to Kakitu, never written to this device's storage, and never put in a
              web address. We cannot see it, and we cannot recover it for you. It exists only in
              this tab's memory and disappears when you close or reload the page.
            </p>
            <p className={styles.footnote}>
              This page loads no third-party scripts, no analytics and no outside fonts —
              every file it runs comes from this site. The only request it makes is the
              registration itself, to <code>walletapi.kakitu.org</code>. Your key is not part
              of that request; only the signature it produces, which cannot be turned back
              into the key.
            </p>
          </div>

          <div className={styles.notice}>
            <p style={{ margin: '0 0 0.5rem' }}>
              <strong>This key is for the integration, and only that.</strong>
            </p>
            <p style={{ margin: 0 }}>
              It is not your personal wallet and should not be one. Treat it like the key to the
              till: it belongs on the server that talks to the Kakitu API, held by whoever is
              responsible for the business's money. Read{' '}
              <Link to="/docs/quickstart">the quickstart</Link> and{' '}
              <Link to="/docs/authentication">Authentication</Link> before you go live.
            </p>
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => setStep('details')}
            >
              Start
            </button>
          </div>
        </>
      )}

      {/* ---------------- step 2: business details ---------------- */}

      {step === 'details' && (
        <form className={styles.card} onSubmit={submitDetails} noValidate>
          <h2>Your business</h2>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="business_name">
              Business name
            </label>
            <input
              id="business_name"
              name="organization"
              className={`${styles.input} ${fieldErrors.business_name ? styles.inputInvalid : ''}`}
              value={details.business_name}
              onChange={setField('business_name')}
              maxLength={100}
              autoComplete="organization"
              required
            />
            <small className={styles.hint}>
              Your payers read this name in the M-Pesa prompt before they type their PIN. It is
              fixed once your account has been reviewed, so give the name customers know.
            </small>
            {fieldErrors.business_name && (
              <span className={styles.fieldError}>{fieldErrors.business_name}</span>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="contact_email">
              Contact email
            </label>
            <input
              id="contact_email"
              type="email"
              inputMode="email"
              className={`${styles.input} ${fieldErrors.contact_email ? styles.inputInvalid : ''}`}
              value={details.contact_email}
              onChange={setField('contact_email')}
              maxLength={254}
              autoComplete="email"
              required
            />
            <small className={styles.hint}>
              Where we write about your application. A plain address, not “Name &lt;a@b.co&gt;”.
            </small>
            {fieldErrors.contact_email && (
              <span className={styles.fieldError}>{fieldErrors.contact_email}</span>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="contact_phone">
              Contact phone <span className={styles.optional}>— optional</span>
            </label>
            <input
              id="contact_phone"
              type="tel"
              inputMode="tel"
              className={`${styles.input} ${fieldErrors.contact_phone ? styles.inputInvalid : ''}`}
              value={details.contact_phone}
              onChange={setField('contact_phone')}
              maxLength={20}
              autoComplete="tel"
              placeholder="+254 700 000 000"
            />
            {fieldErrors.contact_phone && (
              <span className={styles.fieldError}>{fieldErrors.contact_phone}</span>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="callback_url">
              Webhook URL <span className={styles.optional}>— optional</span>
            </label>
            <input
              id="callback_url"
              type="url"
              inputMode="url"
              className={`${styles.input} ${fieldErrors.callback_url ? styles.inputInvalid : ''}`}
              value={details.callback_url}
              onChange={setField('callback_url')}
              maxLength={512}
              placeholder="https://example.co.ke/kakitu/webhook"
            />
            <small className={styles.hint}>
              Where we deliver payment events. Must be <code>https</code> and reachable from the
              public internet. You can add it later. See <Link to="/docs/webhooks">Webhooks</Link>.
            </small>
            {fieldErrors.callback_url && (
              <span className={styles.fieldError}>{fieldErrors.callback_url}</span>
            )}
          </div>

          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={() => setStep('start')}
            >
              Back
            </button>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
              Next: create your key
            </button>
          </div>
        </form>
      )}

      {/* ---------------- step 3: the key ---------------- */}

      {step === 'key' && !address && (
        <div className={styles.card}>
          <h2>Create your key</h2>
          <p>
            The next click generates a wallet using your browser's cryptographic random number
            generator. <strong>You will be shown the private key exactly once.</strong> Have
            somewhere to put it ready before you press the button — a password manager is best.
          </p>
          <p className={styles.footnote}>
            Nobody at Kakitu will ever see this key, and nobody at Kakitu can ever ask you for it.
            If someone does, it is not us.
          </p>
          <p className={styles.footnote}>
            If you have a developer, generating the key on your own server is safer than any web
            page, because no browser or browser extension ever touches it. The{' '}
            <Link to="/docs/authentication">Authentication</Link> page has a short program that
            does the whole registration. This page is for everyone else.
          </p>
          {genError && (
            <div className={styles.error}>
              <p>{genError}</p>
            </div>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={() => setStep('details')}
            >
              Back
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={generate}
              disabled={generating || secureContext === false}
            >
              {generating ? 'Generating…' : 'Generate my key'}
            </button>
          </div>
        </div>
      )}

      {step === 'key' && address && (
        <>
          <div className={styles.cardDanger}>
            <h2 className={styles.dangerHeading}>
              Save this key now. It is shown once and cannot be recovered.
            </h2>
            <p>
              If you lose it, nobody — not you, not Kakitu — can get it back, and any money that
              has settled to your address is gone with it. If someone else gets it, they can take
              that money. There is no reset and no support ticket that fixes either.
            </p>

            {keyVisible && secretsRef.current ? (
              <>
                <div className={styles.secretBlock}>
                  <div className={styles.secretLabel}>Private key — secret</div>
                  <pre className={`${styles.secret} ${styles.secretDanger}`}>
                    {secretsRef.current.privateKey}
                  </pre>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnSecondary}`}
                      onClick={() => copy('key', secretsRef.current!.privateKey)}
                    >
                      {copied === 'key' ? 'Copied ✓' : 'Copy private key'}
                    </button>
                    <button
                      type="button"
                      className={`${styles.btn} ${styles.btnSecondary}`}
                      onClick={download}
                    >
                      Download as a file
                    </button>
                  </div>
                  {copied === 'failed' && (
                    <small className={styles.hint}>
                      Your browser blocked the clipboard. Select the key above and copy it by hand.
                    </small>
                  )}
                  <small className={styles.hint}>
                    Downloading puts the key in this device's Downloads folder in plain text. On a
                    shared or shop computer, copy it into a password manager and delete the file.
                  </small>
                </div>

                {secretsRef.current.phrase && (
                  <details className={styles.disclosure}>
                    <summary>Show the same key as 12 words (easier to write on paper)</summary>
                    <div className={styles.secretBlock}>
                      <p className={styles.footnote} style={{ marginTop: '0.5rem' }}>
                        This phrase and the private key above are the <em>same secret</em> in two
                        forms. Saving one is enough. Anyone who reads either one controls the
                        money.
                      </p>
                      <pre className={`${styles.secret} ${styles.phrase}`}>
                        {secretsRef.current.phrase}
                      </pre>
                    </div>
                  </details>
                )}
              </>
            ) : (
              <p>
                <strong>The key is no longer on screen.</strong> It is held in this tab's memory
                only, to sign your registration. Reloading this page destroys it.
              </p>
            )}

            <div className={styles.secretBlock}>
              <div className={styles.secretLabel}>Your address — safe to share</div>
              <pre className={styles.secret}>{address}</pre>
            </div>

            <label className={styles.checkRow}>
              <input
                type="checkbox"
                checked={savedConfirmed}
                onChange={(e) => {
                  setSavedConfirmed(e.target.checked);
                  if (e.target.checked) setKeyVisible(false);
                }}
              />
              <span>
                I have saved the private key somewhere safe. I understand Kakitu does not have a
                copy and cannot recover it, and that whoever holds it controls the money that
                settles to this address.
              </span>
            </label>
            {savedConfirmed && !keyVisible && (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSecondary}`}
                onClick={() => setKeyVisible(true)}
              >
                Show it again (still in this tab)
              </button>
            )}
          </div>

          <div className={styles.card}>
            <h3>You are registering</h3>
            <p style={{ marginBottom: '0.25rem' }}>
              <strong>{details.business_name.trim()}</strong>
            </p>
            <p className={styles.footnote} style={{ margin: 0 }}>
              {details.contact_email.trim()}
              {details.contact_phone.trim() ? ` · ${details.contact_phone.trim()}` : ''}
              {details.callback_url.trim() ? ` · ${details.callback_url.trim()}` : ''}
            </p>

            <div className={styles.actions}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSecondary}`}
                onClick={() => setStep('details')}
                disabled={submitting}
              >
                Change details
              </button>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnPrimary}`}
                onClick={register}
                disabled={!savedConfirmed || submitting}
              >
                {submitting ? 'Submitting…' : 'Submit registration'}
              </button>
            </div>
            {!savedConfirmed && (
              <small className={styles.hint}>
                Confirm you have saved the key before submitting.
              </small>
            )}

            {failure && (
              <div className={styles.error}>
                <p>
                  <strong>{failure.title}</strong>
                </p>
                <p>{failure.detail}</p>
                {failure.hint && <p>{failure.hint}</p>}
                {(failure.requestId || failure.code) && (
                  <p className={styles.errorMeta}>
                    {failure.code ? `code: ${failure.code}` : ''}
                    {failure.code && failure.requestId ? ' · ' : ''}
                    {failure.requestId ? `request id: ${failure.requestId}` : ''}
                    {' — quote this if you write to kakitu@kakitu.org.'}
                  </p>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* ---------------- step 4: done ---------------- */}

      {step === 'done' && record && (
        <>
          <div className={styles.card}>
            <h2>{wasUpdate ? 'Your details were updated' : 'Registration received'}</h2>
            <p>
              <strong>{record.business_name}</strong> is registered with the address below, and is{' '}
              <span className={styles.statePill}>{record.state}</span>.
            </p>
            <div className={styles.secretBlock}>
              <div className={styles.secretLabel}>Your merchant address</div>
              <pre className={styles.secret}>{record.address}</pre>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={`${styles.btn} ${styles.btnSecondary}`}
                  onClick={() => copy('address', record.address)}
                >
                  {copied === 'address' ? 'Copied ✓' : 'Copy address'}
                </button>
              </div>
            </div>
            <p className={styles.footnote}>
              This address is safe to share. It is your API identity and where your collections
              are paid.
            </p>
          </div>

          <div className={styles.card}>
            <h2>What happens next</h2>
            <ol className={styles.nextList}>
              <li>
                <strong>A person reviews it.</strong> Approval is done by a Kakitu operator, not by
                an automated check. While you are <code>pending</code>, collections are refused.
              </li>
              <li>
                <strong>We write to {record.contact_email}.</strong> Watch that inbox. If you need
                to chase it, write to <strong>kakitu@kakitu.org</strong> with your address above.
              </li>
              <li>
                <strong>Check your own state any time</strong> by calling{' '}
                <code>GET /v1/merchants/me</code> with your key — see{' '}
                <Link to="/docs/merchants">Merchants</Link>. When <code>state</code> reads{' '}
                <code>approved</code>, you can create charges.
              </li>
              <li>
                <strong>Build the integration</strong> with{' '}
                <Link to="/docs/quickstart">the quickstart</Link>. Put your private key in an
                environment variable called <code>KAKITU_PRIVATE_KEY</code> on your server — never
                in your source code, and never in a message to anyone.
              </li>
            </ol>
          </div>

          <div className={styles.noticeInfo}>
            <p style={{ margin: 0 }}>
              <strong>The key is gone from this page.</strong> It was held in memory only and has
              been dropped. If you did not save it, register again from this page with a new key —
              nothing is lost while your account is still <code>pending</code>, and you can tell us
              to ignore the first one.
            </p>
          </div>

          <div className={styles.actions}>
            <Link className={`${styles.btn} ${styles.btnPrimary}`} to="/docs/quickstart">
              Read the quickstart
            </Link>
            <Link className={`${styles.btn} ${styles.btnSecondary}`} to="/docs/going-live">
              Going live
            </Link>
          </div>
        </>
      )}
    </div>
  );
}

export default function SignupPage() {
  return (
    <Layout
      title="Register as a merchant"
      description="Create a Kakitu merchant wallet in your browser and register it with the developer API. The private key is generated locally and never leaves your device."
    >
      <BrowserOnly
        fallback={
          <div className={styles.page}>
            <h1>Register as a Kakitu merchant</h1>
            <p className={styles.lede}>
              This page needs JavaScript, because your wallet key is created here in your
              browser rather than on our servers. If it does not load, you can register from a
              server instead using the example on{' '}
              <Link to="/docs/authentication">Authentication</Link>.
            </p>
          </div>
        }
      >
        {() => <SignupFlow />}
      </BrowserOnly>
    </Layout>
  );
}
