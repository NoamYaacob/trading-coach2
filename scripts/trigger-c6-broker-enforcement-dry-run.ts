#!/usr/bin/env tsx
/**
 * C6 Broker-Enforcement DRY-RUN Trigger — manual, dry-run only.
 *
 * C5 proved that the listener does NOT automatically attempt broker enforcement
 * for an already-existing active InternalLockEvent (it only fires on new lock
 * creation / specific listener events). C6 closes that observation gap by
 * MANUALLY driving the EXISTING production enforcement path against an existing
 * active lock — while ENFORCEMENT_DRY_RUN=true, so nothing is ever sent to
 * Tradovate.
 *
 * What this script does:
 *   1. Resolves DEMO7433035 (by label / displayName / externalAccountId).
 *   2. Finds exactly ONE active daily_loss_limit InternalLockEvent
 *      (clearedAt IS NULL). Refuses to run on 0 or >1 (ambiguous).
 *   3. Calls the production path:
 *        maybeAttemptBrokerDailyLossLockoutForInternalLock(lockId)
 *      This runs the SAME 10-gate evaluator the listener path uses. It does NOT
 *      bypass any gate and does NOT call Tradovate directly.
 *   4. Because ENFORCEMENT_DRY_RUN=true, the enforcement path simulates the
 *      broker write (no TradovateClient instantiated, no API call) and records
 *      whatever the dry-run path normally records (a GuardianIntervention with
 *      outcome="dry_run"). No BrokerOrderActionLog row is written for a
 *      lock_only daily_loss_limit enforcement.
 *
 * Fail-closed preconditions (the script exits non-zero before touching the
 * production path if any are not met):
 *   - ENFORCEMENT_DRY_RUN must be "true"        (NEVER run this with it false)
 *   - BROKER_ENFORCEMENT_ENABLED must be "true" (otherwise gate 1 blocks anyway)
 *   - resolved account env must be "demo"
 *
 * SAFETY CONTRACT:
 *   - No direct Tradovate client. No fetch / axios. No raw SQL.
 *   - The ONLY writes are whatever the existing dry-run enforcement path writes.
 *   - This script is manual-only: it is never imported by app/runtime code and
 *     never wired into the listener.
 *   - It does NOT flip any env flag and does NOT set ENFORCEMENT_DRY_RUN=false.
 */

import { resolve } from "path";

import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });

import { prisma } from "../src/lib/db.ts";
import { maybeAttemptBrokerDailyLossLockoutForInternalLock } from "../src/lib/guardian-engine/broker-enforcement-service.ts";
import { dateKeyInTimezone } from "../src/lib/account-protection.ts";

const TARGET_LABEL = "DEMO7433035";
const TARGET_EXTERNAL_ID = "47669364";

/** Exit with a clear fail-closed message, after disconnecting Prisma. */
async function failClosed(message: string): Promise<never> {
  console.error("");
  console.error("✋ FAIL-CLOSED — refusing to proceed:");
  console.error(`   ${message}`);
  console.error("");
  await prisma.$disconnect();
  process.exit(1);
}

type CountSnapshot = {
  brokerActionTaken: boolean | null;
  guardianInterventions: number;
  dryRunAudits: number;
  orderActionLogs: number;
};

async function snapshot(accountId: string, lockId: string): Promise<CountSnapshot> {
  const [lock, guardianInterventions, dryRunAudits, orderActionLogs] = await Promise.all([
    prisma.internalLockEvent.findUnique({
      where: { id: lockId },
      select: { brokerActionTaken: true },
    }),
    prisma.guardianIntervention.count({ where: { accountId } }),
    prisma.brokerRiskSettingsSyncAudit.count({ where: { accountId, outcome: "dry_run" } }),
    prisma.brokerOrderActionLog.count({ where: { connectedAccountId: accountId } }),
  ]);
  return {
    brokerActionTaken: lock?.brokerActionTaken ?? null,
    guardianInterventions,
    dryRunAudits,
    orderActionLogs,
  };
}

