#!/usr/bin/env tsx
/**
 * C1 Internal-Lock Verification — READ ONLY, zero writes.
 *
 * Verifies that the C1 listener correctly set an internal app lock on
 * DEMO7433035 after a daily-loss-limit breach. Run AFTER manually:
 *   1. Setting maxDailyLoss on the account
 *   2. Placing a small demo losing trade that crosses the threshold
 *   3. Triggering the listener / sync
 *
 * Checks (all read-only Prisma queries):
 *   A. Account exists and is active
 *   B. LiveSessionState.riskState = "STOPPED"
 *   C. InternalLockEvent: exactly 1 active (clearedAt IS NULL), ruleType = daily_loss_limit
 *   D. InternalLockEvent: internalOnly = true, brokerActionTaken = false
 *   E. InternalLockEvent: tradingDay matches today's CME session
 *   F. InternalLockEvent: createdAt is within today's CME session window (recent)
 *   G. No GuardianIntervention with brokerLockStatus = "broker_locked" today (no broker write)
 *   H. No BrokerOrderActionLog rows for this account in today's session (no broker orders)
 *
 * Usage (run via Railway for prod DB access):
 *   railway run npx tsx scripts/verify-c1-internal-lock.ts
 *
 * Or locally (requires .env.local with DATABASE_URL):
 *   source .env.local && npx tsx scripts/verify-c1-internal-lock.ts
 *
 * Tokens and secrets are NEVER printed.
 */

import { resolve } from "path";
import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });

import { prisma } from "../src/lib/db.ts";
import { deriveCmeTradingDayKey, deriveCmeTradingDaySessionStart } from "../src/lib/trading-day.ts";

// ── Config ───────────────────────────────────────────────────────────────────

