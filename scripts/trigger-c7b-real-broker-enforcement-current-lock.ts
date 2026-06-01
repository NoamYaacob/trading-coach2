#!/usr/bin/env tsx
/**
 * C7B Controlled Real Broker Enforcement — manual, one-time, demo account only.
 *
 * C7 preflight confirmed that real enforcement is blocked for the current active
 * lock because an existing dry-run GuardianIntervention already occupies the
 * dedup key. This script performs the controlled same-day real enforcement by
 * calling the narrowly-scoped service path `attemptRealBrokerEnforcementAfterDryRun`,
 * which replaces the binary gate 10 check with a tri-state check that specifically
 * permits the dry_run→real transition while still blocking if a real intervention
 * (brokerLockStatus=broker_locked) already exists.
 *
 * This script:
 *   - Performs real Tradovate writes when all gates pass.
 *   - Calls the production enforcement path (triggerEnforcement via the service)
 *     — no direct Tradovate HTTP logic here.
 *   - Does NOT delete or modify the existing dry-run GuardianIntervention.
 *   - Does NOT modify InternalLockEvent directly.
 *   - Is never wired into the listener, cron, or any runtime path.
 *
 * Fail-closed preconditions (the script exits before touching the service if any
 * are not met):
 *   1. BROKER_ENFORCEMENT_ENABLED = true
 *   2. ENFORCEMENT_DRY_RUN = false  ← real writes only when explicitly false
 *   3. TRADOVATE_LISTENER_ENABLE_LIVE = false
 *   4. Account env = demo
 *   5. Account id is exactly cmottd1z200020do1knjxq582
 *   6. Allowlist contains cmottd1z200020do1knjxq582
 *   7. Exactly one active InternalLockEvent exists (clearedAt IS NULL)
 *   8. ruleType = daily_loss_limit
 *   9. Existing dedup-key GuardianIntervention has brokerLockStatus = dry_run
 *  10. No dedup-key GuardianIntervention with brokerLockStatus = broker_locked
 *
 * Note: BrokerRiskSettingsSyncAudit outcome=success rows are written by the
 * rule-save path (applyDailyLossRiskSettingToTradovate), NOT by the listener
 * enforcement path. At-most-once enforcement is guaranteed by preconditions 9–10
 * (the broker_locked tri-state check). Historical success audits from rule-saves
 * must not block same-day real enforcement.
 */

import { resolve } from "path";

import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });

import { prisma } from "../src/lib/db.ts";
import { attemptRealBrokerEnforcementAfterDryRun } from "../src/lib/guardian-engine/broker-enforcement-service.ts";
import { buildListenerBrokerDedupKey } from "../src/lib/guardian-engine/broker-enforcement-dedup.ts";
import { parseBrokerEnforcementAllowlist } from "../src/lib/guardian-engine/broker-enforcement-gate.ts";
import { dateKeyInTimezone } from "../src/lib/account-protection.ts";

const TARGET_LABEL = "DEMO7433035";
const TARGET_EXTERNAL_ID = "47669364";
const EXPECTED_ACCOUNT_ID = "cmottd1z200020do1knjxq582";

async function failClosed(message: string): Promise<never> {
  console.error("");
  console.error("✋ FAIL-CLOSED — refusing to proceed:");
  console.error(`   ${message}`);
  console.error("");
  await prisma.$disconnect();
  process.exit(1);
}

type Snapshot = {
  dryRunInterventions: number;
  brokerLockedInterventions: number;
  realSuccessAudits: number;
  dryRunAudits: number;
  orderActionLogs: number;
  brokerActionTaken: boolean | null;
};

async function snapshot(accountId: string, lockId: string, dedupKey: string): Promise<Snapshot> {
  const [dryRunInterventions, brokerLockedInterventions, realSuccessAudits, dryRunAudits, orderActionLogs, lock] =
    await Promise.all([
      prisma.guardianIntervention.count({
        where: { accountId, listenerBrokerDedupKey: dedupKey, brokerLockStatus: "dry_run" },
      }),
      prisma.guardianIntervention.count({
        where: { accountId, listenerBrokerDedupKey: dedupKey, brokerLockStatus: "broker_locked" },
      }),
      prisma.brokerRiskSettingsSyncAudit.count({ where: { accountId, outcome: "success" } }),
      prisma.brokerRiskSettingsSyncAudit.count({ where: { accountId, outcome: "dry_run" } }),
      prisma.brokerOrderActionLog.count({ where: { connectedAccountId: accountId } }),
      prisma.internalLockEvent.findUnique({
        where: { id: lockId },
        select: { brokerActionTaken: true },
      }),
    ]);
  return {
    dryRunInterventions,
    brokerLockedInterventions,
    realSuccessAudits,
    dryRunAudits,
    orderActionLogs,
    brokerActionTaken: lock?.brokerActionTaken ?? null,
  };
}

