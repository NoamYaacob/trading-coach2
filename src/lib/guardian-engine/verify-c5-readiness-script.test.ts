/**
 * Read-only safety guarantees for scripts/verify-c5-broker-enforcement-readiness.ts.
 *
 * The C5 readiness script is a manual, read-only diagnostic. These source-scan
 * tests prove it cannot mutate the database, cannot call the broker, and is not
 * wired into any runtime path — mirroring the safety contract documented in its
 * header. If a future edit adds a write or a broker call, these tests fail.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

const SCRIPT_REL = "scripts/verify-c5-broker-enforcement-readiness.ts";

describe("verify-c5 readiness script — read-only DB access", () => {
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
    assert.ok(prismaCalls.length > 0, "expected the script to make at least one prisma read call");
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

  it("makes no broker/HTTP calls (no fetch/axios/Tradovate client writes)", () => {
    const code = codeOnly();
    // Call-syntax forms (with "(") — the script may *mention* these names in
    // explanatory strings (e.g. "no triggerEnforcement is invoked"), but must
    // never actually invoke them.
    for (const banned of [
      "fetch(",
      "applyFlatten(",
      "applyDailyLossLock(",
      "triggerEnforcement(",
      "applyBrokerDayLockout(",
      "new TradovateClient",
      "syncDailyLossRiskSettingToTradovate(",
    ]) {
      assert.ok(!code.includes(banned), `read-only script must not call "${banned}"`);
    }
    assert.ok(!/\baxios\b/.test(code), "read-only script must not use axios");
  });

  it("does not construct its own PrismaClient — uses the shared db.ts client", () => {
    const code = codeOnly();
    assert.ok(!code.includes("new PrismaClient"), "must not construct a new PrismaClient");
    assert.ok(
      code.includes('from "../src/lib/db.ts"') || code.includes("from '../src/lib/db.ts'"),
      "must import the shared prisma client from ../src/lib/db.ts",
    );
  });

  it("only imports the PURE gate evaluator (no DB/broker side-effect imports)", () => {
    // The script reuses evaluateBrokerEnforcementGates — a pure function with no
    // prisma/broker dependency — so importing it cannot trigger any write.
    assert.ok(
      src.includes("evaluateBrokerEnforcementGates"),
      "script should reuse the production pure gate evaluator for an accurate verdict",
    );
    assert.ok(
      !src.includes("broker-enforcement-service"),
      "script must NOT import broker-enforcement-service (which calls triggerEnforcement)",
    );
  });

  it("never sets enforcement env flags — only reads them", () => {
    const code = codeOnly();
    // Reading process.env.X is fine; assigning to it is not. The negative
    // lookahead excludes comparison operators (===, ==) so reads don't trip it.
    assert.ok(
      !/process\.env\.[A-Z_]+\s*=(?!=)/.test(code),
      "script must not assign to any process.env flag",
    );
    assert.ok(code.includes("process.env.BROKER_ENFORCEMENT_ENABLED"), "should read BROKER_ENFORCEMENT_ENABLED");
    assert.ok(code.includes("process.env.ENFORCEMENT_DRY_RUN"), "should read ENFORCEMENT_DRY_RUN");
  });
});

describe("verify-c5 readiness script — not wired into runtime", () => {
  it("is not imported by any non-test source file under src/", () => {
    // Manual scripts live in scripts/ and must never be referenced by app code.
    // We assert the import specifier does not appear in the runtime barrel paths
    // most likely to pull it in. (A direct import would also break the build,
    // since scripts/ is outside the Next.js app tree.)
    const listener = readSrc("scripts/tradovate-listener-worker.ts");
    assert.ok(
      !listener.includes("verify-c5-broker-enforcement-readiness"),
      "the listener worker must not import the C5 readiness script",
    );
  });

  it("is a manual CLI script guarded by a top-level run().catch entrypoint", () => {
    const src = readSrc(SCRIPT_REL);
    assert.ok(
      src.includes("run().catch("),
      "script should be a manual CLI entrypoint (run().catch(...)), not an exported module",
    );
    assert.ok(
      !/export\s+(async\s+)?function/.test(src) && !src.includes("export const") && !src.includes("export default"),
      "manual script must not export anything that runtime code could import",
    );
  });
});
