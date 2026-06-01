#!/usr/bin/env tsx
/**
 * C7 Real-Broker-Enforcement Preflight — READ ONLY, zero writes.
 *
 * C6 proved the dry-run enforcement path end-to-end: all 10 gates pass, the
 * production enforcement service is reached, a GuardianIntervention with
 * brokerLockStatus=dry_run was recorded, and at-most-once dedup is working.
 *
 * C7 is the decision point for switching from dry-run to real Tradovate writes.
 * This script performs the GO / NO-GO preflight. It does NOT activate real
 * enforcement — it only assesses whether every precondition is satisfied and
 * explains the dedup constraint that governs when real enforcement can first
 * fire.
 *
 * Checks (PASS / WARN / FAIL / INFO table):
 *   A.  DEMO7433035 account resolves
 *   B.  Account id is exactly cmottd1z200020do1knjxq582
 *   C.  Account env is "demo"
 *   D.  BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST contains account id
 *       (WARN if extra ids also present)
 *   E.  BROKER_ENFORCEMENT_ENABLED = true (prerequisite for activation)
 *   F.  ENFORCEMENT_DRY_RUN = true (expected; real activation requires false)
 *   G.  TRADOVATE_LISTENER_ENABLE_LIVE = false (must stay false for demo-only)
 *   H.  Active daily_loss_limit InternalLockEvent exists (clearedAt IS NULL)
 *   I.  Tradovate connection: status live + permissionLevel=full_access
 *   J.  No real BrokerOrderActionLog rows (non-dry-run; confirms no real order
 *       actions were taken)
 *   K.  Prior dry-run GuardianIntervention exists (C6 pre-flight evidence)
 *   L.  Prior dry-run BrokerRiskSettingsSyncAudit exists (audit trail present)
 *   M.  Dedup collision analysis — will the existing dedup key block real
 *       enforcement for the current lock? (determines GO vs NO-GO for
 *       immediate activation)
 *
 * SAFETY CONTRACT:
 *   - Prisma: findFirst / findUnique / findMany / count only.
 *   - No create / update / updateMany / upsert / delete / deleteMany / raw.
 *   - Does NOT call maybeAttemptBrokerDailyLossLockoutForInternalLock.
 *   - Does NOT call triggerEnforcement.
 *   - No fetch / axios / Tradovate client. No token or secret printing.
 *   - Reads env flags for assessment only; never sets or changes any.
 *   - Does NOT clear dedup keys or modify GuardianIntervention rows.
 */

import { resolve } from "path";

import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });

import { prisma } from "../src/lib/db.ts";
import { buildListenerBrokerDedupKey } from "../src/lib/guardian-engine/broker-enforcement-dedup.ts";
import { parseBrokerEnforcementAllowlist } from "../src/lib/guardian-engine/broker-enforcement-gate.ts";
import { deriveCmeTradingDayKey } from "../src/lib/trading-day.ts";
import { dateKeyInTimezone } from "../src/lib/account-protection.ts";

const TARGET_LABEL = "DEMO7433035";
const TARGET_EXTERNAL_ID = "47669364";
const EXPECTED_ACCOUNT_ID = "cmottd1z200020do1knjxq582";

const NON_LIVE_CONNECTION_STATUSES = new Set([
  "expired",
  "connection_error",
  "not_connected",
  "pending_webhook",
  "oauth_pending_storage",
]);

type Status = "PASS" | "WARN" | "FAIL" | "INFO";
type CheckResult = { label: string; status: Status; detail: string };

