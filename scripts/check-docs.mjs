#!/usr/bin/env node
// check-docs: fails if the docs and the OpenAPI spec have drifted from what the server does.
//
//   node scripts/check-docs.mjs
//   KAKITU_SERVER_DIR=/path/to/kakitu-wallet-server node scripts/check-docs.mjs
//
// The lists below are the contract, copied from the server's own source. With KAKITU_SERVER_DIR
// set, the script also reads the server and fails if a list here has fallen behind it, so the
// check cannot quietly go stale in the other direction.
//
//   EVENTS   models/dbmodels/webhook_event.go   (the Webhook* constants)
//   ERRORS   apiv1/errors.go                    (codeTable)
//   FIELDS   controller/v1_payout_c.go, v1_payout_destinations_c.go, transfers_c.go,
//            repository/transfer_notify.go, repository/payout_destination_repo.go,
//            charge/projector.go
//   CONFIG   controller/config_c.go                (every json key of PublicConfig = GET /config)
//
// Beyond drift, it also guards the mistakes the 2026-11-25 audit found, so none can come back:
// a page or SDK README that asks for (or reads) a recovery phrase; POST /v1/merchants described
// as a way to register; mpesa_hidden missing; an undocumented /config key; the spec's "exact
// bytes" claim about GET /v1/events; stale numbers; and internal links whose #anchor is gone.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const failures = [];
const fail = (msg) => failures.push(msg);
const notes = [];

// ---------------------------------------------------------------- the server's lists

const EVENTS = [
  "charge.paid", "charge.settled", "charge.failed",
  "transfer.received",
  "payout.approved", "payout.rejected", "payout.expired", "payout.cancelled", "payout.paid", "payout.failed",
  "payout_destination.added", "payout_destination.removed", "payout_lock.changed",
];

const ERROR_CODES = [
  "invalid_request", "unauthorized", "merchant_not_registered", "merchant_not_approved",
  "merchant_suspended", "merchant_name_frozen", "open_loan", "account_blocked", "idempotency_key_required", "idempotency_key_invalid",
  "idempotency_key_reuse", "idempotency_key_in_progress", "idempotency_key_acted",
  "idempotency_unavailable", "request_too_large", "amount_below_minimum", "amount_above_maximum",
  "daily_cap_exceeded", "payer_velocity_exceeded", "rate_limited", "charge_not_found",
  "reference_reused", "rail_unavailable", "order_not_found", "event_not_found", "payouts_disabled",
  "payout_daily_cap_exceeded", "payout_amount_above_maximum", "payout_not_found",
  "payout_quote_not_found", "payout_approval_required", "payout_not_approved",
  "payout_approval_mismatch", "payout_open_requests_exceeded", "payout_destination_locked",
  "payout_destination_not_found", "payout_destinations_full", "profile_required", "bank_unavailable",
  "unknown_bank", "account_not_found", "insufficient_balance", "identity_verification_required",
  "internal",
];

// Codes the docs already describe for a server change that is being built in parallel and is not
// on the server branch this script is pointed at yet. The server comparison tolerates their
// absence (and says so), and fails once the server has them so they are moved out of this list.
const PENDING_SERVER_CODES = [];

// Answered by the wallet's own routes (/ramp/*), not /v1, and documented beside the /v1 codes.
// mpesa_hidden: M-Pesa is hidden (mpesa_rails_visible false); a new cash-out or top-up answers it
// even when that rail is switched on (controller/mpesa_visibility.go).
const WALLET_CODES = ["deposits_paused", "mpesa_hidden"];
// The wallet's own M-Pesa cash-out (/ramp/kes, controller/kesout_c.go). Not /v1 codes, so they
// are not counted in the forty-four; each needs a table row on the Errors page.
const KES_OUT_CODES = [
  "kes_offramp_disabled", "kes_offramp_paused", "phone_not_verified", "phone_too_new",
  "amount_below_minimum", "amount_over_limit", "daily_limit_reached", "insufficient_balance",
  "payout_unavailable", "quote_expired", "invalid_relay", "relay_failed", "use_agent_cashout",
  "destination_locked", "mpesa_hidden",
];