async function run(): Promise<void> {
  const now = new Date();
  const todayCtKey = dateKeyInTimezone(now, "America/Chicago");

  console.log("=".repeat(72));
  console.log("C7B Real Broker Enforcement — controlled, one-time, demo account only");
  console.log("=".repeat(72));
  console.log(`  Run time (UTC):  ${now.toISOString()}`);
  console.log(`  CT calendar day: ${todayCtKey}`);
  console.log();

  // ── Precondition 1: BROKER_ENFORCEMENT_ENABLED must be true ──────────────────
  if (process.env.BROKER_ENFORCEMENT_ENABLED !== "true") {
    await failClosed(
      `BROKER_ENFORCEMENT_ENABLED must be "true". Current: '${process.env.BROKER_ENFORCEMENT_ENABLED ?? "(unset)"}'`,
    );
  }

  // ── Precondition 2: ENFORCEMENT_DRY_RUN must be false ────────────────────────
  // This is the critical gate. Checked first among the "will this do real work"
  // flags. The script refuses to proceed unless dry-run is explicitly off.
  if (process.env.ENFORCEMENT_DRY_RUN !== "false") {
    await failClosed(
      `ENFORCEMENT_DRY_RUN must be exactly "false" to run real enforcement. ` +
        `Current: '${process.env.ENFORCEMENT_DRY_RUN ?? "(unset)"}'. ` +
        `Set ENFORCEMENT_DRY_RUN=false only after explicit written approval.`,
    );
  }

  // ── Precondition 3: TRADOVATE_LISTENER_ENABLE_LIVE must be false ─────────────
  if (process.env.TRADOVATE_LISTENER_ENABLE_LIVE === "true") {
    await failClosed(
      `TRADOVATE_LISTENER_ENABLE_LIVE must be "false" (demo-only enforcement). ` +
        `Current: '${process.env.TRADOVATE_LISTENER_ENABLE_LIVE}'`,
    );
  }

  console.log("  Env flags: BROKER_ENFORCEMENT_ENABLED=true ✓  ENFORCEMENT_DRY_RUN=false ✓  TRADOVATE_LISTENER_ENABLE_LIVE=false ✓");
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
      externalAccountId: true,
      brokerConnection: { select: { env: true } },
    },
  });

  if (!account) {
    await failClosed(`No account found matching "${TARGET_LABEL}" / "${TARGET_EXTERNAL_ID}".`);
    return; // unreachable — narrows type
  }

  // ── Precondition 4: account env must be demo ─────────────────────────────────
  const env = account.brokerConnection?.env ?? null;
  if (env !== "demo") {
    await failClosed(
      `Account env is '${env ?? "null"}' — real enforcement is demo-only in this phase.`,
    );
  }

  // ── Precondition 5: account id must be exactly the expected one ──────────────
  if (account.id !== EXPECTED_ACCOUNT_ID) {
    await failClosed(
      `Account id '${account.id}' does not match expected '${EXPECTED_ACCOUNT_ID}'. ` +
        `This script targets a single specific demo account only.`,
    );
  }

  // ── Precondition 6: allowlist must contain the account ───────────────────────
  const allowlistIds = parseBrokerEnforcementAllowlist(
    process.env.BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST,
  );
  if (!allowlistIds.includes(account.id)) {
    await failClosed(
      `Account id ${account.id} is not in BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST ` +
        `[${allowlistIds.join(", ") || "(empty)"}].`,
    );
  }

  console.log(`  Account: id=${account.id} label=${account.label ?? "(null)"} env=demo ✓`);
  console.log();

  // ── Preconditions 7–8: exactly one active daily_loss_limit lock ──────────────
  const activeLocks = await prisma.internalLockEvent.findMany({
    where: { accountId: account.id, clearedAt: null, ruleType: "daily_loss_limit" },
    select: { id: true, tradingDay: true, observedAmount: true, brokerActionTaken: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  if (activeLocks.length === 0) {
    await failClosed(
      "No active daily_loss_limit InternalLockEvent (clearedAt IS NULL). " +
        "A lock must exist before real enforcement can fire.",
    );
  }
  if (activeLocks.length > 1) {
    await failClosed(
      `Expected exactly ONE active daily_loss_limit lock but found ${activeLocks.length}: ` +
        `${activeLocks.map((l) => `[${l.id}] tradingDay=${l.tradingDay}`).join("; ")}. ` +
        "Refusing to guess which one to enforce.",
    );
  }

  const lock = activeLocks[0];
  const dedupKey = buildListenerBrokerDedupKey(account.id, "daily_loss_limit", lock.tradingDay);

  console.log(`  Active lock: id=${lock.id} tradingDay=${lock.tradingDay} observedAmount=${lock.observedAmount} brokerActionTaken=${lock.brokerActionTaken}`);
  console.log(`  Dedup key:   ${dedupKey}`);
  console.log();

  // ── Precondition 9: existing dedup-key intervention must be dry_run only ─────
  const existingIntervention = await prisma.guardianIntervention.findUnique({
    where: { listenerBrokerDedupKey: dedupKey },
    select: { id: true, brokerLockStatus: true },
  });

  if (existingIntervention == null) {
    await failClosed(
      `No existing GuardianIntervention for dedup key '${dedupKey}'. ` +
        "This script is for the dry_run→real transition only. " +
        "Use the standard path (trigger-c6-broker-enforcement-dry-run.ts) first.",
    );
    return; // unreachable — narrows existingIntervention to non-null for TS
  }

  // ── Precondition 10: no broker_locked intervention already ───────────────────
  if (existingIntervention.brokerLockStatus === "broker_locked") {
    await failClosed(
      `GuardianIntervention '${existingIntervention.id}' already has brokerLockStatus=broker_locked. ` +
        "Real broker enforcement was already recorded for this lock/day. " +
        "Refusing to attempt again (at-most-once enforcement).",
    );
  }

  if (existingIntervention.brokerLockStatus !== "dry_run") {
    await failClosed(
      `GuardianIntervention '${existingIntervention.id}' has unexpected brokerLockStatus=` +
        `'${existingIntervention.brokerLockStatus ?? "(null)"}' (expected 'dry_run'). ` +
        "Investigate before attempting real enforcement.",
    );
  }

  console.log(`  Prior dry-run intervention: id=${existingIntervention.id} brokerLockStatus=dry_run ✓`);
  console.log("  No broker_locked intervention ✓");
  console.log();

  // ── Before snapshot ─────────────────────────────────────────────────────────
  const before = await snapshot(account.id, lock.id, dedupKey);

  console.log("─".repeat(72));
  console.log("  Invoking service: attemptRealBrokerEnforcementAfterDryRun");
  console.log("  (runs gates 1-9 + tri-state gate 10; no direct Tradovate call in script)");
  console.log("─".repeat(72));
  console.log();

  // ── Call the narrowly-scoped service method ──────────────────────────────────
  const result = await attemptRealBrokerEnforcementAfterDryRun(lock.id);

  console.log("  Service result:");
  console.log(`    attempted:               ${result.attempted}`);
  console.log(`    allowed:                 ${result.allowed}`);
  console.log(`    dedupKey:                ${result.dedupKey}`);
  console.log(`    priorDryRunInterventionId: ${result.priorDryRunInterventionId ?? "(none)"}`);
  console.log(`    skipReason:              ${result.skipReason ?? "(none — all gates passed)"}`);
  console.log();

  // ── After snapshot ──────────────────────────────────────────────────────────
  const after = await snapshot(account.id, lock.id, dedupKey);

  // ── Before / after summary ──────────────────────────────────────────────────
  console.log("─".repeat(72));
  console.log("  Before / after summary:");
  console.log();
  console.log(`    active lock id:                               ${lock.id}`);
  console.log(`    dedup key:                                    ${dedupKey}`);
  console.log(`    GuardianIntervention dry_run count:           ${before.dryRunInterventions} → ${after.dryRunInterventions}`);
  console.log(`    GuardianIntervention broker_locked count:     ${before.brokerLockedInterventions} → ${after.brokerLockedInterventions}`);
  console.log(`    BrokerRiskSettingsSyncAudit outcome=success:  ${before.realSuccessAudits} → ${after.realSuccessAudits}`);
  console.log(`    BrokerRiskSettingsSyncAudit outcome=dry_run:  ${before.dryRunAudits} → ${after.dryRunAudits}`);
  console.log(`    BrokerOrderActionLog count:                   ${before.orderActionLogs} → ${after.orderActionLogs}`);
  console.log(`    InternalLockEvent.brokerActionTaken:          ${before.brokerActionTaken} → ${after.brokerActionTaken}`);
  console.log();

  // ── Verdict ─────────────────────────────────────────────────────────────────
  console.log("── C7B Verdict ─────────────────────────────────────────────────────────");
  console.log();
  if (result.attempted && result.allowed) {
    const newBrokerLocked = after.brokerLockedInterventions - before.brokerLockedInterventions;
    console.log("  REAL ENFORCEMENT ATTEMPTED — all gates passed and the production path ran.");
    if (newBrokerLocked > 0) {
      console.log(`  ✅ New GuardianIntervention with brokerLockStatus=broker_locked created.`);
      console.log("     Tradovate userAccountAutoLiq/update (or /create) was called.");
    } else {
      console.log("  ⚠️  No new broker_locked GuardianIntervention — check the result above.");
      console.log("      The enforcement outcome may be 'failed' or another status.");
    }
    if (after.orderActionLogs !== before.orderActionLogs) {
      console.log("  ⚠️  BrokerOrderActionLog count changed — investigate (lock_only daily_loss");
      console.log("      enforcement should NOT write an order-action log).");
    } else {
      console.log("  BrokerOrderActionLog unchanged (correct — lock_only writes no order action).");
    }
    console.log("  The original dry-run GuardianIntervention is preserved (not deleted).");
  } else {
    console.log("  ENFORCEMENT NOT ATTEMPTED — a precondition or gate blocked the path.");
    console.log(`  Reason: ${result.skipReason ?? "(unknown)"}`);
  }
  console.log();
  console.log("═".repeat(72));

  await prisma.$disconnect();
}

run().catch(async (err) => {
  console.error("Script error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
