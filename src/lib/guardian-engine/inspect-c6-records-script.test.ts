/**
 * Read-only safety guarantees for scripts/inspect-c6-broker-enforcement-records.ts.
 *
 * The C6 inspection script prints the existing broker-enforcement
 * GuardianIntervention + BrokerRiskSettingsSyncAudit rows for a dedup key. These
 * source-scan tests prove it is strictly read-only: it cannot mutate the DB,
 * cannot trigger enforcement, cannot call the broker, and is manual-only (never
 * wired into package.json / cron / the listener). If a future edit adds a write
 * or an enforcement call, a test here fails.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

const SCRIPT_REL = "scripts/inspect-c6-broker-enforcement-records.ts";

describe("inspect-c6 records script — read-only DB access", () => {
  const src = readSrc(SCRIPT_REL);

  // Strip block + line comments so we assert on real code, not the doc header.
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

  it("does NOT call the enforcement service (no trigger of enforcement)", () => {
    const code = codeOnly();
    assert.ok(
      !code.includes("maybeAttemptBrokerDailyLossLockoutForInternalLock"),
      "inspection script must NOT call the enforcement service",
    );
    assert.ok(
      !code.includes("triggerEnforcement("),
      "inspection script must NOT call triggerEnforcement",
    );
    assert.ok(
      !code.includes("applyBrokerDayLockout("),
      "inspection script must NOT call applyBrokerDayLockout",
    );
    assert.ok(
      !code.includes("broker-enforcement-service"),
      "inspection script must NOT import the enforcement service module",
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

  it("computes the dedup key via the pure helper", () => {
    const code = codeOnly();
    assert.ok(
      /import\s*\{[^}]*buildListenerBrokerDedupKey[^}]*\}\s*from\s*["']\.\.\/src\/lib\/guardian-engine\/broker-enforcement-dedup\.ts["']/.test(
        code,
      ),
      "must import buildListenerBrokerDedupKey from the pure dedup helper",
    );
    assert.ok(code.includes("buildListenerBrokerDedupKey("), "must call buildListenerBrokerDedupKey");
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

describe("inspect-c6 records script — manual-only, not wired into runtime", () => {
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
      !listener.includes("inspect-c6-broker-enforcement-records"),
      "the listener worker must not import the C6 inspection script",
    );
  });

  it("is not referenced by package.json scripts", () => {
    const pkg = readSrc("package.json");
    assert.ok(
      !pkg.includes("inspect-c6-broker-enforcement-records"),
      "package.json must not reference the manual C6 inspection script",
    );
  });
});