// Every key GET /config returns (controller/config_c.go, PublicConfig). Each must be a table row
// on docs/config.md and a property of the spec's PublicConfig. With KAKITU_SERVER_DIR set, this
// list is compared with the server's struct both ways.
const CONFIG_KEYS = [
  "chain_id", "kshs_contract", "forwarder", "usdc_contract", "treasury_address", "public_rpc_url",
  "relay_max_per_tx_kes", "deposit_max_per_order_usd", "deposit_min_per_order_usd",
  "withdraw_max_per_order_kes", "withdraw_min_per_order_kes", "directory_bucket_hex",
  "directory_max_buckets", "min_supported_build", "latest_build", "store_url_android",
  "store_url_ios", "app", "support_phone", "agent_app_url_android", "agent_app_url_ios",
  "mint_rate_kes_per_usdc", "mint_spread_bps", "agent_fee_bps", "agent_fee_cap_kshs",
  "agency_mode", "platform_fee_bps", "platform_fee_cap_kshs", "agent_min_float_usdc",
  "order_expiry_minutes", "cashout_capacity_kes", "agent_float_networks", "customer_usdt_networks",
  "kes_offramp_enabled", "kes_offramp_min_kes", "kes_offramp_max_kes", "kes_offramp_fee_bps",
  "kes_offramp_fee_min_kes", "mpesa_rails_visible", "kes_onramp_enabled", "kes_onramp_min_kes",
  "kes_onramp_max_kes", "kes_onramp_fee_bps", "kes_onramp_fee_min_kes",
  "kes_onramp_unproved_max_kes", "kes_onramp_max_now_kes",
];

const PAYOUT_STATES = [
  "quoted", "pending_approval", "approved", "rejected", "held", "dispatched", "paid", "failed",
  "cancelled", "expired",
];

// page -> [what it must mention]. A field is checked as a backticked word, so prose that merely
// contains the letters does not count.
const FIELDS = {
  "docs/events.md": [
    // transfer.received
    "transfer.tx_hash", "transfer.log_index", "transfer.from", "transfer.to", "transfer.amount_kes",
    "transfer.value_wei", "transfer.block_number", "transfer.observed_at", "transfer.reference",
    // payout.approved
    "payout.approval_expires_at",
    // the controls events
    "destination.id", "destination.type", "destination.ending", "destination.active_at",
    "payout_lock.locked", "payout_lock.unlocks_at",
    // charges
    "charge.fee_kes", "charge.credited_kes",
  ],
  "docs/transfers.md": [
    "reference", "GET /transfers", "tx_hash", "direction", "kind", "counterpart", "amount_kes",
    "value_wei", "status", "submitted_at", "next_before", "transfers_unavailable",
  ],
  "docs/payouts.md": [
    "payouts_disabled",
    "beneficiary.type", "phone", "till", "paybill", "account", "bank_code", "name",
    "POST /v1/payouts/requests", "approval_expires_at", "payout_id", "pending_approval",
    "GET /v1/payout-destinations", "POST /v1/payout-destinations", "DELETE /v1/payout-destinations/{id}",
    "POST /v1/payout-destinations/lock", "payout_locked", "payout_unlocks_at", "active_at",
    "cooling_off", "holder_name", "payout_cooling_off_hours",
  ],
  "docs/pricing.md": ["kes_offramp_fee_bps", "kes_offramp_fee_min_kes", "agent_fee_bps"],
  "docs/collections.md": ["reference", "transfer.received"],
  "docs/limits.md": ["kes_offramp_max_kes"],
  // The wallet's own cash-out to its proved M-Pesa number (controller/kesout_c.go, /config).
  "docs/cash-out.md": [
    "kes_offramp_enabled", "kes_offramp_min_kes", "kes_offramp_max_kes", "kes_offramp_fee_bps",
    "kes_offramp_fee_min_kes", "burn_kshs", "phone_not_verified", "destination_locked",
    "POST /ramp/kes/quote", "mpesa_rails_visible", "mpesa_hidden",
  ],
  "docs/extension.md": [
    "ebcjlgfjbbgoldipdhbcmciebdiadifg", "reference",
    // extension 0.2.7: pay() without connect(), its two new refusals, the Lipa button, the badge
    "ALREADY_PENDING", "RATE_LIMITED", "NOT_CONNECTED", "kakitu:payfailed", "kakitu:paid",
    "GET /merchants/verified/{address}",
  ],
  "docs/errors.md": ["deposits_paused", "mpesa_hidden"],
  "docs/merchants.md": ["POST /v1/merchants", "merchant_not_registered", "payout_locked", "payout_unlocks_at",
    "POST /v1/merchants/me/webhook-secret", "webhook_secret"],
  "docs/intro.md": ["mpesa_rails_visible"],
  "docs/going-live.md": ["mpesa_rails_visible", "mpesa_hidden"],
};

