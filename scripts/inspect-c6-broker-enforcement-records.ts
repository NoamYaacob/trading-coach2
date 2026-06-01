#!/usr/bin/env tsx
/**
 * C6 Broker-Enforcement Record Inspection — READ ONLY, zero writes.
 *
 * When the C6 dry-run trigger reports attempted=false / allowed=false with
 * skipReason "GuardianIntervention with dedup key already exists", that means a
 * prior dry-run enforcement already ran and the at-most-once dedup gate is
 * doing its job. This script answers "what was recorded?" — it prints the
 * existing GuardianIntervention row(s) for the broker-enforcement dedup key and
 * the matching BrokerRiskSettingsSyncAudit row(s), so the dry-run history is
 * auditable without re-running anything.
 *
 * It does NOT trigger enforcement and does NOT call the enforcement service —
 * it only reads and prints.
 *
 * What it does:
 *   1. Resolves DEMO7433035 (by label / displayName / externalAccountId).
 *   2. Finds the active daily_loss_limit InternalLockEvent (clearedAt IS NULL).
 *   3. Computes the broker-enforcement dedup key from the active lock's
 *      account/rule/tradingDay (buildListenerBrokerDedupKey — pure helper).
 *   4. Prints:
 *      - GuardianIntervention row(s) with that dedup key
 *      - BrokerRiskSettingsSyncAudit row(s) for the account + daily_loss_limit
 *      - BrokerOrderActionLog count (expected 0 for lock_only enforcement)
 *      - the lock's brokerActionTaken flag (expected false)
 *
 * SAFETY CONTRACT:
 *   - Prisma: findFirst / findUnique / findMany / count only.
 *   - No create / update / updateMany / upsert / delete / deleteMany / raw.
 *   - Does NOT call maybeAttemptBrokerDailyLossLockoutForInternalLock.
 *   - No fetch / axios / Tradovate client. No token or secret printing.
 *   - Reads env flags for context only; never sets any.
 */

import { resolve } from "path";

import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });

import { prisma } from "../src/lib/db.ts";
import { buildListenerBrokerDedupKey } from "../src/lib/guardian-engine/broker-enforcement-dedup.ts";
import { dateKeyInTimezone } from "../src/lib/account-protection.ts";

const TARGET_LABEL = "DEMO7433035";
const TARGET_EXTERNAL_ID = "47669364";

