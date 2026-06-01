/**
 * Safety guarantees for scripts/trigger-c6-broker-enforcement-dry-run.ts.
 *
 * The C6 script MANUALLY drives the existing production enforcement path
 * against an already-existing active InternalLockEvent, in dry-run mode. These
 * source-scan tests prove it (1) goes through the real gate-evaluating service
 * rather than re-implementing or bypassing it, (2) makes no direct broker /
 * HTTP call, (3) fails closed unless ENFORCEMENT_DRY_RUN=true, and (4) is
 * manual-only — never wired into package.json, cron, or any runtime path.
 * If a future edit weakens any of these, a test here fails.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

const SCRIPT_REL = "scripts/trigger-c6-broker-enforcement-dry-run.ts";

describe("trigger-c6 dry-run script — uses the real production enforcement path", () => {
  const src = readSrc(SCRIPT_REL);

  // Strip block + line comments so we assert on real code, not the doc header.
  function codeOnly(): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  it("imports and calls maybeAttemptBrokerDailyLossLockoutForInternalLock", () => {
    const code = codeOnly();
    assert.ok(
      /import\s*\{[^}]*maybeAttemptBrokerDailyLossLockoutForInternalLock[^}]*\}\s*from\s*["']\.\.\/src\/lib\/guardian-engine\/broker-enforcement-service\.ts["']/.test(
        code,
      ),
      "must import maybeAttemptBrokerDailyLossLockoutForInternalLock from the production service",
    );
    assert.ok(
      code.includes("maybeAttemptBrokerDailyLossLockoutForInternalLock("),
      "must actually CALL maybeAttemptBrokerDailyLossLockoutForInternalLock",
    );
  });

  it("does not re-implement or bypass the gate evaluator", () => {
    const code = codeOnly();
    // It must NOT call the pure gate evaluator itself (that would be bypassing
    // the service's DB-backed gate resolution) and must NOT call triggerEnforcement
    // directly (that would skip the 10 gates entirely).
    assert.ok(
      !code.includes("evaluateBrokerEnforcementGates("),
      "must NOT call the pure evaluator directly — go through the service",
    );
    assert.ok(
      !code.includes("triggerEnforcement("),
      "must NOT call triggerEnforcement directly — that bypasses the gates",
    );
    assert.ok(
      !code.includes("applyBrokerDayLockout("),
      "must NOT call applyBrokerDayLockout directly — that bypasses the gates",
    );
  });

  it("does not import a Tradovate client directly", () => {
    const code = codeOnly();
    assert.ok(!code.includes("new TradovateClient"), "must not construct a TradovateClient");
    assert.ok(
      !/from\s+["'][^"']*tradovate-client[^"']*["']/.test(code),
      "must not import the Tradovate client module directly",
    );
    assert.ok(
      !/import\s*\{[^}]*\bTradovateClient\b[^}]*\}/.test(code),
      "must not import the TradovateClient symbol",
    );
  });

  it("makes no broker/HTTP calls (no fetch/axios)", () => {
    const code = codeOnly();
    assert.ok(!code.includes("fetch("), "must not call fetch(");
    assert.ok(!/\baxios\b/.test(code), "must not use axios");
  });

  it("fails closed unless ENFORCEMENT_DRY_RUN === \"true\"", () => {
    const code = codeOnly();
    assert.ok(
      code.includes('process.env.ENFORCEMENT_DRY_RUN === "true"'),
      "must check ENFORCEMENT_DRY_RUN === \"true\"",
    );
    // The dry-run guard must short-circuit (exit) before invoking the path.
    const dryRunIdx = code.indexOf("ENFORCEMENT_DRY_RUN");
    const callIdx = code.indexOf("maybeAttemptBrokerDailyLossLockoutForInternalLock(");
    assert.ok(dryRunIdx >= 0 && callIdx >= 0, "expected both the guard and the call to be present");
    assert.ok(
      dryRunIdx < callIdx,
      "the ENFORCEMENT_DRY_RUN guard must appear before the enforcement call (fail-closed ordering)",
    );
    assert.ok(
      code.includes("failClosed("),
      "must use a fail-closed exit when a precondition is not met",
    );
  });

  it("requires BROKER_ENFORCEMENT_ENABLED and env=demo before running", () => {
    const code = codeOnly();
    assert.ok(
      code.includes('process.env.BROKER_ENFORCEMENT_ENABLED === "true"'),
      "must require BROKER_ENFORCEMENT_ENABLED=true",
    );
    assert.ok(/env\s*!==\s*["']demo["']/.test(code), "must require account env === 'demo'");
  });

  it("never sets/flips any enforcement env flag — only reads them", () => {
    const code = codeOnly();
    // Reading process.env.X is fine; assigning to it is not. Negative lookahead
    // excludes comparison operators (===, ==) so reads don't trip it.
    assert.ok(
      !/process\.env\.[A-Z_]+\s*=(?!=)/.test(code),
      "script must not assign to any process.env flag",
    );
  });

  it("does not construct its own PrismaClient — uses the shared db.ts client", () => {
    const code = codeOnly();
    assert.ok(!code.includes("new PrismaClient"), "must not construct a new PrismaClient");
    assert.ok(
      code.includes('from "../src/lib/db.ts"'),
      "must import the shared prisma client from ../src/lib/db.ts",
    );
  });
});

describe("trigger-c6 dry-run script — manual-only, not wired into runtime", () => {
  it("is a manual CLI script guarded by a top-level run().catch entrypoint", () => {
    const src = readSrc(SCRIPT_REL);
    assert.ok(
      src.includes("run().catch("),
      "script should be a manual CLI entrypoint (run().catch(...)), not an exported module",
    );
    assert.ok(
      !/export\s+(async\s+)?function/.test(src) &&
        !src.includes("export const") &&
        !src.includes("export default"),
      "manual script must not export anything that runtime code could import",
    );
  });

  it("is not imported by the listener worker", () => {
    const listener = readSrc("scripts/tradovate-listener-worker.ts");
    assert.ok(
      !listener.includes("trigger-c6-broker-enforcement-dry-run"),
      "the listener worker must not import the C6 trigger script",
    );
  });

  it("is not referenced by package.json scripts or any cron route", () => {
    const pkg = readSrc("package.json");
    assert.ok(
      !pkg.includes("trigger-c6-broker-enforcement-dry-run"),
      "package.json must not reference the manual C6 script",
    );
  });
});