// Prose that must be on the page, as plain text (these are sentences, not fields).
const PHRASES = {
  "docs/extension.md": [
    "Chrome Web Store", "is refused", "spaces or emoji",
    "Lipa na Kakitu", "not proof of payment", "Content-Security-Policy", "Verified Kakitu merchant",
    // the snippet's distinctive lines, so the docs and the kakitu.org dashboard cannot drift
    'class="lipa-na-kakitu"', "if (reason !== 'UNCONFIRMED') btn.disabled = false;",
    "e.reason === 'NOT_CONNECTED'", "amountKes: String(btn.dataset.amount)",
  ],
  // Merchants onboard at kakitu.org/merchant with a wallet made in the Kakitu app; the docs
  // never make a wallet (founder decision, 2026-11-22).
  "docs/quickstart.md": ["kakitu.org/merchant", "Kakitu app",
    // no safe key export exists: server-side signing is coming soon, and the words go nowhere
    "{#server-side-signing}", "Server-side signing for merchant wallets is coming soon",
    "Your 12 words go into the Kakitu app and the Kakitu extension, and nowhere else."],
  // POST /v1/merchants updates an existing merchant; it never makes one (founder, 2026-11-25)
  "docs/merchants.md": ["kakitu.org/merchant", "It does not make a merchant, and it is not a way to apply.",
    "This route is the only way to set it"],
  "docs/going-live.md": ["kakitu.org/merchant", "This is the only way to become a merchant"],
  // the store version and what needs the newer one
  "docs/extension.md": ["{#which-version}", "The Chrome Web Store has version 0.2.4 today.",
    "GET /merchants/verified/{address}", "0.2.7 and later"],
  // payouts are off: the real answers, not a blanket 403
  "docs/payouts.md": ["`404 payout_quote_not_found`, for every `quote_id`",
    "| `POST /v1/payout-destinations` (saving a place) | `403 payouts_disabled`. |",
    "**An unlocked merchant's approved payout to a phone or a till can still be signed**"],
  "docs/events.md": ["{#what-is-not-announced}", "It is the same JSON value, not the same bytes"],
  "docs/webhooks.md": ["**That is the only way to set one**"],
  "docs/transfers.md": ["Page until `next_before` is absent."],
};

