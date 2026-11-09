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

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const failures = [];
const fail = (msg) => failures.push(msg);

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

// Answered by the wallet's own routes (/ramp/*), not /v1, and documented beside the /v1 codes.
const WALLET_CODES = ["deposits_paused"];

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
    "value_wei", "status", "submitted_at", "next_before",
  ],
  "docs/payouts.md": [
    "beneficiary.type", "phone", "till", "paybill", "account", "bank_code", "name",
    "POST /v1/payouts/requests", "approval_expires_at", "payout_id", "pending_approval",
    "GET /v1/payout-destinations", "POST /v1/payout-destinations", "DELETE /v1/payout-destinations/{id}",
    "POST /v1/payout-destinations/lock", "payout_locked", "payout_unlocks_at", "active_at",
    "cooling_off", "holder_name", "payout_cooling_off_hours",
  ],
  "docs/pricing.md": ["fee_kes", "credited_kes"],
  "docs/collections.md": ["fee_kes", "credited_kes"],
  "docs/limits.md": ["deposit_max_per_order_usd"],
  "docs/extension.md": ["ebcjlgfjbbgoldipdhbcmciebdiadifg", "reference"],
  "docs/errors.md": ["deposits_paused"],
};

// Prose that must be on the page, as plain text (these are sentences, not fields).
const PHRASES = {
  "docs/extension.md": ["Chrome Web Store", "is refused", "spaces or emoji"],
};

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
  [/\bnot open yet\b|when collections open|collections and payouts are not open/i,
    "merchant collections and payouts are switched on in production (2026-10-30); payouts are per merchant"],
  [/there is no `payout\.paid`|no `payout\.paid` or `payout\.failed`/i, "payout.paid and payout.failed are raised"],
];

// ---------------------------------------------------------------- the docs, as text

const docsDir = join(root, "docs");
const pages = readdirSync(docsDir).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`);
const text = Object.fromEntries([...pages, "static/openapi.yaml"].map((p) => [p, read(p)]));

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
for (const c of [...ERROR_CODES, ...WALLET_CODES]) {
  if (!new RegExp("\\|\\s*`" + c + "`\\s*\\|").test(text["docs/errors.md"])) {
    fail(`docs/errors.md: error code ${c} has no table row`);
  }
}
for (const c of ERROR_CODES) {
  if (!new RegExp("-\\s+" + c + "\\b").test(text["static/openapi.yaml"])) {
    fail(`static/openapi.yaml: error code ${c} is not in the ErrorCode enum`);
  }
}
const countWord = { 44: "forty-four" };
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

for (const [page, phrases] of Object.entries(PHRASES)) {
  for (const ph of phrases) if (!text[page].includes(ph)) fail(`${page}: the page must say "${ph}"`);
}

// words that must not be there
for (const [page, body] of Object.entries(text)) {
  for (const [re, why] of FORBIDDEN) {
    const m = body.match(re);
    if (m) {
      const line = body.slice(0, m.index).split("\n").length;
      fail(`${page}:${line}: "${m[0]}" ${why}`);
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
  sameSet("error codes", ERROR_CODES, camel.map((c) => consts[c]).filter(Boolean));
  const states = [...src("models/dbmodels/payout.go").matchAll(/Payout\w+\s+PayoutState\s*=\s*"([a-z_]+)"/g)].map((m) => m[1]);
  sameSet("payout states", PAYOUT_STATES, states);
  // the per-order collection cap the docs quote is the config's, so the knob must still exist
  if (!src("controller/config_c.go").includes('json:"deposit_max_per_order_usd"')) {
    fail("deposit_max_per_order_usd is no longer in /config; limits.md names it");
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
