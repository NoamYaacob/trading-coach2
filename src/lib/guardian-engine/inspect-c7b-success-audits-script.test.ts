/**
 * Read-only safety guarantees for scripts/inspect-c7b-success-audits.ts.
 *
 * The C7B success-audit diagnostic prints ALL outcome=success
 * BrokerRiskSettingsSyncAudit rows (no row limit) plus the broker_locked /
 * dry_run GuardianInterventions, to explain why C7B failed closed. These
 * source-scan tests prove it is strictly read-only: no DB mutation, no
 * enforcement call, no broker/HTTP call, and manual-only wiring. If a future
 * edit adds a write or an enforcement call, a test here fails.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

const SCRIPT_REL = "scripts/inspect-c7b-success-audits.ts";

describe("inspect-c7b success-audit script — read-only DB access", () => {
  const src = readSrc(SCRIPT_REL);

  function codeOnly(): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  it("uses only read Prisma methods (findFirst/findUnique/findMany/count)", () => {
    const code = codeOnly();
    const prismaCalls = [...code.matchAll(/prisma\.[a-zA-Z]+\.([a-zA-Z]+)\(/g)].map((m) => m[1]);
    const allowed = new Set(["findFirst", "findUnique", "findMany", "count"]);
    assert.ok(prismaCalls.length > 0, "expected at least one prisma read call");
    for (const method of prismaCalls) {
      assert.ok(
        allowed.has(method),
        `prisma.${method}() is not an allowed read-only method (allowed: ${[...allowed].join(", ")})`,
      );
    }
  });

  it("contains no mutating Prisma calls", () => {
    const code = codeOnly();
    for (const banned of [
      ".create(",
      ".createMany(",
      ".update(",
      ".updateMany(",
      ".upsert(",
      ".delete(",
      ".deleteMany(",
      "$executeRaw",
      "$queryRaw",
      "executeRawUnsafe",
      "queryRawUnsafe",
    ]) {
      assert.ok(!code.includes(banned), `read-only script must not contain "${banned}"`);
    }
  });

  it("does NOT call any enforcement function", () => {
    const code = codeOnly();
    assert.ok(
      !code.includes("maybeAttemptBrokerDailyLossLockoutForInternalLock("),
      "must NOT call the listener enforcement service",
    );
    assert.ok(
      !code.includes("attemptRealBrokerEnforcementAfterDryRun("),
      "must NOT call the C7B real enforcement service",
    );
    assert.ok(!code.includes("triggerEnforcement("), "must NOT call triggerEnforcement");
    assert.ok(!code.includes("applyBrokerDayLockout("), "must NOT call applyBrokerDayLockout");
    assert.ok(
      !code.includes("broker-enforcement-service"),
      "must NOT import the enforcement service module",
    );
  });

  it("makes no broker/HTTP calls and imports no Tradovate client", () => {
    const code = codeOnly();
    assert.ok(!code.includes("fetch("), "must not call fetch(");
    assert.ok(!/\baxios\b/.test(code), "must not use axios");
    assert.ok(!code.includes("new TradovateClient"), "must not construct a TradovateClient");
    assert.ok(
      !/from\s+["'][^"']*tradovate-client[^"']*["']/.test(code),
      "must not import the Tradovate client module",
    );
  });

  it("queries success audits with no row limit (no take on the success query)", () => {
    const code = codeOnly();
    // The success-audit findMany must filter outcome:"success" and must NOT
    // cap results — the whole point is to surface rows beyond the newest 20.
    assert.ok(code.includes('outcome: "success"'), "must filter outcome=success");
    assert.ok(code.includes('ruleType: "daily_loss_limit"'), "must filter ruleType=daily_loss_limit");
    // The success findMany block must not contain a take limit. Check the slice
    // between the success filter and its orderBy does not include "take".
    const idx = code.indexOf('outcome: "success"');
    const orderByIdx = code.indexOf("orderBy", idx);
    const block = code.slice(idx, orderByIdx + 40);
    assert.ok(!/\btake\s*:/.test(block), "success-audit query must not cap rows with take");
  });

  it("also queries broker_locked and dry_run GuardianInterventions", () => {
    const code = codeOnly();
    assert.ok(code.includes('"broker_locked"'), "must query broker_locked interventions");
    assert.ok(code.includes('"dry_run"'), "must query dry_run interventions");
  });

  it("never sets any env flag — only reads them", () => {
    const code = codeOnly();
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

describe("inspect-c7b success-audit script — manual-only, not wired into runtime", () => {
  it("is a manual CLI script guarded by a top-level run().catch entrypoint", () => {
    const src = readSrc(SCRIPT_REL);
    assert.ok(src.includes("run().catch("), "must be a run().catch entrypoint");
    assert.ok(
      !/export\s+(async\s+)?function/.test(src) &&
        !src.includes("export const") &&
        !src.includes("export default"),
      "manual script must not export anything",
    );
  });

  it("is not imported by the listener worker", () => {
    const listener = readSrc("scripts/tradovate-listener-worker.ts");
    assert.ok(
      !listener.includes("inspect-c7b-success-audits"),
      "the listener worker must not import the C7B diagnostic script",
    );
  });

  it("is not referenced by package.json scripts", () => {
    const pkg = readSrc("package.json");
    assert.ok(
      !pkg.includes("inspect-c7b-success-audits"),
      "package.json must not reference the C7B diagnostic script",
    );
  });
});