// Every SDK README must say it is not published, must cover GET /transfers, and must not show a
// registration or a charge as working code.
const SDK_READMES = ["sdk/ts/README.md", "sdk/python/README.md", "sdk/php/README.md"];
const SDK_README_PHRASES = ["**Not published.**", "GET /transfers", "Server-side signing is coming soon"];
const SDK_README_FORBIDDEN = [
  [/merchants(\.|->)register\(/, "registration examples: POST /v1/merchants no longer registers (use update)"],
  [/charges(\.|->)create\(/, "charges are not available; do not show charges.create as working code"],
  [/quotes(\.|->)create\(/, "POST /v1/quotes is not available; do not show it as working code"],
  [/Events are `charge\.paid`/, "there are thirteen event types"],
];

// Files that must not exist: dead Docusaurus samples and stale reports that contradicted the pages.
const MUST_NOT_EXIST = ["blog", "DOCS-REPORT.md", "sdk/ts/REPORT.md", "sdk/python/REPORT.md", "sdk/php/REPORT.md"];

// Words that must not appear anywhere in the docs or the spec.
const FORBIDDEN = [
  [/nothing notifies/i, "claims nothing notifies a merchant of a payment; transfer.received does"],
  [/no webhook, no push, no SMS/i, "claims there is no webhook for an incoming payment"],
  [/not on the Chrome Web Store/i, "the extension is on the Chrome Web Store"],
  [/K\$HS/, "the currency symbol is KSHS"],
  [/pretium/i, "names a rail"],
  [/fonbnk/i, "names a rail"],
  [/stolen[- ]key|theft protection|against theft/i, "the payout lock controls where cash-outs go; it is not theft protection"],
  [/\bthirty-one codes\b/i, "the closed set is forty-four codes"],
  [/\bpartner/i, "Kakitu runs its own M-Pesa ramp; there is no partner to name"],
  [/since 30 October 2026|on 30 October 2026/i, "M-Pesa collections through the old route are gone"],
  [/\bSTK\b|\bBuni\b/, "customer copy never names the bank's API"],
  [/PIN prompt on the payer|M-Pesa PIN prompt|pay out to (a|an) (till|paybill|bank)/i,
    "M-Pesa collections and third-party payouts are not live (outside a rebuilding fence)", "fenceable"],
  [/Wallet\.createRandom|createRandom\(/, "the docs never make a wallet; a merchant makes it in the Kakitu app"],
  [/\]\(\/signup\)|href=["']\/signup|to: ["']\/signup|developer\.kakitu\.org\/signup/,
    "merchant sign-up is at kakitu.org/merchant, not /signup"],
  [/there is no `payout\.paid`|no `payout\.paid` or `payout\.failed`/i, "payout.paid and payout.failed are raised"],
  // Recovery phrases (2026-11-25). Nothing a merchant reads may ask for the 12 words, take them
  // as input, or derive a key from them. The 12 words go into the Kakitu app and extension only.
  [/fromPhrase|fromMnemonic|from_mnemonic|mnemonicToSeed|mnemonic_to_seed|HDNodeWallet|Bip39|bip39\.|generateMnemonic/,
    "code that reads, derives from or makes a recovery phrase; the docs never touch one"],
  [/\bmnemonic\b/i, "names a mnemonic; the docs never ask for, show or derive from a recovery phrase"],
  [/abandon abandon/, "a mnemonic, even the public test one: give test keys in hex"],
  [/(question|prompt|input|readline)\s*\([^)\n]*(words|phrase|seed)/i, "a script that asks for the recovery phrase"],
  [/\b(enter|type|paste|input)\s+(your|the)\s+(12|twelve)[- ]words?\b(?!\s+into (a|any) )(?! into nothing)/i,
    "tells the reader to type their 12 words somewhere; only the Kakitu app and extension take them"],
  [/derive (it|the key|your key|a key) from (the|your) (12|twelve)/i, "deriving a key from the 12 words"],
  // POST /v1/merchants never registers (2026-11-25)
  [/POST \/v1\/merchants (to|and) register|POST \/v1\/merchants first|registration is an upsert|Register or update the signing wallet|cannot register as a merchant/i,
    "POST /v1/merchants does not register a merchant; applying is at kakitu.org/merchant"],
  // GET /v1/events payload is the same JSON value, not the same bytes
  [/the exact bytes that were|exact body we sent|signed webhook body verbatim/i,
    "GET /v1/events payload is not the delivered bytes; a signature cannot be checked against it"],
  // stale numbers and versions
  [/"relay_max_per_tx_kes":\s*500000/, "the live per-transfer cap is 50000; read relay_max_per_tx_kes from /config"],
  [/(rolling out|from|with|Rolling out) (with )?(Kakitu )?extension 0\.2\.7|extension 0\.2\.7\)/i,
    "0.2.7 was never published; the store has 0.2.4 and the newer behaviour needs 0.2.8"],
  [/platform's \(on today\)|platform switch is on today/i, "payouts are not available; no switch is 'on today'"],
  [/On 9 November 2026 the platform's hold threshold/, "a dated live setting the docs cannot back"],
  [/Until then this route answers `403 payouts_disabled`\. The shapes/,
    "POST /v1/payouts answers 404 payout_quote_not_found while payouts are off, and the others check first"],
  [/\[Collections\]\(\.\/authentication/, "a link labelled Collections that goes to Authentication"],
  [/\[[^\]]*kakitu\.org\/merchant[^\]]*\]\(\.\//, "a link labelled kakitu.org/merchant that goes to a docs page"],
  [/Exactly one of `charge_id` and `payout_id`/, "at most one is set; both are null on four types"],
];

// ---------------------------------------------------------------- the docs, as text

const docsDir = join(root, "docs");
const pages = readdirSync(docsDir).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`);
const text = Object.fromEntries([...pages, "static/openapi.yaml"].map((p) => [p, read(p)]));
// Pages outside docs/ that a visitor reads: checked for forbidden words only.
const sitePages = ["src/pages/signup.tsx", "src/pages/index.tsx", "docusaurus.config.ts", "README.md",
  "sdk/ts/README.md", "sdk/python/README.md", "sdk/php/README.md", "sdk/PUBLISHING.md"]
  .filter((p) => existsSync(join(root, p)));
// Text between <!-- rebuilding --> and <!-- /rebuilding --> describes an API that is being
// rebuilt (payouts on KCB). It may describe tills and paybills; nothing outside it may.
const stripRebuilding = (body) => body.replace(/<!-- rebuilding -->[\s\S]*?<!-- \/rebuilding -->/g,
  (m) => m.replace(/[^\n]/g, " "));

// What counts as "documented". A bare substring would let `phone`, `name` or `status` pass on any
// page, so each kind of thing has to appear in the form a reader looks it up by.
//
//   field  an inline code span (`beneficiary.phone`) or the first cell of a table row, on the page
//          that owns it. Whole-token: `phone_in_use` does not document `phone`.
//   route  as a field, or inside a fenced code block, or in a heading (a route has spaces or slashes)
//   event  a heading or a table row naming it in code formatting, on the page
const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tok = (w) => "(?<![\\w])" + esc(w) + "(?![\\w])";
const codeSpans = (body) => [...body.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
const fenced = (body) => [...body.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1]);
const hasField = (page, w) => {
  const re = new RegExp(tok(w));
  if (codeSpans(text[page]).some((c) => re.test(c))) return true;
  return new RegExp("^\\|\\s*" + esc(w) + "\\s*\\|", "m").test(text[page]);
};
const isRoute = (w) => /[\s/]/.test(w);
const mentions = (page, w) => {
  if (hasField(page, w)) return true;
  if (!isRoute(w)) return false;
  const re = new RegExp(tok(w));
  return fenced(text[page]).some((c) => re.test(c)) || new RegExp("^#+ .*" + tok(w), "m").test(text[page]);
};
const hasEventEntry = (page, e) => {
  const heading = new RegExp("^#+ .*`" + esc(e) + "`", "m");
  const row = new RegExp("^\\|\\s*`" + esc(e) + "`\\s*\\|", "m");
  return heading.test(text[page]) || row.test(text[page]);
};

// events: a heading or table row on the Events and Webhooks pages, a webhook key and an enum entry in the spec
for (const e of EVENTS) {
  for (const page of ["docs/events.md", "docs/webhooks.md"]) {
    if (!hasEventEntry(page, e)) fail(`${page}: event ${e} has no heading or table row`);
  }
  if (!new RegExp("^  " + esc(e) + ":\\s*$", "m").test(text["static/openapi.yaml"])) {
    fail(`static/openapi.yaml: event ${e} is not a webhook entry`);
  }
  if (!new RegExp("^\\s+- " + esc(e) + "\\s*$", "m").test(text["static/openapi.yaml"])) {
    fail(`static/openapi.yaml: event ${e} is not in the EventType enum`);
  }
}

// errors: one table row each on the Errors page, and an entry in the spec's ErrorCode enum
// Each list is checked in its own section, so a row in one table does not stand in for the other.
const errSection = (from, to) => {
  const body = text["docs/errors.md"];
  const i = body.indexOf(from);
  if (i < 0) { fail(`docs/errors.md: the section "${from}" is missing`); return ""; }
  const j = to ? body.indexOf(to, i + from.length) : -1;
  return body.slice(i, j < 0 ? undefined : j);
};
const v1Table = errSection("## Every code", "## Codes that are not in `/v1`");
const walletTable = errSection("## Codes that are not in `/v1`", "{#wallet-cash-out-codes}");
const kesOutTable = errSection("{#wallet-cash-out-codes}", "## Authentication failures");
const rowIn = (body, c) => new RegExp("\\|\\s*`" + c + "`\\s*\\|").test(body);
for (const c of ERROR_CODES) {
  if (!rowIn(v1Table, c)) fail(`docs/errors.md: error code ${c} has no table row under "Every code"`);
}
for (const c of WALLET_CODES) {
  if (!rowIn(walletTable, c)) fail(`docs/errors.md: wallet code ${c} has no table row under "Codes that are not in /v1"`);
}
for (const c of ERROR_CODES) {
  if (!new RegExp("-\\s+" + c + "\\b").test(text["static/openapi.yaml"])) {
    fail(`static/openapi.yaml: error code ${c} is not in the ErrorCode enum`);
  }
}
for (const c of KES_OUT_CODES) {
  if (!rowIn(kesOutTable, c)) fail(`docs/errors.md: wallet cash-out code ${c} has no table row under the /ramp/kes codes`);
}
const countWord = { 44: "forty-four", 45: "forty-five" };
if (!text["docs/errors.md"].toLowerCase().includes(countWord[ERROR_CODES.length])) {
  fail(`docs/errors.md: the code count must say ${countWord[ERROR_CODES.length]} (${ERROR_CODES.length} codes)`);
}

// payout states: the Payouts page names each, and the spec's PayoutStatus enum does
for (const s of PAYOUT_STATES) {
  if (!text["docs/payouts.md"].includes("`" + s + "`")) fail(`docs/payouts.md: payout state ${s} is not documented`);
  const block = text["static/openapi.yaml"].split("\n    PayoutStatus:")[1]?.split("\n    Payout:")[0] ?? "";
  const inEnum = new RegExp("enum:\\s*\\[[^\\]]*\\b" + s + "\\b").test(block);
  if (!inEnum) fail(`static/openapi.yaml: payout state ${s} is not in an enum`);
}

// fields and routes
for (const [page, words] of Object.entries(FIELDS)) {
  for (const w of words) if (!mentions(page, w)) fail(`${page}: ${w} is not documented`);
}
for (const p of [
  "/v1/payouts/requests", "/v1/payout-destinations", "/v1/payout-destinations/{id}",
  "/v1/payout-destinations/lock",
]) {
  if (!new RegExp("^  " + p.replace(/[{}]/g, "\\$&") + ":", "m").test(text["static/openapi.yaml"])) {
    fail(`static/openapi.yaml: path ${p} is missing`);
  }
}
for (const w of ["reference", "credited_kes", "payout_locked", "approval_expires_at", "bank_code"]) {
  if (!text["static/openapi.yaml"].includes(w)) fail(`static/openapi.yaml: ${w} is missing`);
}

// Operations a merchant cannot use today. Each says so in the first words of its description,
// so the API reference and the pages cannot disagree.
const NOT_TODAY = {
  createCharge: "Not available.", createPayoutQuote: "Not available.", createPayout: "Not available.",
  requestPayout: "Not available.", createQuote: "Not available today.",
};
for (const [op, prefix] of Object.entries(NOT_TODAY)) {
  const spec = text["static/openapi.yaml"];
  const at = spec.indexOf("operationId: " + op + "\n");
  if (at < 0) { fail(`static/openapi.yaml: operation ${op} is missing`); continue; }
  const next = spec.indexOf("operationId:", at + 1);
  const block = spec.slice(at, next < 0 ? undefined : next);
  const d = block.match(/\n\s+description: \|?-?\s*\n?\s*(.*)/);
  if (!d || !d[1].trim().startsWith(prefix)) {
    fail(`static/openapi.yaml: ${op}'s description must start "${prefix}"`);
  }
}

for (const [page, phrases] of Object.entries(PHRASES)) {
  for (const ph of phrases) if (!text[page].includes(ph)) fail(`${page}: the page must say "${ph}"`);
}

// words that must not be there
const forbiddenScope = { ...text };
for (const p of sitePages) forbiddenScope[p] = read(p);
for (const [page, raw] of Object.entries(forbiddenScope)) {
  for (const [re, why, fenceable] of FORBIDDEN) {
    const body = fenceable ? stripRebuilding(raw) : raw;
    const m = body.match(re);
    if (m) {
      const line = body.slice(0, m.index).split("\n").length;
      fail(`${page}:${line}: "${m[0]}" ${why}`);
    }
  }
}

// /config: every key is a table row on docs/config.md and a property of the spec's PublicConfig
{
  const page = text["docs/config.md"] ?? "";
  if (!page) fail("docs/config.md is missing: every GET /config key needs a row there");
  const firstCells = [...page.matchAll(/^\|([^|\n]*)\|/gm)].map((m) => m[1]);
  const rowKeys = new Set(firstCells.flatMap((c) => [...c.matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1])));
  const pc = text["static/openapi.yaml"].split("\n    PublicConfig:")[1]?.split(/\n    [A-Za-z]+:\n/)[0] ?? "";
  for (const k of CONFIG_KEYS) {
    if (!rowKeys.has(k)) fail(`docs/config.md: /config key ${k} has no table row`);
    if (!new RegExp("^        " + esc(k) + ":", "m").test(pc)) fail(`static/openapi.yaml: /config key ${k} is not in PublicConfig`);
  }
}

// the spec documents the two public reads beside /config, and the merchant record's lock fields
for (const p of ["/transfers", "/reserves"]) {
  if (!new RegExp("^  " + esc(p) + ":", "m").test(text["static/openapi.yaml"])) fail(`static/openapi.yaml: path ${p} is missing`);
}
{
  const m = text["static/openapi.yaml"].split("\n    Merchant:\n")[1]?.split(/\n    [A-Za-z]+:\n/)[0] ?? "";
  for (const f of ["payout_locked", "payout_unlocks_at"]) {
    if (!m.includes(f + ":")) fail(`static/openapi.yaml: the Merchant schema lacks ${f}`);
  }
}

// SDK READMEs
for (const p of SDK_READMES) {
  const body = read(p);
  for (const ph of SDK_README_PHRASES) if (!body.includes(ph)) fail(`${p}: the README must say "${ph}"`);
  // code only: the prose may name a call to say it is deprecated or not available
  const code = body.replace(/```[^\n]*\n([\s\S]*?)```|[^]/g, (all, c) => (c !== undefined ? c : all === "\n" ? "\n" : " "));
  for (const [re, why] of SDK_README_FORBIDDEN) {
    const m = code.match(re);
    if (m) fail(`${p}:${code.slice(0, m.index).split("\n").length}: "${m[0]}" ${why}`);
  }
}

for (const p of MUST_NOT_EXIST) if (existsSync(join(root, p))) fail(`${p} must not exist (stale; removed 2026-11-25)`);

// internal links: ./page and ./page#anchor must resolve to a page and a heading on it
{
  const slug = (h) => h.toLowerCase().replace(/<[^>]+>/g, "").replace(/[`*~\\]/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s/g, "-");
  const anchors = {};
  for (const page of pages) {
    const ids = new Set();
    const seen = {};
    const body = text[page].replace(/```[\s\S]*?```/g, "");
    for (const m of body.matchAll(/^#{1,6}\s+(.*?)\s*$/gm)) {
      const explicit = m[1].match(/\{#([^}]+)\}\s*$/);
      if (explicit) { ids.add(explicit[1]); continue; }
      let id = slug(m[1]);
      if (seen[id] !== undefined) { seen[id] += 1; id = `${id}-${seen[id]}`; } else seen[id] = 0;
      ids.add(id);
    }
    anchors[page.slice("docs/".length, -3)] = ids;
  }
  for (const page of pages) {
    const body = text[page].replace(/```[\s\S]*?```/g, "");
    for (const m of body.matchAll(/\]\(\.\/([a-z0-9-]*)(?:#([^)\s]+))?\)/g)) {
      const target = m[1] || page.slice("docs/".length, -3);
      const line = body.slice(0, m.index).split("\n").length;
      if (!anchors[target]) { fail(`${page}:${line}: link to ./${m[1]} — no such page`); continue; }
      if (m[2] && !anchors[target].has(m[2])) fail(`${page}:${line}: link to ./${m[1]}#${m[2]} — no such heading`);
    }
  }
}

// ---------------------------------------------------------------- against the server

const serverDir = process.env.KAKITU_SERVER_DIR;
if (serverDir) {
  const src = (p) => {
    const f = join(serverDir, p);
    if (!existsSync(f)) { fail(`server file missing: ${f}`); return ""; }
    return readFileSync(f, "utf8");
  };
  const sameSet = (what, mine, theirs) => {
    for (const x of theirs) if (!mine.includes(x)) fail(`${what}: the server has ${x}; check-docs.mjs does not know it`);
    for (const x of mine) if (!theirs.includes(x)) fail(`${what}: check-docs.mjs lists ${x}; the server has no such thing`);
  };
  const events = [...src("models/dbmodels/webhook_event.go").matchAll(/Webhook\w+\s*=\s*"([a-z_]+\.[a-z_]+)"/g)]
    .map((m) => m[1]).filter((e) => !["pending", "delivered", "abandoned"].includes(e));
  sameSet("events", EVENTS, [...new Set(events)]);
  const table = src("apiv1/errors.go").split("var codeTable")[1] ?? "";
  const camel = [...table.matchAll(/\{Code(\w+),/g)].map((m) => m[1]);
  const consts = Object.fromEntries(
    [...src("apiv1/errors.go").matchAll(/Code(\w+)\s+Code\s*=\s*"([a-z_]+)"/g)].map((m) => [m[1], m[2]]));
  const serverCodes = camel.map((c) => consts[c]).filter(Boolean);
  for (const c of PENDING_SERVER_CODES) {
    if (serverCodes.includes(c)) {
      fail(`error codes: the server now has ${c}; remove it from PENDING_SERVER_CODES in check-docs.mjs`);
    } else {
      notes.push(`error code ${c} is documented ahead of the server change that adds it (PENDING_SERVER_CODES)`);
    }
  }
  sameSet("error codes", ERROR_CODES.filter((c) => !PENDING_SERVER_CODES.includes(c) || serverCodes.includes(c)), serverCodes);
  const states = [...src("models/dbmodels/payout.go").matchAll(/Payout\w+\s+PayoutState\s*=\s*"([a-z_]+)"/g)].map((m) => m[1]);
  sameSet("payout states", PAYOUT_STATES, states);
  // the cash-out numbers the docs quote are /config's, so the knobs must still be published
  for (const k of ["kes_offramp_enabled", "kes_offramp_min_kes", "kes_offramp_max_kes", "kes_offramp_fee_bps", "kes_offramp_fee_min_kes"]) {
    if (!src("controller/config_c.go").includes('json:"' + k + '"')) fail(`${k} is no longer in /config; cash-out.md names it`);
  }
  // every /config key the server publishes is documented, and nothing documented is gone
  const cfgStruct = src("controller/config_c.go").split("type PublicConfig struct")[1]?.split("\n}")[0] ?? "";
  sameSet("/config keys", CONFIG_KEYS, [...cfgStruct.matchAll(/json:"([a-z0-9_]+)/g)].map((m) => m[1]));
  // every wallet cash-out code the Errors page lists is one the cash-out controller answers
  const kesout = src("controller/kesout_c.go") + src("controller/ramp_c.go") + src("controller/mpesa_visibility.go");
  for (const c of KES_OUT_CODES) {
    if (!kesout.includes('"' + c + '"')) {
      fail(`wallet cash-out code ${c}: the server's cash-out controllers do not answer it`);
    }
  }
}

if (failures.length) {
  console.error(`check-docs: ${failures.length} problem(s)\n`);
  if (!serverDir) console.error("check-docs: server comparison: SKIPPED (KAKITU_SERVER_DIR is not set)\n");
  for (const f of failures) console.error("  - " + f);
  process.exit(1);
}
const ran = serverDir
  ? "server comparison: RAN against " + serverDir
  : "server comparison: SKIPPED (KAKITU_SERVER_DIR is not set), so the lists in this file were not checked against the server";
console.log(`check-docs: ok (${EVENTS.length} events, ${ERROR_CODES.length + WALLET_CODES.length} error codes, ${PAYOUT_STATES.length} payout states)`);
console.log(`check-docs: ${ran}`);
for (const n of notes) console.log(`check-docs: note: ${n}`);