async function run(): Promise<void> {
  const now = new Date();
  const todayCtKey = dateKeyInTimezone(now, "America/Chicago");

  console.log("=".repeat(72));
  console.log("C6 Broker-Enforcement DRY-RUN Trigger — manual, dry-run only");
  console.log("=".repeat(72));
  console.log(`  Run time (UTC):  ${now.toISOString()}`);
  console.log(`  CT calendar day: ${todayCtKey}`);
  console.log();

  // ── Precondition 1: ENFORCEMENT_DRY_RUN must be true ────────────────────────
  // Checked FIRST and hard — this script must never run a real broker write.
  const enforcementDryRun = process.env.ENFORCEMENT_DRY_RUN === "true";
  if (!enforcementDryRun) {
    await failClosed(
      `ENFORCEMENT_DRY_RUN must be exactly "true" to run this script. ` +
        `Current value: '${process.env.ENFORCEMENT_DRY_RUN ?? "(unset)"}'. ` +
        `This script is dry-run ONLY — it refuses to run when dry-run is off.`,
    );
  }

  // ── Precondition 2: BROKER_ENFORCEMENT_ENABLED must be true ──────────────────
  const brokerEnforcementEnabled = process.env.BROKER_ENFORCEMENT_ENABLED === "true";
  if (!brokerEnforcementEnabled) {
    await failClosed(
      `BROKER_ENFORCEMENT_ENABLED must be "true" to exercise the enforcement path. ` +
        `Current value: '${process.env.BROKER_ENFORCEMENT_ENABLED ?? "(unset)"}'. ` +
        `(Gate 1 would block enforcement otherwise, making this a no-op.)`,
    );
  }

  console.log("  Preconditions: ENFORCEMENT_DRY_RUN=true ✓  BROKER_ENFORCEMENT_ENABLED=true ✓");
  console.log();

  // ── Resolve the account ─────────────────────────────────────────────────────
  const account = await prisma.connectedAccount.findFirst({
    where: {
      OR: [
        { label: TARGET_LABEL },
        { displayName: TARGET_LABEL },
        { externalAccountId: TARGET_EXTERNAL_ID },
        { externalAccountId: TARGET_LABEL },
      ],
    },
    select: {
      id: true,
      label: true,
      displayName: true,
      externalAccountId: true,
      isActive: true,
      brokerConnection: { select: { env: true, connectionStatus: true, permissionLevel: true } },
    },
  });

  if (!account) {
    await failClosed(`No account found matching "${TARGET_LABEL}" / "${TARGET_EXTERNAL_ID}".`);
    return; // unreachable (failClosed exits) — narrows `account` to non-null for TS
  }

  const env = account.brokerConnection?.env ?? null;
  console.log(`  Account: id=${account.id} label=${account.label ?? "(null)"} env='${env ?? "null"}'`);

  // ── Precondition 3: env must be demo ────────────────────────────────────────
  if (env !== "demo") {
    await failClosed(
      `Account env is '${env ?? "null"}' — this script only runs against demo accounts. ` +
        `Broker enforcement is demo-only in this phase.`,
    );
  }

  // ── Find exactly one active daily_loss_limit InternalLockEvent ──────────────
  const activeLocks = await prisma.internalLockEvent.findMany({
    where: { accountId: account.id, clearedAt: null, ruleType: "daily_loss_limit" },
    select: { id: true, tradingDay: true, observedAmount: true, brokerActionTaken: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  if (activeLocks.length === 0) {
    await failClosed(
      `No active daily_loss_limit InternalLockEvent (clearedAt IS NULL) for this account. ` +
        `Create one (run the C1 lock-creation path) before triggering enforcement.`,
    );
  }
  if (activeLocks.length > 1) {
    await failClosed(
      `Expected exactly ONE active daily_loss_limit lock but found ${activeLocks.length}: ` +
        `${activeLocks.map((l) => `[${l.id}] tradingDay=${l.tradingDay}`).join("; ")}. ` +
        `Refusing to guess which one to enforce.`,
    );
  }

  const lock = activeLocks[0];
  console.log(
    `  Active lock: id=${lock.id} tradingDay=${lock.tradingDay} observedAmount=${lock.observedAmount} brokerActionTaken=${lock.brokerActionTaken}`,
  );
  console.log();

  // ── Before snapshot ─────────────────────────────────────────────────────────
  const before = await snapshot(account.id, lock.id);

  console.log("─".repeat(72));
  console.log("  Invoking production path (dry-run): maybeAttemptBrokerDailyLossLockoutForInternalLock");
  console.log("  (runs all 10 gates; no gate bypass; no direct Tradovate call)");
  console.log("─".repeat(72));
  console.log();

  // ── Call the EXISTING production path. No bypass. No direct broker call. ─────
  const result = await maybeAttemptBrokerDailyLossLockoutForInternalLock(lock.id);

  console.log("  Enforcement-service result:");
  console.log(`    attempted:  ${result.attempted}`);
  console.log(`    allowed:    ${result.allowed}`);
  console.log(`    dedupKey:   ${result.dedupKey}`);
  console.log(`    skipReason: ${result.skipReason ?? "(none — gates passed)"}`);
  console.log();

  // ── After snapshot ──────────────────────────────────────────────────────────
  const after = await snapshot(account.id, lock.id);

  // ── Before / after summary ──────────────────────────────────────────────────
  console.log("─".repeat(72));
  console.log("  Before / after summary:");
  console.log();
  console.log(`    active lock id:                         ${lock.id}`);
  console.log(`    brokerActionTaken:                      ${before.brokerActionTaken} → ${after.brokerActionTaken}`);
  console.log(`    GuardianIntervention count:             ${before.guardianInterventions} → ${after.guardianInterventions}`);
  console.log(`    BrokerRiskSettingsSyncAudit dry_run:    ${before.dryRunAudits} → ${after.dryRunAudits}`);
  console.log(`    BrokerOrderActionLog count:             ${before.orderActionLogs} → ${after.orderActionLogs}`);
  console.log();

  // ── Verdict ─────────────────────────────────────────────────────────────────
  console.log("── C6 Dry-Run Verdict ──────────────────────────────────────────────────");
  console.log();
  if (result.attempted && result.allowed) {
    console.log("  ENFORCEMENT ATTEMPTED (DRY-RUN) — all 10 gates passed and the production");
    console.log("  path ran in dry-run mode. No Tradovate write was sent (ENFORCEMENT_DRY_RUN");
    console.log("  =true). Any new GuardianIntervention row above has outcome='dry_run'.");
    if (after.orderActionLogs !== before.orderActionLogs) {
      console.log("  ⚠️  BrokerOrderActionLog count changed — investigate (lock_only daily_loss");
      console.log("      enforcement is NOT expected to write an order-action log).");
    } else {
      console.log("  BrokerOrderActionLog unchanged (correct — lock_only writes no order action).");
    }
  } else {
    console.log("  ENFORCEMENT NOT ATTEMPTED — a gate blocked the path before any write.");
    console.log(`  Reason: ${result.skipReason ?? "(unknown)"}`);
    console.log("  This is the production evaluator's decision (no gate was bypassed).");
  }
  console.log();
  console.log("  Reminder: this run was DRY-RUN ONLY. No real broker order or risk-setting");
  console.log("  write was sent to Tradovate. ENFORCEMENT_DRY_RUN was not changed.");
  console.log("═".repeat(72));

  await prisma.$disconnect();
}

run().catch(async (err) => {
  console.error("Script error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
