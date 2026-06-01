/**
 * Read-only safety guarantees for scripts/verify-c7-real-broker-enforcement-preflight.ts.
 *
 * The C7 preflight script assesses GO/NO-GO readiness for real broker
 * enforcement without activating it. These source-scan tests prove it cannot
 * mutate the DB, cannot call the broker, cannot trigger enforcement, and is
 * never wired into any runtime path. If a future edit adds a write or an
 * enforcement call, a test here fails.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

const SCRIPT_REL = "scripts/verify-c7-real-broker-enforcement-preflight.ts";

describe("verify-c7 preflight script — read-only DB access", () => {
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

  it("does NOT call the enforcement service or trigger enforcement", () => {
    const code = codeOnly();
    // Call-syntax forms (with "(") — the script may mention these names in
    // explanatory console.log strings, but must never actually invoke them.
    assert.ok(
      !code.includes("maybeAttemptBrokerDailyLossLockoutForInternalLock("),
      "preflight must NOT call the enforcement service",
    );
    assert.ok(
      !code.includes("triggerEnforcement("),
      "preflight must NOT call triggerEnforcement",
    );
    assert.ok(
      !code.includes("applyBrokerDayLockout("),
      "preflight must NOT call applyBrokerDayLockout",
    );
    assert.ok(
      !code.includes("broker-enforcement-service"),
      "preflight must NOT import the enforcement service module",
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

  it("uses only the pure helpers (dedup, allowlist, trading-day) — no enforcement imports", () => {
    const code = codeOnly();
    assert.ok(
      code.includes("buildListenerBrokerDedupKey"),
      "must use the pure dedup key builder",
    );
    assert.ok(
      code.includes("parseBrokerEnforcementAllowlist"),
      "must use the pure allowlist parser",
    );
  });

  it("verifies ENFORCEMENT_DRY_RUN is true and documents that activation requires false", () => {
    const src = readSrc(SCRIPT_REL);
    assert.ok(
      src.includes("ENFORCEMENT_DRY_RUN"),
      "must check ENFORCEMENT_DRY_RUN",
    );
    assert.ok(
      src.includes("real activation requires") || src.includes("real activation ONLY"),
      "must explain that real activation requires changing ENFORCEMENT_DRY_RUN to false",
    );
  });

  it("verifies the expected account id exactly", () => {
    const code = codeOnly();
    assert.ok(
      code.includes("cmottd1z200020do1knjxq582"),
      "must verify the expected account id (cmottd1z200020do1knjxq582)",
    );
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

  it("performs a dedup collision analysis for the current active lock", () => {
    const code = codeOnly();
    assert.ok(
      code.includes("buildListenerBrokerDedupKey("),
      "must compute the current dedup key",
    );
    assert.ok(
      code.includes("listenerBrokerDedupKey"),
      "must query GuardianIntervention by listenerBrokerDedupKey",
    );
    assert.ok(
      code.includes("dedupBlocksRealNow") || code.includes("dedup"),
      "must determine whether existing dedup blocks immediate real enforcement",
    );
  });
});

describe("verify-c7 preflight script — manual-only, not wired into runtime", () => {
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
      !listener.includes("verify-c7-real-broker-enforcement-preflight"),
      "the listener worker must not import the C7 preflight script",
    );
  });

  it("is not referenced by package.json scripts", () => {
    const pkg = readSrc("package.json");
    assert.ok(
      !pkg.includes("verify-c7-real-broker-enforcement-preflight"),
      "package.json must not reference the manual C7 preflight script",
    );
  });
});