function fmt(value: unknown): string {
  if (value == null) return "(null)";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function run(): Promise<void> {
  const now = new Date();
  const todayCtKey = dateKeyInTimezone(now, "America/Chicago");

  console.log("=".repeat(72));
  console.log("C6 Broker-Enforcement Record Inspection — READ ONLY");
  console.log("=".repeat(72));
  console.log(`  Run time (UTC):  ${now.toISOString()}`);
  console.log(`  CT calendar day: ${todayCtKey}`);
  console.log(`  ENFORCEMENT_DRY_RUN='${process.env.ENFORCEMENT_DRY_RUN ?? "(unset)"}'  ` +
    `BROKER_ENFORCEMENT_ENABLED='${process.env.BROKER_ENFORCEMENT_ENABLED ?? "(unset)"}'`);
  console.log();

  // ── Resolve account ─────────────────────────────────────────────────────────
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
    console.error(`FATAL: No account found matching "${TARGET_LABEL}" / "${TARGET_EXTERNAL_ID}".`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`  Account: id=${account.id} label=${account.label ?? "(null)"} env='${account.brokerConnection?.env ?? "null"}'`);
  console.log();

  // ── Active daily_loss_limit InternalLockEvent ───────────────────────────────
  const activeLocks = await prisma.internalLockEvent.findMany({
    where: { accountId: account.id, clearedAt: null, ruleType: "daily_loss_limit" },
    select: { id: true, tradingDay: true, observedAmount: true, brokerActionTaken: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  if (activeLocks.length === 0) {
    console.log("  ⚠️  No active daily_loss_limit InternalLockEvent (clearedAt IS NULL).");
    console.log("      Cannot derive a current dedup key from an active lock.");
    console.log();
  }

  const primaryLock = activeLocks[0] ?? null;
  if (primaryLock != null) {
    console.log("─".repeat(72));
    console.log("  Active daily_loss_limit InternalLockEvent:");
    console.log(`    id:                ${primaryLock.id}`);
    console.log(`    tradingDay:        ${primaryLock.tradingDay}`);
    console.log(`    observedAmount:    ${fmt(primaryLock.observedAmount)}`);
    console.log(`    brokerActionTaken: ${primaryLock.brokerActionTaken}  (expected false for lock_only)`);
    console.log(`    createdAt:         ${fmt(primaryLock.createdAt)}`);
    if (activeLocks.length > 1) {
      console.log(`    (note: ${activeLocks.length} active daily_loss_limit locks; using most recent for dedup key)`);
    }
    console.log();
  }

  // ── Compute dedup key (pure helper) ─────────────────────────────────────────
  if (primaryLock == null) {
    console.log("  No active lock — nothing to inspect by dedup key. Done.");
    await prisma.$disconnect();
    return;
  }

  const dedupKey = buildListenerBrokerDedupKey(account.id, "daily_loss_limit", primaryLock.tradingDay);
  console.log(`  Broker-enforcement dedup key: ${dedupKey}`);
  console.log();

  // ── GuardianIntervention rows for this dedup key ────────────────────────────
  const interventions = await prisma.guardianIntervention.findMany({
    where: { listenerBrokerDedupKey: dedupKey },
    select: {
      id: true,
      triggerType: true,
      outcome: true,
      brokerLockStatus: true,
      flattenStatus: true,
      brokerEndpoint: true,
      message: true,
      internalLockEventId: true,
      tradingDay: true,
      sentAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  console.log("─".repeat(72));
  console.log(`  GuardianIntervention rows with dedup key (${interventions.length}):`);
  if (interventions.length === 0) {
    console.log("    (none — no broker enforcement recorded for this key)");
  }
  for (const gi of interventions) {
    console.log();
    console.log(`    id:                  ${gi.id}`);
    console.log(`    triggerType (rule):  ${gi.triggerType}`);
    console.log(`    outcome:             ${gi.outcome}`);
    console.log(`    brokerLockStatus:    ${fmt(gi.brokerLockStatus)}  (dry_run => simulated, no Tradovate write)`);
    console.log(`    flattenStatus:       ${fmt(gi.flattenStatus)}`);
    console.log(`    brokerEndpoint:      ${fmt(gi.brokerEndpoint)}`);
    console.log(`    internalLockEventId: ${fmt(gi.internalLockEventId)}`);
    console.log(`    tradingDay:          ${fmt(gi.tradingDay)}`);
    console.log(`    sentAt:              ${fmt(gi.sentAt)}`);
    console.log(`    createdAt:           ${fmt(gi.createdAt)}`);
    console.log(`    message:             ${fmt(gi.message)}`);
  }
  console.log();

  // ── BrokerRiskSettingsSyncAudit rows for the account + daily_loss_limit ──────
  // No dedup-key column on this table; match by account + ruleType, newest first.
  const audits = await prisma.brokerRiskSettingsSyncAudit.findMany({
    where: { accountId: account.id, ruleType: "daily_loss_limit" },
    select: {
      id: true,
      outcome: true,
      dryRun: true,
      brokerEnforcementEnabled: true,
      environment: true,
      gateFailureReason: true,
      skipReason: true,
      payloadPreviewJson: true,
      errorMessage: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  console.log("─".repeat(72));
  console.log(`  BrokerRiskSettingsSyncAudit rows (account + daily_loss_limit, newest ${audits.length}):`);
  if (audits.length === 0) {
    console.log("    (none)");
  }
  for (const a of audits) {
    console.log();
    console.log(`    id:               ${a.id}`);
    console.log(`    outcome:          ${a.outcome}`);
    console.log(`    dryRun:           ${a.dryRun}`);
    console.log(`    brokerEnabled:    ${a.brokerEnforcementEnabled}`);
    console.log(`    environment:      ${fmt(a.environment)}`);
    console.log(`    gateFailReason:   ${fmt(a.gateFailureReason)}`);
    console.log(`    skipReason:       ${fmt(a.skipReason)}`);
    console.log(`    payloadPreview:   ${fmt(a.payloadPreviewJson)}  (endpoint/action preview; no secrets)`);
    console.log(`    errorMessage:     ${fmt(a.errorMessage)}`);
    console.log(`    createdAt:        ${fmt(a.createdAt)}`);
  }
  console.log();

  // ── Safety counters: BrokerOrderActionLog + brokerActionTaken ───────────────
  const orderActionLogs = await prisma.brokerOrderActionLog.count({
    where: { connectedAccountId: account.id },
  });
  const nonDryRunOrderActions = await prisma.brokerOrderActionLog.count({
    where: { connectedAccountId: account.id, dryRun: false },
  });

  console.log("─".repeat(72));
  console.log("  Safety counters:");
  console.log(`    BrokerOrderActionLog (total):       ${orderActionLogs}  (expected 0 for lock_only daily_loss enforcement)`);
  console.log(`    BrokerOrderActionLog (non-dry-run): ${nonDryRunOrderActions}  (expected 0 — no real broker order action)`);
  console.log(`    InternalLockEvent.brokerActionTaken: ${primaryLock.brokerActionTaken}  (expected false)`);
  console.log();

  // ── Verdict ─────────────────────────────────────────────────────────────────
  const dryRunIntervention = interventions.find((g) => g.brokerLockStatus === "dry_run") ?? null;
  console.log("── C6 Inspection Verdict ───────────────────────────────────────────────");
  console.log();
  if (dryRunIntervention != null) {
    console.log("  A dry-run GuardianIntervention exists for this dedup key — the prior C6");
    console.log("  dry-run enforcement was recorded and at-most-once dedup is working. No");
    console.log("  Tradovate write occurred (brokerLockStatus=dry_run). Re-running the");
    console.log("  trigger is correctly blocked by the dedup gate.");
  } else if (interventions.length > 0) {
    console.log("  GuardianIntervention(s) exist for this dedup key (see rows above for the");
    console.log("  recorded outcome/brokerLockStatus). Inspect brokerLockStatus to confirm");
    console.log("  whether the prior run was a dry-run or a real write.");
  } else {
    console.log("  No GuardianIntervention recorded for this dedup key yet — the dry-run");
    console.log("  trigger has not run for this account/day, or the lock's tradingDay");
    console.log("  differs from the recorded key.");
  }
  if (orderActionLogs === 0 && primaryLock.brokerActionTaken === false) {
    console.log("  Safety invariants hold: BrokerOrderActionLog=0 and brokerActionTaken=false.");
  } else {
    console.log("  ⚠️  Safety invariant changed — investigate (expected BrokerOrderActionLog=0");
    console.log("      and brokerActionTaken=false for lock_only enforcement).");
  }
  console.log();
  console.log("  Reminder: this script performed NO broker call and NO DB mutation.");
  console.log("═".repeat(72));

  await prisma.$disconnect();
}

run().catch(async (err) => {
  console.error("Script error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
