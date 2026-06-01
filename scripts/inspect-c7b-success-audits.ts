#!/usr/bin/env tsx
/**
 * C7B Success-Audit Diagnostic — READ ONLY, zero writes.
 *
 * C7B failed closed reporting "2 BrokerRiskSettingsSyncAudit row(s) with
 * outcome=success already exist for this account/rule", but the C6 inspection
 * script only prints the newest 20 audit rows (all gate_blocked) and the
 * current dedup-key GuardianIntervention is still dry_run only. This script
 * exists to find and explain those success rows: it prints EVERY
 * BrokerRiskSettingsSyncAudit with outcome=success for DEMO7433035 +
 * daily_loss_limit (no row limit), alongside the broker_locked / dry_run
 * GuardianInterventions, and reports whether the success audits belong to the
 * current lock/tradingDay or are old historical rows.
 *
 * SAFETY CONTRACT:
 *   - Prisma: findFirst / findUnique / findMany / count only.
 *   - No create / update / updateMany / upsert / delete / deleteMany / raw.
 *   - Does NOT call any enforcement function (no maybeAttempt..., no
 *     attemptRealBrokerEnforcementAfterDryRun, no triggerEnforcement).
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
  console.log("C7B Success-Audit Diagnostic — READ ONLY");
  console.log("=".repeat(72));
  console.log(`  Run time (UTC):  ${now.toISOString()}`);
  console.log(`  CT calendar day: ${todayCtKey}`);
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

  // ── Current active daily_loss_limit lock (for correlation) ──────────────────
  const activeLocks = await prisma.internalLockEvent.findMany({
    where: { accountId: account.id, clearedAt: null, ruleType: "daily_loss_limit" },
    select: { id: true, tradingDay: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const currentLock = activeLocks[0] ?? null;
  const currentDedupKey =
    currentLock != null
      ? buildListenerBrokerDedupKey(account.id, "daily_loss_limit", currentLock.tradingDay)
      : null;

  if (currentLock != null) {
    console.log(`  Current active lock: id=${currentLock.id} tradingDay=${currentLock.tradingDay} createdAt=${currentLock.createdAt.toISOString()}`);
    console.log(`  Current dedup key:   ${currentDedupKey}`);
  } else {
    console.log("  No active daily_loss_limit lock (correlation by tradingDay unavailable).");
  }
  console.log();

  // ── ALL success audits for this account + daily_loss_limit (no row limit) ────
  // NOTE: BrokerRiskSettingsSyncAudit has no updatedAt / tradingDay / lock FK
  // columns — only createdAt. We correlate to the current lock by date below.
  const successAudits = await prisma.brokerRiskSettingsSyncAudit.findMany({
    where: { accountId: account.id, ruleType: "daily_loss_limit", outcome: "success" },
    select: {
      id: true,
      userId: true,
      accountId: true,
      externalAccountId: true,
      brokerConnectionId: true,
      broker: true,
      ruleType: true,
      amount: true,
      environment: true,
      dryRun: true,
      brokerEnforcementEnabled: true,
      outcome: true,
      gateFailureReason: true,
      skipReason: true,
      payloadPreviewJson: true,
      brokerResponseJson: true,
      errorMessage: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  console.log("─".repeat(72));
  console.log(`  ALL BrokerRiskSettingsSyncAudit rows with outcome=success (${successAudits.length}):`);
  console.log("  (account + daily_loss_limit; NO row limit)");
  if (successAudits.length === 0) {
    console.log("    (none — no success audits exist for this account/rule)");
  }
  for (const a of successAudits) {
    const sameDay =
      currentLock != null
        ? dateKeyInTimezone(a.createdAt, "America/Chicago") === currentLock.tradingDay
        : null;
    console.log();
    console.log(`    id:               ${a.id}`);
    console.log(`    outcome:          ${a.outcome}`);
    console.log(`    dryRun:           ${a.dryRun}`);
    console.log(`    brokerEnabled:    ${a.brokerEnforcementEnabled}`);
    console.log(`    environment:      ${fmt(a.environment)}`);
    console.log(`    amount:           ${fmt(a.amount)}`);
    console.log(`    externalAccount:  ${fmt(a.externalAccountId)}`);
    console.log(`    brokerConnId:     ${fmt(a.brokerConnectionId)}`);
    console.log(`    gateFailReason:   ${fmt(a.gateFailureReason)}`);
    console.log(`    skipReason:       ${fmt(a.skipReason)}`);
    console.log(`    payloadPreview:   ${fmt(a.payloadPreviewJson)}`);
    console.log(`    brokerResponse:   ${fmt(a.brokerResponseJson)}`);
    console.log(`    errorMessage:     ${fmt(a.errorMessage)}`);
    console.log(`    createdAt:        ${a.createdAt.toISOString()}`);
    console.log(`    (updatedAt/tradingDay/lockId: not columns on this table)`);
    console.log(`    correlates to current lock tradingDay? ${sameDay == null ? "(no active lock)" : sameDay ? "YES — same CT day as current lock" : "NO — different day (historical row)"}`);
  }
  console.log();

  // ── Full outcome breakdown (so the 'newest 20' blind spot is explained) ──────
  const outcomes = ["success", "dry_run", "gate_blocked", "failed", "skipped", "preview"] as const;
  console.log("─".repeat(72));
  console.log("  BrokerRiskSettingsSyncAudit outcome breakdown (account + daily_loss_limit):");
  for (const o of outcomes) {
    const c = await prisma.brokerRiskSettingsSyncAudit.count({
      where: { accountId: account.id, ruleType: "daily_loss_limit", outcome: o },
    });
    console.log(`    ${o.padEnd(13)} ${c}`);
  }
  const totalAudits = await prisma.brokerRiskSettingsSyncAudit.count({
    where: { accountId: account.id, ruleType: "daily_loss_limit" },
  });
  console.log(`    ${"TOTAL".padEnd(13)} ${totalAudits}`);
  console.log();

  // ── GuardianIntervention rows: broker_locked + dry_run for this account/rule ─
  const brokerLockedInterventions = await prisma.guardianIntervention.findMany({
    where: { accountId: account.id, triggerType: "daily_loss_limit", brokerLockStatus: "broker_locked" },
    select: { id: true, brokerLockStatus: true, outcome: true, brokerEndpoint: true, listenerBrokerDedupKey: true, tradingDay: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const dryRunInterventions = await prisma.guardianIntervention.findMany({
    where: { accountId: account.id, triggerType: "daily_loss_limit", brokerLockStatus: "dry_run" },
    select: { id: true, brokerLockStatus: true, outcome: true, brokerEndpoint: true, listenerBrokerDedupKey: true, tradingDay: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  console.log("─".repeat(72));
  console.log(`  GuardianIntervention brokerLockStatus=broker_locked (${brokerLockedInterventions.length}):`);
  if (brokerLockedInterventions.length === 0) {
    console.log("    (none)");
  }
  for (const gi of brokerLockedInterventions) {
    console.log(`    id=${gi.id} outcome=${gi.outcome} endpoint=${fmt(gi.brokerEndpoint)} key=${fmt(gi.listenerBrokerDedupKey)} tradingDay=${fmt(gi.tradingDay)} createdAt=${gi.createdAt.toISOString()}`);
  }
  console.log();
  console.log(`  GuardianIntervention brokerLockStatus=dry_run (${dryRunInterventions.length}):`);
  if (dryRunInterventions.length === 0) {
    console.log("    (none)");
  }
  for (const gi of dryRunInterventions) {
    console.log(`    id=${gi.id} outcome=${gi.outcome} endpoint=${fmt(gi.brokerEndpoint)} key=${fmt(gi.listenerBrokerDedupKey)} tradingDay=${fmt(gi.tradingDay)} createdAt=${gi.createdAt.toISOString()}`);
  }
  console.log();

  // ── Diagnosis ───────────────────────────────────────────────────────────────
  const anyBrokerLocked = brokerLockedInterventions.length > 0;
  const successToday =
    currentLock != null
      ? successAudits.filter(
          (a) => dateKeyInTimezone(a.createdAt, "America/Chicago") === currentLock.tradingDay,
        )
      : [];

  console.log("── Diagnosis ───────────────────────────────────────────────────────────");
  console.log();
  console.log(`  Any broker_locked GuardianIntervention exists? ${anyBrokerLocked ? "YES" : "NO"}`);
  console.log(`  outcome=success audits total: ${successAudits.length}`);
  if (currentLock != null) {
    console.log(`  outcome=success audits on current lock's tradingDay (${currentLock.tradingDay}): ${successToday.length}`);
  }
  console.log();

  if (successAudits.length > 0 && !anyBrokerLocked) {
    console.log("  KEY FINDING: success audits exist but NO broker_locked GuardianIntervention.");
    console.log("  These success rows were NOT produced by the C7B/listener enforcement path");
    console.log("  (which records broker_locked on GuardianIntervention, not a success audit).");
    console.log("  They are most likely from the RULE-SAVE path");
    console.log("  (applyDailyLossRiskSettingToTradovate writes outcome=success audits).");
    if (currentLock != null && successToday.length === 0) {
      console.log();
      console.log("  None of the success audits fall on the current lock's tradingDay — they are");
      console.log("  HISTORICAL rows. The C7B precondition that blocks on any success audit for");
      console.log("  this account/rule is therefore tripping on old rows, not on real enforcement");
      console.log("  of the current lock. Review whether that precondition should be scoped to the");
      console.log("  current tradingDay (operator decision — this script does not change anything).");
    }
  } else if (anyBrokerLocked) {
    console.log("  A broker_locked GuardianIntervention exists — real enforcement may have already");
    console.log("  occurred. Inspect the rows above before any further action.");
  } else {
    console.log("  No success audits and no broker_locked intervention found for this account/rule.");
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