const TARGET_ACCOUNT_EXTERNAL_ID = "DEMO7433035";

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
  const todayKey = deriveCmeTradingDayKey(now);
  const sessionStart = deriveCmeTradingDaySessionStart(now);

  console.log(`\n=== C1 Internal-Lock Verification ===`);
  console.log(`Target account : ${TARGET_ACCOUNT_EXTERNAL_ID}`);
  console.log(`CME trading day: ${todayKey}`);
  console.log(`Session start  : ${sessionStart.toISOString()}`);
  console.log(`Now            : ${now.toISOString()}`);
  console.log(`────────────────────────────────────\n`);

  // ── A. Find account ────────────────────────────────────────────────────────

  const account = await prisma.connectedAccount.findFirst({
    where: { externalAccountId: TARGET_ACCOUNT_EXTERNAL_ID },
    select: {
      id: true,
      label: true,
      externalAccountId: true,
      isActive: true,
      protectionStatus: true,
      brokerConnectionId: true,
      sessionState: {
        select: {
          riskState: true,
          sessionDate: true,
          dailyPnl: true,
          tradesCount: true,
          updatedAt: true,
        },
      },
      riskRules: {
        select: {
          maxDailyLoss: true,
        },
      },
    },
  });

  if (!account) {
    record(
      "A. Account exists",
      "FAIL",
      TARGET_ACCOUNT_EXTERNAL_ID,
      "NOT FOUND",
      "No ConnectedAccount row with this externalAccountId — cannot verify anything further.",
    );
    printReport();
    return;
  }

  record(
    "A. Account exists",
    "PASS",
    `externalAccountId = ${TARGET_ACCOUNT_EXTERNAL_ID}`,
    `id = ${account.id}, label = ${account.label}`,
    `isActive = ${account.isActive}, protectionStatus = ${account.protectionStatus}`,
  );

  if (!account.isActive) {
    record(
      "A. Account active",
      "WARN",
      "isActive = true",
      "isActive = false",
      "Account is inactive — lock may still exist but monitoring is off.",
    );
  }

  // ── B. LiveSessionState.riskState ────────────────────────────────────────

  const session = account.sessionState;

  if (!session) {
    record(
      "B. LiveSessionState exists",
      "FAIL",
      "LiveSessionState row present",
      "NOT FOUND",
      "No sessionState row — listener may not have run yet, or account was never synced.",
    );
  } else {
    record(
      "B. LiveSessionState.riskState",
      session.riskState === "STOPPED" ? "PASS" : "FAIL",
      "STOPPED",
      session.riskState,
      `sessionDate = ${session.sessionDate}, dailyPnl = ${session.dailyPnl?.toString() ?? "null"}, ` +
        `tradesCount = ${session.tradesCount}, updatedAt = ${fmtDate(session.updatedAt)}`,
    );

    record(
      "B. LiveSessionState.sessionDate",
      session.sessionDate === todayKey ? "PASS" : "WARN",
      todayKey,
      session.sessionDate ?? "null",
      session.sessionDate !== todayKey
        ? "Session date mismatch — listener may have run in a different CME session, or session was not reset."
        : "",
    );
  }

  // ── C/D/E/F. InternalLockEvent ────────────────────────────────────────────

  const activeLocks = await prisma.internalLockEvent.findMany({
    where: {
      accountId: account.id,
      clearedAt: null,
    },
    select: {
      id: true,
      ruleType: true,
      tradingDay: true,
      thresholdAmount: true,
      observedAmount: true,
      internalOnly: true,
      brokerActionTaken: true,
      activeDedupKey: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  record(
    "C. Active InternalLockEvent count",
    activeLocks.length === 1 ? "PASS" : activeLocks.length === 0 ? "FAIL" : "WARN",
    "1",
    String(activeLocks.length),
    activeLocks.length === 0
      ? "No active lock found — C1 may not have fired or lock was already cleared."
      : activeLocks.length > 1
        ? `Multiple active locks: ${activeLocks.map((l) => l.ruleType).join(", ")}`
        : "",
  );

  if (activeLocks.length > 0) {
    const lock = activeLocks[0];

    record(
      "C. InternalLockEvent.ruleType",
      lock.ruleType === "daily_loss_limit" ? "PASS" : "FAIL",
      "daily_loss_limit",
      lock.ruleType,
      `thresholdAmount = ${lock.thresholdAmount?.toString() ?? "null"}, ` +
        `observedAmount = ${lock.observedAmount?.toString() ?? "null"}`,
    );

    record(
      "D. InternalLockEvent.internalOnly",
      lock.internalOnly === true ? "PASS" : "FAIL",
      "true",
      String(lock.internalOnly),
    );

    record(
      "D. InternalLockEvent.brokerActionTaken",
      lock.brokerActionTaken === false ? "PASS" : "FAIL",
      "false",
      String(lock.brokerActionTaken),
      lock.brokerActionTaken ? "Broker action was taken — unexpected for internal-only C1 lock." : "",
    );

    record(
      "E. InternalLockEvent.tradingDay",
      lock.tradingDay === todayKey ? "PASS" : "WARN",
      todayKey,
      lock.tradingDay,
      lock.tradingDay !== todayKey
        ? "TradingDay mismatch — lock may be from a prior session or backfill."
        : "",
    );

    const isRecent = lock.createdAt.getTime() >= sessionStart.getTime();
    record(
      "F. InternalLockEvent.createdAt recent",
      isRecent ? "PASS" : "WARN",
      `>= ${sessionStart.toISOString()}`,
      fmtDate(lock.createdAt),
      isRecent
        ? ""
        : "Lock was created before today's session start — may be a stale lock from a prior session.",
    );

    record(
      "F. InternalLockEvent.activeDedupKey",
      lock.activeDedupKey != null ? "PASS" : "FAIL",
      "non-null (active lock slot held)",
      lock.activeDedupKey ?? "null",
    );
  }

  // ── G. GuardianIntervention — no broker_locked today ─────────────────────

  const brokerInterventions = await prisma.guardianIntervention.findMany({
    where: {
      accountId: account.id,
      createdAt: { gte: sessionStart },
    },
    select: {
      id: true,
      triggerType: true,
      outcome: true,
      brokerLockStatus: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const brokerLocked = brokerInterventions.filter((i) => i.brokerLockStatus === "broker_locked");

  record(
    "G. No broker_locked GuardianIntervention today",
    brokerLocked.length === 0 ? "PASS" : "FAIL",
    "0 broker_locked interventions",
    `${brokerLocked.length} broker_locked (${brokerInterventions.length} total today)`,
    brokerLocked.length > 0
      ? `Unexpected broker enforcement: ${brokerLocked.map((i) => `${i.triggerType}/${i.outcome}`).join(", ")}`
      : brokerInterventions.length > 0
        ? `${brokerInterventions.length} non-broker intervention(s) today (monitoring_only / dry_run are OK)`
        : "",
  );

  // ── H. BrokerOrderActionLog — no orders today ────────────────────────────

  const brokerOrders = await prisma.brokerOrderActionLog.findMany({
    where: {
      connectedAccountId: account.id,
      createdAt: { gte: sessionStart },
    },
    select: {
      id: true,
      actionType: true,
      triggerReason: true,
      dryRun: true,
      success: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const realOrders = brokerOrders.filter((o) => !o.dryRun);

  record(
    "H. No BrokerOrderActionLog (real) today",
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
  const colW = [44, 6, 28, 28, 0];
  const sep = "─".repeat(120);

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
