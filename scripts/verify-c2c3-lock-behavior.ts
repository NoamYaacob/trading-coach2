#!/usr/bin/env tsx
/**
 * C2/C3 Internal-Lock Behavior Verification — READ ONLY, zero writes.
 *
 * Verifies the PRODUCT BEHAVIOR when DEMO7433035 has an active internal lock.
 * Where C1 proved the lock is created, C2/C3 prove the lock is respected:
 * the rules-edit gate would reject, the account-removal guard would defer,
 * and the dashboard internal-lock signal is derivable — all without calling
 * any mutation API, placing/blocking any order, or changing any state.
 *
 * IMPORTANT: This script does NOT call the rules-edit API, the account-removal
 * API, or any broker endpoint. For checks 6 and 7 it re-evaluates the exact
 * gate conditions the real code uses, reading the same DB fields, so the result
 * mirrors what those code paths would decide — purely from DB state.
 *
 * Gate conditions mirrored (read-only):
 *   - Rules-edit block:   src/app/api/rules/route.ts:315
 *                         (hardStoppedAccounts = riskState === "STOPPED" → HTTP 423)
 *   - Removal guard:      src/lib/account-removal-guard.ts
 *                         (bypass if missingFromBrokerSince / ignored / archived;
 *                          else session_stopped or internal_lock:<ruleType> defers)
 *   - internalLockActive: src/app/dashboard/_components/command-center/data.ts
 *                         (active InternalLockEvent where clearedAt IS NULL)
 *
 * Checks (all read-only Prisma queries):
 *   A.  ConnectedAccount exists and is active
 *   B.  LiveSessionState.riskState = "STOPPED"
 *   C.  Active InternalLockEvent exists (clearedAt IS NULL), ruleType = daily_loss_limit
 *   D.  InternalLockEvent: internalOnly = true, brokerActionTaken = false
 *   E.  Rules edit would be BLOCKED (riskState === "STOPPED" → HTTP 423)
 *   F.  Account-removal guard would DEFER (canRemoveNow = false)
 *   G.  internalLockActive derivable = true (dashboard signal)
 *   H.  Zero broker_locked GuardianIntervention today (no broker write)
 *   I.  Zero real BrokerOrderActionLog today (no broker orders)
 *
 * Usage (run via Railway for prod DB access):
 *   railway run npx tsx scripts/verify-c2c3-lock-behavior.ts
 *
 * Or locally (requires .env.local with DATABASE_URL):
 *   source .env.local && npx tsx scripts/verify-c2c3-lock-behavior.ts
 *
 * Tokens and secrets are NEVER printed.
 */

import { resolve } from "path";
import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });

import { prisma } from "../src/lib/db.ts";
import { deriveCmeTradingDayKey, deriveCmeTradingDaySessionStart, SESSION_WINDOW_TIMEZONE } from "../src/lib/trading-day.ts";
import { dateKeyInTimezone } from "../src/lib/account-protection.ts";

// ── Config ───────────────────────────────────────────────────────────────────

// The DEMO7433035 demo account. In production:
//   ConnectedAccount.label             = "DEMO7433035"  (human display name)
//   ConnectedAccount.externalAccountId = "47669364"     (Tradovate tvAccountId)
//   ConnectedAccount.id                = "cmottd1z200020do1knjxq582"
// Resolve robustly by label OR displayName OR externalAccountId — same as the C1 script.
const TARGET_ACCOUNT_LABEL = "DEMO7433035";
const TARGET_EXTERNAL_ACCOUNT_ID = "47669364";
const TARGET_DISPLAY = TARGET_ACCOUNT_LABEL;

// ── Types ────────────────────────────────────────────────────────────────────

type Verdict = "PASS" | "FAIL" | "WARN" | "N/A";

