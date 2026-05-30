/**
 * Static-analysis tests for the pending-rule promoter cron route.
 *
 * The project's test runner (node --experimental-strip-types) does not
 * resolve tsconfig path aliases, so we cannot dynamically import the Next.js
 * route handler and call it directly. These tests mirror the audit-guard
 * approach used in pending-lifecycle.test.ts: read the source and assert
 * security properties, response shape, and isolation guarantees.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..", "..", "..");
const ROUTE_PATH = join(
  REPO_ROOT,
  "src",
  "app",
  "api",
  "cron",
  "promote-pending-rules",
  "route.ts",
);

function src(): string {
  return readFileSync(ROUTE_PATH, "utf8");
}

// ── Auth: correct secret required ─────────────────────────────────────────────

test("cron route reads x-cron-secret from the request headers", () => {
  assert.ok(
    /request\.headers\.get\(["']x-cron-secret["']\)/.test(src()),
    "route must read x-cron-secret header from the request",
  );
});

test("cron route compares header against CRON_SECRET env var", () => {
  assert.ok(
    /process\.env\.CRON_SECRET/.test(src()),
    "route must read CRON_SECRET from process.env",
  );
});

test("cron route rejects when CRON_SECRET is unset (falsy guard)", () => {
  // The guard must short-circuit to 401 when the env var is not configured —
  // this prevents the cron from running open in a misconfigured deployment.
  assert.ok(
    /!expected/.test(src()),
    "route must reject when CRON_SECRET env var is unset (!expected guard)",
  );
});

test("cron route rejects with HTTP 401 on auth failure", () => {
  // Confirm the route returns a 401 status code (not 403 or 500) so callers
  // get a clear, standards-correct signal that auth failed.
  assert.ok(
    /status:\s*401/.test(src()),
    "route must return status 401 when the secret is missing or wrong",
  );
});

test("cron route returns { error: 'unauthorized' } body on auth failure", () => {
  // The body must not contain the CRON_SECRET value or any detail that leaks
  // deployment config. "unauthorized" is the only message.
  assert.ok(
    /error:\s*["']unauthorized["']/.test(src()),
    "route must return { error: 'unauthorized' } — no secret value in response",
  );
});

// ── Success response shape ─────────────────────────────────────────────────────

test("cron route returns { ok: true } on success", () => {
  assert.ok(
    /ok:\s*true/.test(src()),
    "route must include ok: true in the success response body",
  );
});

test("cron route spreads the full promoter summary into the success response", () => {
  // The route returns { ok: true, ...summary } — all PromotionSummary fields
  // (promotedDefaultCount, promotedAccountCount, skippedCount,
  // skippedNotSafeCount, failedCount, errors) are included via the spread.
  assert.ok(
    /\.\.\.\s*summary/.test(src()),
    "route must spread the promoter summary object into the success response",
  );
});

test("promoter library's PromotionSummary includes all expected count fields", () => {
  // Verify the type that the route spreads declares every field callers depend on.
  const promoterSrc = readFileSync(
    join(REPO_ROOT, "src", "lib", "pending-rule-promoter.ts"),
    "utf8",
  );
  for (const field of [
    "promotedDefaultCount",
    "promotedAccountCount",
    "skippedCount",
    "skippedNotSafeCount",
    "failedCount",
    "errors",
  ]) {
    assert.ok(
      promoterSrc.includes(field),
      `PromotionSummary must declare the '${field}' field`,
    );
  }
});

// ── Fatal error response ───────────────────────────────────────────────────────

test("cron route returns HTTP 500 on fatal promotion error", () => {
  assert.ok(
    /status:\s*500/.test(src()),
    "route must return status 500 when promotePendingRules throws unexpectedly",
  );
});

test("cron route returns { error: 'promotion_failed' } body on fatal error", () => {
  assert.ok(
    /error:\s*["']promotion_failed["']/.test(src()),
    "route must return { error: 'promotion_failed' } on fatal errors",
  );
});

// ── Broker isolation ───────────────────────────────────────────────────────────

test("cron route does not import the Tradovate client or any broker SDK", () => {
  // Strip comments so a legitimate doc comment saying "does not call Tradovate"
  // doesn't produce a false negative.
  const stripped = src()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  assert.ok(
    !/from\s+["']@\/lib\/brokers\//.test(stripped),
    "cron route must not import from @/lib/brokers — it is a DB-only step",
  );
  assert.ok(
    !/TradovateClient|tradovate-client/.test(stripped),
    "cron route must not reference any Tradovate runtime symbol",
  );
});

test("cron route delegates promotion entirely to the promoter library", () => {
  // The route must not contain inline promotion logic — all promotion must
  // go through promotePendingRules from src/lib/pending-rule-promoter.ts.
  const stripped = src()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    /promotePendingRules/.test(stripped),
    "route must call promotePendingRules from the promoter library",
  );
  assert.ok(
    !/prisma\.accountRiskRules|prisma\.riskRules/.test(stripped),
    "route must not contain inline Prisma writes — those belong in the promoter library",
  );
});

// ── Connected-account protection promotion ────────────────────────────────────

test("cron route also calls promotePendingConnectedAccountProtection", () => {
  assert.ok(
    /promotePendingConnectedAccountProtection/.test(src()),
    "route must call promotePendingConnectedAccountProtection to apply deferred archives",
  );
});

test("cron route imports from pending-connected-account-promoter", () => {
  assert.ok(
    /pending-connected-account-promoter/.test(src()),
    "route must import from pending-connected-account-promoter",
  );
});

test("cron route includes promotedAccountProtectionCount in success response", () => {
  assert.ok(
    /promotedAccountProtectionCount/.test(src()),
    "route success response must include promotedAccountProtectionCount",
  );
});

test("pending-connected-account-promoter source does not import Tradovate", () => {
  const promoterSrc = readFileSync(
    join(REPO_ROOT, "src", "lib", "pending-connected-account-promoter.ts"),
    "utf8",
  );
  const stripped = promoterSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/from\s+["']@\/lib\/brokers\//.test(stripped),
    "pending-connected-account-promoter must not import from @/lib/brokers",
  );
});