async function run(): Promise<void> {
  const now = new Date();
  const cmeTradingDayKey = deriveCmeTradingDayKey(now);
  const todayCtKey = dateKeyInTimezone(now, "America/Chicago");
  const results: CheckResult[] = [];

  console.log("=".repeat(72));
  console.log("C7 Real-Broker-Enforcement Preflight — READ ONLY");
  console.log("=".repeat(72));
  console.log(`  Run time (UTC):       ${now.toISOString()}`);
  console.log(`  CME trading day key:  ${cmeTradingDayKey}`);
  console.log(`  CT calendar day key:  ${todayCtKey}`);
  console.log();

  // ── A. Account resolves ─────────────────────────────────────────────────────
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
      missingFromBrokerSince: true,
      brokerConnection: {
        select: { id: true, env: true, connectionStatus: true, permissionLevel: true },
      },
    },
  });

  if (!account) {
    console.error(`FATAL: No account found matching "${TARGET_LABEL}" / "${TARGET_EXTERNAL_ID}"`);
    await prisma.$disconnect();
    process.exit(1);
  }

  results.push({
    label: "A. DEMO7433035 account resolves",
    status: "PASS",
    detail: `id=${account.id} label=${account.label ?? "(null)"} externalAccountId=${account.externalAccountId ?? "(null)"} isActive=${account.isActive} missingFromBrokerSince=${account.missingFromBrokerSince?.toISOString() ?? "null"}`,
  });

  const conn = account.brokerConnection;
  const env = conn?.env ?? null;

  // ── B. Account id is exactly the expected one ───────────────────────────────
  results.push({
    label: "B. Account id matches expected (cmottd1z200020do1knjxq582)",
    status: account.id === EXPECTED_ACCOUNT_ID ? "PASS" : "FAIL",
    detail:
      account.id === EXPECTED_ACCOUNT_ID
        ? `id=${account.id} — matches allowlist and dedup key prefix`
        : `id=${account.id} — DOES NOT MATCH expected ${EXPECTED_ACCOUNT_ID}. Dedup keys will differ.`,
  });

  // ── C. env = demo ───────────────────────────────────────────────────────────
  results.push({
    label: "C. Account env is 'demo'",
    status: env === "demo" ? "PASS" : "FAIL",
    detail:
      env === "demo"
        ? "env=demo — demo-only enforcement constraint satisfied"
        : `env='${env ?? "null"}' — real enforcement is demo-only in this phase. Gate 3 will block.`,
  });

  // ── D. Allowlist ────────────────────────────────────────────────────────────
  const allowlistIds = parseBrokerEnforcementAllowlist(
    process.env.BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST,
  );
  const inAllowlist = allowlistIds.includes(account.id);
  const hasExtras = allowlistIds.length > 1;
  results.push({
    label: "D. BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST contains account id",
    status: !inAllowlist ? "FAIL" : hasExtras ? "WARN" : "PASS",
    detail: !inAllowlist
      ? `Account id ${account.id} NOT in allowlist [${allowlistIds.join(", ") || "(empty)"}]. Gate 4 will block.`
      : hasExtras
        ? `Account id present. Allowlist also contains extra ids: [${allowlistIds.filter((id) => id !== account.id).join(", ")}]. Verify these are intentional before activating real enforcement.`
        : `Allowlist=[${allowlistIds.join(", ")}] — exactly the one expected account`,
  });

  // ── E. BROKER_ENFORCEMENT_ENABLED ──────────────────────────────────────────
  const brokerEnforcementEnabled = process.env.BROKER_ENFORCEMENT_ENABLED === "true";
  results.push({
    label: "E. BROKER_ENFORCEMENT_ENABLED = true (gate 1 prerequisite)",
    status: brokerEnforcementEnabled ? "PASS" : "FAIL",
    detail: brokerEnforcementEnabled
      ? "BROKER_ENFORCEMENT_ENABLED=true — gate 1 passes"
      : `BROKER_ENFORCEMENT_ENABLED='${process.env.BROKER_ENFORCEMENT_ENABLED ?? "(unset)"}' — gate 1 will block enforcement. Set to true before activation.`,
  });

  // ── F. ENFORCEMENT_DRY_RUN (expected true; activation requires false) ────────
  const enforcementDryRun = process.env.ENFORCEMENT_DRY_RUN === "true";
  results.push({
    label: "F. ENFORCEMENT_DRY_RUN = true (expected; real activation requires false)",
    status: enforcementDryRun ? "PASS" : "WARN",
    detail: enforcementDryRun
      ? "ENFORCEMENT_DRY_RUN=true — currently in safe dry-run mode. " +
        "Real activation requires changing this to false (NOT done by this script)."
      : `ENFORCEMENT_DRY_RUN='${process.env.ENFORCEMENT_DRY_RUN ?? "(unset)"}' — dry-run is OFF. ` +
        "If this is intentional (real activation approved), ensure all other checks pass first.",
  });

  // ── G. TRADOVATE_LISTENER_ENABLE_LIVE = false ───────────────────────────────
  const listenerLiveEnabled = process.env.TRADOVATE_LISTENER_ENABLE_LIVE === "true";
  results.push({
    label: "G. TRADOVATE_LISTENER_ENABLE_LIVE = false (must stay false for demo-only)",
    status: listenerLiveEnabled ? "FAIL" : "PASS",
    detail: listenerLiveEnabled
      ? "TRADOVATE_LISTENER_ENABLE_LIVE=true — gate 2 will block enforcement for demo accounts. Keep false."
      : "TRADOVATE_LISTENER_ENABLE_LIVE=false — gate 2 passes (demo-only mode correct)",
  });

  // ── H. Active daily_loss_limit InternalLockEvent ────────────────────────────
  const activeLocks = await prisma.internalLockEvent.findMany({
    where: { accountId: account.id, clearedAt: null, ruleType: "daily_loss_limit" },
    select: {
      id: true,
      tradingDay: true,
      observedAmount: true,
      brokerActionTaken: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  const primaryLock = activeLocks[0] ?? null;

  results.push({
    label: "H. Active daily_loss_limit InternalLockEvent exists (clearedAt IS NULL)",
    status: primaryLock != null ? "PASS" : "FAIL",
    detail:
      primaryLock != null
        ? `id=${primaryLock.id} tradingDay=${primaryLock.tradingDay} observedAmount=${primaryLock.observedAmount} brokerActionTaken=${primaryLock.brokerActionTaken}` +
          (activeLocks.length > 1 ? ` (${activeLocks.length} active locks — using most recent)` : "")
        : "No active daily_loss_limit InternalLockEvent. Gate 9 will block. A lock must exist before real enforcement can fire.",
  });

  // ── I. Connection status + permissionLevel ──────────────────────────────────
  const connectionStatus = conn?.connectionStatus ?? null;
  const permissionLevel = conn?.permissionLevel ?? null;
  const connectionLive =
    connectionStatus != null && !NON_LIVE_CONNECTION_STATUSES.has(connectionStatus);
  const hasFullAccess = permissionLevel === "full_access";
  const connStatus: Status =
    conn == null ? "FAIL" : connectionLive && hasFullAccess ? "PASS" : "FAIL";

  results.push({
    label: "I. Tradovate connection: status live + permissionLevel=full_access",
    status: connStatus,
    detail:
      conn == null
        ? "No brokerConnection linked to this account — cannot enforce"
        : `connectionId=${conn.id} env=${env} status='${connectionStatus ?? "null"}' ` +
          `(live=${connectionLive}) permissionLevel='${permissionLevel ?? "null"}' ` +
          `(full_access=${hasFullAccess})` +
          (!connectionLive
            ? " — connection not live, gate 7 will block"
            : !hasFullAccess
              ? " — Account Risk Settings write requires full_access, gate 8 will block"
              : ""),
  });

  // ── J. No real (non-dry-run) BrokerOrderActionLog ───────────────────────────
  const realOrderActions = await prisma.brokerOrderActionLog.count({
    where: { connectedAccountId: account.id, dryRun: false },
  });
  const allOrderActions = await prisma.brokerOrderActionLog.count({
    where: { connectedAccountId: account.id },
  });

  results.push({
    label: "J. No real (non-dry-run) BrokerOrderActionLog rows",
    status: realOrderActions === 0 ? "PASS" : "WARN",
    detail:
      realOrderActions === 0
        ? `BrokerOrderActionLog total=${allOrderActions} non-dry-run=0 — no real order actions taken (expected for lock_only daily_loss enforcement)`
        : `${realOrderActions} non-dry-run BrokerOrderActionLog row(s) exist — investigate before real activation`,
  });

  // ── K. Prior dry-run GuardianIntervention ───────────────────────────────────
  // Look across all dedup key prefixes for this account, not just today's.
  const dryRunInterventions = await prisma.guardianIntervention.findMany({
    where: {
      accountId: account.id,
      brokerLockStatus: "dry_run",
      listenerBrokerDedupKey: { not: null },
    },
    select: { id: true, listenerBrokerDedupKey: true, tradingDay: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  results.push({
    label: "K. Prior dry-run GuardianIntervention exists (C6 pre-flight evidence)",
    status: dryRunInterventions.length > 0 ? "PASS" : "WARN",
    detail:
      dryRunInterventions.length > 0
        ? `${dryRunInterventions.length} dry-run intervention(s) found. Latest: id=${dryRunInterventions[0].id} tradingDay=${dryRunInterventions[0].tradingDay ?? "(null)"} key=${dryRunInterventions[0].listenerBrokerDedupKey ?? "(null)"} createdAt=${dryRunInterventions[0].createdAt.toISOString()}`
        : "No dry-run GuardianIntervention found. C6 dry-run should be completed before real activation.",
  });

  // ── L. Prior dry-run BrokerRiskSettingsSyncAudit ────────────────────────────
  const dryRunAudits = await prisma.brokerRiskSettingsSyncAudit.count({
    where: { accountId: account.id, outcome: "dry_run" },
  });

  results.push({
    label: "L. Prior dry-run BrokerRiskSettingsSyncAudit exists (audit trail)",
    status: dryRunAudits > 0 ? "PASS" : "WARN",
    detail:
      dryRunAudits > 0
        ? `${dryRunAudits} dry_run audit row(s) on record for this account — enforcement path has been exercised`
        : "No dry_run BrokerRiskSettingsSyncAudit found. Run C6 dry-run before real activation.",
  });

  // ── M. Dedup collision analysis ─────────────────────────────────────────────
  // Determine whether real enforcement could fire immediately or is blocked by
  // the existing dry-run GuardianIntervention for the current active lock.
  let dedupBlocksRealNow = false;
  let currentDedupKey: string | null = null;
  let existingInterventionForCurrentKey: { id: string; brokerLockStatus: string | null } | null =
    null;

  if (primaryLock != null) {
    currentDedupKey = buildListenerBrokerDedupKey(
      account.id,
      "daily_loss_limit",
      primaryLock.tradingDay,
    );
    existingInterventionForCurrentKey = await prisma.guardianIntervention.findUnique({
      where: { listenerBrokerDedupKey: currentDedupKey },
      select: { id: true, brokerLockStatus: true },
    });
    dedupBlocksRealNow = existingInterventionForCurrentKey != null;
  }

  const dedupStatus: Status =
    primaryLock == null
      ? "WARN"
      : dedupBlocksRealNow
        ? "INFO"
        : "PASS";

  results.push({
    label: "M. Dedup collision analysis (can real enforcement fire on the current lock?)",
    status: dedupStatus,
    detail:
      primaryLock == null
        ? "No active lock — dedup analysis not applicable"
        : dedupBlocksRealNow
          ? `BLOCKED BY DEDUP — a GuardianIntervention already exists for dedup key '${currentDedupKey}' ` +
            `(id=${existingInterventionForCurrentKey!.id} brokerLockStatus=${existingInterventionForCurrentKey!.brokerLockStatus ?? "(null)"}). ` +
            "Gate 10 will block immediate real enforcement for THIS lock/day. See verdict for paths forward."
          : `No existing GuardianIntervention for current dedup key '${currentDedupKey}' — ` +
            "real enforcement would NOT be dedup-blocked for this lock.",
  });

  // ── Summary table ───────────────────────────────────────────────────────────
  console.log("─".repeat(72));
  console.log("Preflight check table:");
  console.log();
  let pass = 0, warn = 0, fail = 0;
  for (const r of results) {
    const icon =
      r.status === "PASS" ? "✅ PASS"
      : r.status === "WARN" ? "⚠️  WARN"
      : r.status === "FAIL" ? "❌ FAIL"
      : "ℹ️  INFO";
    if (r.status === "PASS") pass++;
    else if (r.status === "WARN") warn++;
    else if (r.status === "FAIL") fail++;
    console.log(`  ${icon}  ${r.label}`);
    console.log(`           ${r.detail}`);
    console.log();
  }
  console.log("─".repeat(72));
  console.log(`  PASS: ${pass}  WARN: ${warn}  FAIL: ${fail}  (INFO not counted)`);
  console.log();

  // ── GO / NO-GO Verdict ──────────────────────────────────────────────────────
  console.log("── C7 GO / NO-GO Verdict ───────────────────────────────────────────────");
  console.log();

  const hardBlockers = results.filter((r) => r.status === "FAIL");
  const envReadyForRealEnforcement =
    hardBlockers.length === 0 && connectionLive && hasFullAccess && primaryLock != null && brokerEnforcementEnabled;

  // GO/NO-GO for environment and account readiness
  if (hardBlockers.length > 0) {
    console.log("  ❌ NO-GO (environment/account prerequisites)");
    console.log("  The following checks must be resolved before real enforcement:");
    for (const b of hardBlockers) {
      console.log(`    • ${b.label}`);
    }
  } else {
    console.log("  ✅ GO — environment and account prerequisites all pass.");
    console.log("  Account, connection, permissions, and env flags are ready.");
  }
  console.log();

  // GO/NO-GO for immediate enforcement on current lock
  if (primaryLock != null) {
    console.log(`  Current active lock: id=${primaryLock.id} tradingDay=${primaryLock.tradingDay}`);
    console.log(`  Current dedup key:   ${currentDedupKey}`);
    console.log();
    if (dedupBlocksRealNow) {
      console.log("  ⛔ NO-GO for IMMEDIATE enforcement on the current lock.");
      console.log("  The existing dry-run GuardianIntervention for this dedup key");
      console.log("  (same account + daily_loss_limit + tradingDay) means gate 10 will");
      console.log("  block real enforcement for THIS lock even after ENFORCEMENT_DRY_RUN");
      console.log("  is set to false. The at-most-once dedup is working as designed.");
      console.log();
      console.log("  ── Safest paths forward ────────────────────────────────────────────");
      console.log();
      console.log("  Option 1 (RECOMMENDED — zero dedup risk):");
      console.log("    Wait for the next CME session reset (17:00 CT). The session rollover");
      console.log("    will clear the current InternalLockEvent (clearedBy=session_end).");
      console.log("    When the next daily_loss_limit lock is created for the new CME");
      console.log("    trading day, its dedup key will be different and real enforcement");
      console.log("    will fire naturally through the listener path — no dedup collision.");
      console.log("    Steps:");
      console.log("      1. Set ENFORCEMENT_DRY_RUN=false (approved activation).");
      console.log("      2. Wait for the next trading day's InternalLockEvent.");
      console.log("      3. The listener will call the enforcement path automatically.");
      console.log();
      console.log("  Option 2 (requires explicit separate approval):");
      console.log("    Create a one-time C7 real-enforcement trigger script that intentionally");
      console.log("    skips the dedup check — passing a flag to the service or calling");
      console.log("    triggerEnforcement directly for a new lock — only after an explicit");
      console.log("    written approval and confirmation that the dry-run GuardianIntervention");
      console.log("    for this day is understood as a prior simulation, not a real write.");
      console.log("    ⚠ This approach risks creating a second GuardianIntervention for the");
      console.log("      same account/day. Do NOT implement without explicit sign-off.");
      console.log();
      console.log("  Option 3 (natural listener path — after flag flip only):");
      console.log("    Create a fresh InternalLockEvent for a different ruleType + tradingDay");
      console.log("    combination so the dedup key is new. Only valid if a genuine new");
      console.log("    rule breach occurs — do NOT manufacture a fake lock for QA purposes.");
    } else {
      if (envReadyForRealEnforcement) {
        console.log("  ✅ GO for immediate enforcement on the current lock.");
        console.log("  No existing GuardianIntervention for this dedup key — gate 10 will NOT");
        console.log("  block enforcement. Real enforcement will proceed once");
        console.log("  ENFORCEMENT_DRY_RUN is set to false (NOT done by this script).");
        console.log();
        console.log("  To activate real enforcement:");
        console.log("    1. Confirm all PASS/WARN rows above are acceptable.");
        console.log("    2. Get explicit written approval to set ENFORCEMENT_DRY_RUN=false.");
        console.log("    3. Change ENFORCEMENT_DRY_RUN=false in Railway environment variables.");
        console.log("    4. The next time maybeAttemptBrokerDailyLossLockoutForInternalLock");
        console.log("       is called (via listener or manual C6 trigger), it will call");
        console.log("       Tradovate's userAccountAutoLiq/update endpoint for real.");
      } else {
        console.log("  ⚠️  Environment/account prerequisites not all passing — review FAILs above.");
      }
    }
  } else {
    console.log("  ⚠️  No active daily_loss_limit InternalLockEvent — cannot assess dedup state.");
    console.log("  Create a lock first, then re-run this preflight.");
  }

  console.log();
  console.log("  ── ENFORCEMENT_DRY_RUN reminder ────────────────────────────────────");
  console.log("  This script has NOT changed ENFORCEMENT_DRY_RUN. It is still:");
  console.log(`    ENFORCEMENT_DRY_RUN='${process.env.ENFORCEMENT_DRY_RUN ?? "(unset)"}'`);
  console.log("  Real activation ONLY proceeds when this is explicitly set to false");
  console.log("  by an operator with written approval — not by any script in this repo.");
  console.log();
  console.log("  Reminder: this script performed NO broker write and NO DB mutation.");
  console.log("═".repeat(72));

  await prisma.$disconnect();
}

run().catch(async (err) => {
  console.error("Script error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