type CheckRow = {
  check: string;
  verdict: Verdict;
  expected: string;
  actual: string;
  notes: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const rows: CheckRow[] = [];

function record(
  check: string,
  verdict: Verdict,
  expected: string,
  actual: string,
  notes = "",
): void {
  rows.push({ check, verdict, expected, actual, notes });
}

function fmtDate(d: Date | null | undefined): string {
  if (!d) return "null";
  return d.toISOString();
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const now = new Date();
  const cmeTradingDayKey = deriveCmeTradingDayKey(now);
  const sessionStart = deriveCmeTradingDaySessionStart(now);
  // The account-removal guard uses the CT calendar-day key, not the CME 17:00
  // boundary key. Compute it the same way the guard does so check F is faithful.
  const removalDayKey = dateKeyInTimezone(now, SESSION_WINDOW_TIMEZONE);

  console.log(`\n=== C2/C3 Internal-Lock Behavior Verification ===`);
  console.log(`Target account   : ${TARGET_DISPLAY}`);
  console.log(`Resolving by     : label="${TARGET_ACCOUNT_LABEL}" OR externalAccountId="${TARGET_EXTERNAL_ACCOUNT_ID}"`);
  console.log(`CME trading day  : ${cmeTradingDayKey}`);
  console.log(`Removal-guard day: ${removalDayKey} (CT calendar day)`);
  console.log(`Session start    : ${sessionStart.toISOString()}`);
  console.log(`Now              : ${now.toISOString()}`);
  console.log(`──────────────────────────────────────────────────\n`);

  // ── A. Find account ────────────────────────────────────────────────────────
  const account = await prisma.connectedAccount.findFirst({
    where: {
      OR: [
        { label: TARGET_ACCOUNT_LABEL },
        { displayName: TARGET_ACCOUNT_LABEL },
        { externalAccountId: TARGET_EXTERNAL_ACCOUNT_ID },
        { externalAccountId: TARGET_ACCOUNT_LABEL },
      ],
    },
    select: {
      id: true,
      label: true,
      displayName: true,
      externalAccountId: true,
      isActive: true,
      protectionStatus: true,
      missingFromBrokerSince: true,
      brokerConnectionId: true,
      sessionState: {
        select: {
          riskState: true,
          sessionDate: true,
          dailyPnl: true,
          cooldownActive: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!account) {
    record(
      "A. Account exists",
      "FAIL",
      `label="${TARGET_ACCOUNT_LABEL}" or externalAccountId="${TARGET_EXTERNAL_ACCOUNT_ID}"`,
      "NOT FOUND",
      "No ConnectedAccount row matched — cannot verify anything further.",
    );
    printReport();
    return;
  }

  record(
    "A. Account exists & active",
    account.isActive ? "PASS" : "WARN",
    `matched, isActive=true`,
    `id=${account.id}, label=${account.label}, isActive=${account.isActive}`,
    `matched externalAccountId=${account.externalAccountId ?? "null"}; ` +
      `protectionStatus=${account.protectionStatus}; ` +
      `missingFromBrokerSince=${fmtDate(account.missingFromBrokerSince)}`,
  );

  // ── B. LiveSessionState.riskState ────────────────────────────────────────
  const session = account.sessionState;

  if (!session) {
    record(
      "B. LiveSessionState.riskState",
      "FAIL",
      "STOPPED",
      "NO SESSION ROW",
      "No sessionState row — account never synced or row missing.",
    );
  } else {
    record(
      "B. LiveSessionState.riskState",
      session.riskState === "STOPPED" ? "PASS" : "FAIL",
      "STOPPED",
      session.riskState,
      `sessionDate=${session.sessionDate}, dailyPnl=${session.dailyPnl?.toString() ?? "null"}, ` +
        `cooldownActive=${session.cooldownActive}, updatedAt=${fmtDate(session.updatedAt)}`,
    );
  }

  // ── C/D. Active InternalLockEvent ──────────────────────────────────────────
  const activeLocks = await prisma.internalLockEvent.findMany({
    where: { accountId: account.id, clearedAt: null },
    select: {
      id: true,
      ruleType: true,
      tradingDay: true,
      internalOnly: true,
      brokerActionTaken: true,
      activeDedupKey: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const activeDailyLossLocks = activeLocks.filter((l) => l.ruleType === "daily_loss_limit");

  record(
    "C. Active InternalLockEvent (clearedAt=null)",
    activeLocks.length >= 1 ? "PASS" : "FAIL",
    ">= 1 active lock",
    `${activeLocks.length} active (${activeDailyLossLocks.length} daily_loss_limit)`,
    activeLocks.length === 0
      ? "No active lock — C2/C3 preconditions not met (run the C1 steps first)."
      : `ruleTypes: ${activeLocks.map((l) => l.ruleType).join(", ")}`,
  );

  record(
    "C. InternalLockEvent.ruleType = daily_loss_limit",
    activeDailyLossLocks.length >= 1 ? "PASS" : "FAIL",
    "daily_loss_limit",
    activeDailyLossLocks.length >= 1
      ? "daily_loss_limit"
      : activeLocks.length > 0
        ? activeLocks.map((l) => l.ruleType).join(", ")
        : "none",
  );

  if (activeLocks.length > 0) {
    const lock = activeDailyLossLocks[0] ?? activeLocks[0];
    record(
      "D. internalOnly=true & brokerActionTaken=false",
      lock.internalOnly === true && lock.brokerActionTaken === false ? "PASS" : "FAIL",
      "internalOnly=true, brokerActionTaken=false",
      `internalOnly=${lock.internalOnly}, brokerActionTaken=${lock.brokerActionTaken}`,
      lock.brokerActionTaken ? "Broker action flagged — unexpected for internal-only lock." : "",
    );
  }

  // ── E. Rules edit would be BLOCKED ─────────────────────────────────────────
  // Mirrors src/app/api/rules/route.ts:315 — hardStoppedAccounts filter on
  // riskState === "STOPPED" returns HTTP 423 and rejects the rule change.
  // (Also enforced per-account in src/app/api/accounts/[id]/route.ts:187.)
  const rulesEditBlocked = session?.riskState === "STOPPED";
  record(
    "E. Rules edit would be BLOCKED (HTTP 423)",
    rulesEditBlocked ? "PASS" : "FAIL",
    "blocked (riskState=STOPPED → 423)",
    rulesEditBlocked ? "BLOCKED — riskState=STOPPED" : `NOT blocked — riskState=${session?.riskState ?? "none"}`,
    "Derived from the same riskState the rules-edit gate reads. No API call made.",
  );

  // ── F. Account-removal guard would DEFER ───────────────────────────────────
  // Mirrors src/lib/account-removal-guard.ts evaluation order, read-only:
  //   1. missingFromBrokerSince set            → canRemoveNow=true  (bypass)
  //   2. protectionStatus ignored/archived     → canRemoveNow=true  (bypass)
  //   3. sessionDate==today & riskState=STOPPED → defer "session_stopped"
  //   4. sessionDate==today & cooldownActive    → defer "cooldown_active"
  //   5. active InternalLockEvent (today)       → defer "internal_lock:<ruleType>"
  const removalLock = await prisma.internalLockEvent.findFirst({
    where: { accountId: account.id, tradingDay: removalDayKey, clearedAt: null },
    select: { ruleType: true },
  });

  let canRemoveNow: boolean;
  let lockReason: string | null;
  if (account.missingFromBrokerSince != null) {
    canRemoveNow = true;
    lockReason = null;
  } else if (account.protectionStatus === "ignored" || account.protectionStatus === "archived") {
    canRemoveNow = true;
    lockReason = null;
  } else if (session?.sessionDate === removalDayKey && session?.riskState === "STOPPED") {
    canRemoveNow = false;
    lockReason = "session_stopped";
  } else if (session?.sessionDate === removalDayKey && session?.cooldownActive === true) {
    canRemoveNow = false;
    lockReason = "cooldown_active";
  } else if (removalLock) {
    canRemoveNow = false;
    lockReason = `internal_lock:${removalLock.ruleType}`;
  } else {
    canRemoveNow = true;
    lockReason = null;
  }

  record(
    "F. Account-removal guard would DEFER",
    canRemoveNow === false ? "PASS" : "FAIL",
    "canRemoveNow=false (deferred)",
    `canRemoveNow=${canRemoveNow}, lockReason=${lockReason ?? "null"}`,
    canRemoveNow
      ? "Guard would allow immediate removal — check bypass conditions (missingFromBroker / protectionStatus) " +
        "or whether the lock's tradingDay matches the CT calendar day."
      : "Mirrors account-removal-guard.ts. No removal API called.",
  );

  // ── G. internalLockActive derivable (dashboard signal) ─────────────────────
  // Mirrors command-center data.ts: internalLockActive = an InternalLockEvent
  // with clearedAt IS NULL exists for the account.
  const internalLockActive = activeLocks.length > 0;
  record(
    "G. internalLockActive derivable = true",
    internalLockActive ? "PASS" : "FAIL",
    "true (dashboard shows 'Guardrail internal lock active')",
    String(internalLockActive),
    "Derived the same way the command center derives internalLockActive.",
  );

  // ── H. GuardianIntervention — no broker_locked today ─────────────────────
  const brokerInterventions = await prisma.guardianIntervention.findMany({
    where: { accountId: account.id, createdAt: { gte: sessionStart } },
    select: { id: true, triggerType: true, outcome: true, brokerLockStatus: true },
    orderBy: { createdAt: "desc" },
  });
  const brokerLocked = brokerInterventions.filter((i) => i.brokerLockStatus === "broker_locked");
  record(
    "H. No broker_locked GuardianIntervention today",
    brokerLocked.length === 0 ? "PASS" : "FAIL",
    "0 broker_locked",
    `${brokerLocked.length} broker_locked (${brokerInterventions.length} total today)`,
    brokerLocked.length > 0
      ? `Unexpected broker enforcement: ${brokerLocked.map((i) => `${i.triggerType}/${i.outcome}`).join(", ")}`
      : brokerInterventions.length > 0
        ? `${brokerInterventions.length} non-broker intervention(s) today (monitoring_only / dry_run OK)`
        : "",
  );

  // ── I. BrokerOrderActionLog — no real orders today ────────────────────────
  const brokerOrders = await prisma.brokerOrderActionLog.findMany({
    where: { connectedAccountId: account.id, createdAt: { gte: sessionStart } },
    select: { id: true, actionType: true, triggerReason: true, dryRun: true },
    orderBy: { createdAt: "desc" },
  });
  const realOrders = brokerOrders.filter((o) => !o.dryRun);
  record(
    "I. No real BrokerOrderActionLog today",
    realOrders.length === 0 ? "PASS" : "FAIL",
    "0 real broker order logs",
    `${realOrders.length} real (${brokerOrders.length} total incl dry_run)`,
    realOrders.length > 0
      ? `Real broker orders found: ${realOrders.map((o) => `${o.actionType}/${o.triggerReason}`).join(", ")}`
      : "",
  );

  printReport();
}

function printReport(): void {
  const colW = [46, 6, 34, 34, 0];
  const sep = "─".repeat(130);

  console.log(sep);
  console.log(
    `${"CHECK".padEnd(colW[0])}  ${"RESULT".padEnd(colW[1])}  ${"EXPECTED".padEnd(colW[2])}  ${"ACTUAL".padEnd(colW[3])}  NOTES`,
  );
  console.log(sep);

  for (const r of rows) {
    const verdict =
      r.verdict === "PASS"
        ? "✅ PASS"
        : r.verdict === "FAIL"
          ? "❌ FAIL"
          : r.verdict === "WARN"
            ? "⚠️  WARN"
            : "   N/A";

    const check = r.check.slice(0, colW[0]).padEnd(colW[0]);
    const exp = r.expected.slice(0, colW[2]).padEnd(colW[2]);
    const act = r.actual.slice(0, colW[3]).padEnd(colW[3]);
    console.log(`${check}  ${verdict}  ${exp}  ${act}  ${r.notes}`);
  }

  console.log(sep);

  const passes = rows.filter((r) => r.verdict === "PASS").length;
  const fails = rows.filter((r) => r.verdict === "FAIL").length;
  const warns = rows.filter((r) => r.verdict === "WARN").length;
  const nas = rows.filter((r) => r.verdict === "N/A").length;

  const overall = fails > 0 ? "❌ FAIL" : warns > 0 ? "⚠️  WARN" : "✅ PASS";

  console.log(
    `\nOverall: ${overall}   (${passes} PASS  ${fails} FAIL  ${warns} WARN  ${nas} N/A)\n`,
  );

  if (fails > 0) {
    console.log("FAIL details:");
    for (const r of rows.filter((r) => r.verdict === "FAIL")) {
      console.log(`  ✗ ${r.check}: expected "${r.expected}", got "${r.actual}"`);
      if (r.notes) console.log(`    → ${r.notes}`);
    }
    console.log();
  }
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
