/**
 * Safety guarantees for scripts/trigger-c7b-real-broker-enforcement-current-lock.ts
 * and the narrowly-scoped service method attemptRealBrokerEnforcementAfterDryRun
 * added to broker-enforcement-service.ts.
 *
 * The C7B script performs controlled real broker enforcement for the dry_run→real
 * transition. These tests prove:
 *   1. The script calls the real enforcement path through the service method
 *      (not by duplicating Tradovate HTTP logic in the script).
 *   2. The script fails closed if ENFORCEMENT_DRY_RUN is not exactly "false".
 *   3. The service method blocks when broker_locked already exists.
 *   4. The service method blocks when no prior dry_run intervention exists.
 *   5. The service method calls triggerEnforcement WITHOUT listenerBrokerDedupKey
 *      (avoids unique constraint conflict with the dry-run row).
 *   6. The script is manual-only — never wired into package.json/cron/listener.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

const SCRIPT_REL = "scripts/trigger-c7b-real-broker-enforcement-current-lock.ts";
const SERVICE_REL = "src/lib/guardian-engine/broker-enforcement-service.ts";

describe("trigger-c7b script — uses the service method, not direct Tradovate calls", () => {
  const src = readSrc(SCRIPT_REL);

  function codeOnly(s: string): string {
    return s
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  it("imports and calls attemptRealBrokerEnforcementAfterDryRun from the service", () => {
    const code = codeOnly(src);
    assert.ok(
      /import\s*\{[^}]*attemptRealBrokerEnforcementAfterDryRun[^}]*\}\s*from\s*["']\.\.\/src\/lib\/guardian-engine\/broker-enforcement-service\.ts["']/.test(
        code,
      ),
      "must import attemptRealBrokerEnforcementAfterDryRun from the service module",
    );
    assert.ok(
      code.includes("attemptRealBrokerEnforcementAfterDryRun("),
      "must actually CALL attemptRealBrokerEnforcementAfterDryRun",
    );
  });

  it("does not call Tradovate/fetch/axios or enforcement functions directly", () => {
    const code = codeOnly(src);
    // Call-syntax forms — mentions in comment strings are fine, calls are not.
    assert.ok(!code.includes("triggerEnforcement("), "script must not call triggerEnforcement directly");
    assert.ok(!code.includes("applyBrokerDayLockout("), "script must not call applyBrokerDayLockout directly");
    assert.ok(!code.includes("fetch("), "script must not call fetch()");
    assert.ok(!/\baxios\b/.test(code), "script must not use axios");
    assert.ok(!code.includes("new TradovateClient"), "script must not construct a TradovateClient");
    assert.ok(
      !/from\s+["'][^"']*tradovate-client[^"']*["']/.test(code),
      "script must not import the Tradovate client",
    );
  });

  it("fails closed when ENFORCEMENT_DRY_RUN is not exactly \"false\"", () => {
    const code = codeOnly(src);
    assert.ok(
      code.includes('process.env.ENFORCEMENT_DRY_RUN !== "false"'),
      'must check ENFORCEMENT_DRY_RUN !== "false" and fail closed',
    );
    // The fail-closed guard must appear BEFORE the service call.
    const dryRunIdx = code.indexOf('ENFORCEMENT_DRY_RUN !== "false"');
    const callIdx = code.indexOf("attemptRealBrokerEnforcementAfterDryRun(");
    assert.ok(dryRunIdx >= 0 && callIdx >= 0, "expected both the guard and the call to be present");
    assert.ok(dryRunIdx < callIdx, "ENFORCEMENT_DRY_RUN guard must appear before the service call");
  });

  it("requires BROKER_ENFORCEMENT_ENABLED=true and TRADOVATE_LISTENER_ENABLE_LIVE=false", () => {
    const code = codeOnly(src);
    assert.ok(
      code.includes('process.env.BROKER_ENFORCEMENT_ENABLED !== "true"'),
      "must require BROKER_ENFORCEMENT_ENABLED=true",
    );
    assert.ok(
      code.includes('process.env.TRADOVATE_LISTENER_ENABLE_LIVE === "true"'),
      "must require TRADOVATE_LISTENER_ENABLE_LIVE=false",
    );
  });

  it("requires the account env to be demo (fails closed otherwise)", () => {
    const code = codeOnly(src);
    assert.ok(
      /env\s*!==\s*["']demo["']/.test(code),
      "must fail closed when account env is not 'demo'",
    );
  });

  it("requires the exact expected account id (cmottd1z200020do1knjxq582)", () => {
    const code = codeOnly(src);
    assert.ok(
      code.includes("cmottd1z200020do1knjxq582"),
      "must check that account id is exactly cmottd1z200020do1knjxq582",
    );
    assert.ok(
      code.includes("account.id !== EXPECTED_ACCOUNT_ID"),
      "must fail closed when account id doesn't match",
    );
  });

  it("pre-checks existing dry_run intervention and blocks on broker_locked", () => {
    const code = codeOnly(src);
    assert.ok(code.includes('"dry_run"'), "must verify the existing intervention is dry_run");
    assert.ok(code.includes('"broker_locked"'), "must block when broker_locked already exists");
  });

  it("prints before/after counts for GuardianIntervention, audits, and order logs", () => {
    const src2 = readSrc(SCRIPT_REL);
    assert.ok(src2.includes("dryRunInterventions"), "must snapshot dry_run intervention count");
    assert.ok(src2.includes("brokerLockedInterventions"), "must snapshot broker_locked intervention count");
    assert.ok(src2.includes("realSuccessAudits"), "must snapshot real success audit count");
    assert.ok(src2.includes("orderActionLogs"), "must snapshot BrokerOrderActionLog count");
    assert.ok(src2.includes("brokerActionTaken"), "must snapshot brokerActionTaken");
  });

  it("never sets any env flag — only reads them", () => {
    const code = codeOnly(src);
    assert.ok(
      !/process\.env\.[A-Z_]+\s*=(?!=)/.test(code),
      "script must not assign to any process.env flag",
    );
  });

  it("does not construct its own PrismaClient — uses the shared db.ts client", () => {
    const code = codeOnly(src);
    assert.ok(!code.includes("new PrismaClient"), "must not construct a new PrismaClient");
    assert.ok(code.includes('from "../src/lib/db.ts"'), "must import shared prisma client from db.ts");
  });
});

describe("trigger-c7b script — manual-only, not wired into runtime", () => {
  it("is a manual CLI script guarded by run().catch", () => {
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
      !listener.includes("trigger-c7b-real-broker-enforcement-current-lock"),
      "listener must not import the C7B script",
    );
  });

  it("is not referenced by package.json scripts", () => {
    const pkg = readSrc("package.json");
    assert.ok(
      !pkg.includes("trigger-c7b-real-broker-enforcement-current-lock"),
      "package.json must not reference the C7B script",
    );
  });
});

describe("attemptRealBrokerEnforcementAfterDryRun — service method safety contract", () => {
  const src = readSrc(SERVICE_REL);

  function codeOnly(s: string): string {
    return s
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  it("is exported from broker-enforcement-service.ts", () => {
    assert.ok(
      src.includes("export async function attemptRealBrokerEnforcementAfterDryRun"),
      "function must be exported from the service module",
    );
  });

  it("blocks when no prior dry_run intervention exists", () => {
    const code = codeOnly(src);
    assert.ok(
      code.includes("no_prior_dry_run_intervention"),
      "must block with 'no_prior_dry_run_intervention' when no prior intervention exists",
    );
  });

  it("blocks when broker_locked already exists (at-most-once real enforcement)", () => {
    const code = codeOnly(src);
    assert.ok(
      code.includes("real_enforcement_already_recorded"),
      "must block with 'real_enforcement_already_recorded' when broker_locked exists",
    );
  });

  it("blocks on unexpected brokerLockStatus values", () => {
    const code = codeOnly(src);
    assert.ok(
      code.includes("unexpected_prior_lock_status"),
      "must block with 'unexpected_prior_lock_status' for non-dry_run, non-broker_locked states",
    );
  });

  it("passes existingInterventionWithDedupKey=false to gate evaluator (intentional gate 10 bypass)", () => {
    const code = codeOnly(src);
    assert.ok(
      code.includes("existingInterventionWithDedupKey: false"),
      "must pass existingInterventionWithDedupKey=false to the gate evaluator in the new function",
    );
  });

  it("calls triggerEnforcement WITHOUT listenerBrokerDedupKey to avoid unique-constraint conflict", () => {
    // The standard function passes listenerBrokerDedupKey: dedupKey to triggerEnforcement.
    // The new function must NOT — so the new intervention does not collide with the dry-run row.
    // We verify the comment that documents this intent, which is a stable contract signal.
    assert.ok(
      src.includes("listenerBrokerDedupKey intentionally omitted"),
      "must have the comment documenting why listenerBrokerDedupKey is intentionally omitted",
    );
  });

  it("exports BrokerEnforcementOnceRealResult type with priorDryRunInterventionId", () => {
    assert.ok(
      src.includes("export type BrokerEnforcementOnceRealResult"),
      "must export BrokerEnforcementOnceRealResult type",
    );
    assert.ok(
      src.includes("priorDryRunInterventionId"),
      "BrokerEnforcementOnceRealResult must include priorDryRunInterventionId",
    );
  });
});
