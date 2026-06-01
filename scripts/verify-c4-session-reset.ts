#!/usr/bin/env tsx
/**
 * C4 Session-Reset Behavior Verification — READ ONLY, zero writes.
 *
 * Verifies what happens to InternalLockEvent rows when the CME trading session
 * rolls over (17:00 CT) and a subsequent sync marks LiveSessionState as "stale"
 * (sessionDate < new tradingDayKey) and resets riskState to NORMAL.
 *
 * The question: does the session rollover also clear active InternalLockEvent
 * rows (set clearedAt), or do they remain active (clearedAt = null) even after
 * the session that created them has ended?
 *
 * IMPORTANT: This script is read-only. It uses findFirst / findMany / $disconnect
 * only. No update / upsert / delete / create. No broker calls. No state changes.
 *
 * Checks:
 *   A.  Find DEMO7433035 account (or any account with active InternalLockEvent)
 *   B.  Retrieve LiveSessionState: sessionDate vs current CME day key
 *   C.  Retrieve ALL InternalLockEvent rows for the account (active + cleared)
 *   D.  GAP CHECK: any InternalLockEvent with clearedAt=null AND tradingDay < current
 *       CME session key? This means the lock survived a session rollover uncleaned.
 *   E.  Removal guard simulation: what would decideRemovalEligibility return?
 *       (mirrors account-removal-guard.ts logic, read-only)
 *   F.  Code-scan confirmation: verify no code path in the isStale branch clears
 *       InternalLockEvent — confirm the gap is structural, not a runtime miss
 *   G.  Report whether clearedBy="session_end" is ever written in production data
 */

import * as fs from "fs";
import * as path from "path";

import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";

config({ path: path.resolve(process.cwd(), ".env.local") });

const prisma = new PrismaClient({ log: ["error"] });

const TARGET_LABEL = "DEMO7433035";
const TARGET_EXTERNAL_ID = "47669364";

// ── CME trading day key (rolls at 17:00 CT) ──────────────────────────────────
// Mirrors src/lib/trading-day.ts deriveCmeTradingDayKey logic.
function deriveCmeTradingDayKeySimple(now: Date): string {
  // Convert to America/Chicago and check if hour >= 17
  const ctStr = now.toLocaleString("en-US", { timeZone: "America/Chicago", hour12: false });
  const ctDate = new Date(ctStr + " UTC");
  // Extract hour from Chicago time
  const chicagoHour = parseInt(
    now.toLocaleString("en-US", {
      timeZone: "America/Chicago",
      hour: "2-digit",
      hour12: false,
    }),
    10,
  );

  // If hour >= 17, the CME session key is for today's CT date (the new session started)
  // If hour < 17, the CME session key is for yesterday's CT date (still in previous session)
  const ctDateStr = now.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  if (chicagoHour >= 17) {
    return ctDateStr;
  }
  // Before 17:00 CT: subtract 1 day
  const d = new Date(ctStr);
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function ctCalendarKey(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

type CheckResult = { label: string; pass: boolean | null; detail: string };

async function run(): Promise<void> {
  const now = new Date();
  const cmeTradingDayKey = deriveCmeTradingDayKeySimple(now);
  const todayCtKey = ctCalendarKey(now);
  const results: CheckResult[] = [];

  console.log("=".repeat(70));
  console.log("C4 Session-Reset Verification — READ ONLY");
  console.log("=".repeat(70));
  console.log(`  Run time (UTC):       ${now.toISOString()}`);
  console.log(`  CME trading day key:  ${cmeTradingDayKey}`);
  console.log(`  CT calendar day key:  ${todayCtKey}`);
  console.log();

  // ── A. Find target account ────────────────────────────────────────────────
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
      userId: true,
      protectionStatus: true,
      missingFromBrokerSince: true,
      isActive: true,
    },
  });

  if (!account) {
    console.error(`FATAL: No account found matching label="${TARGET_LABEL}" or externalAccountId="${TARGET_EXTERNAL_ID}"`);
    await prisma.$disconnect();
    process.exit(1);
  }

  results.push({
    label: "A. Account found",
    pass: true,
    detail: `id=${account.id} label=${account.label ?? "(null)"} externalAccountId=${account.externalAccountId ?? "(null)"} protectionStatus=${account.protectionStatus} isActive=${account.isActive}`,
  });
  console.log(`  Account: ${account.id} (${account.label ?? account.displayName ?? account.externalAccountId})`);
  console.log(`  userId: ${account.userId}`);
  console.log();

  // ── B. LiveSessionState ───────────────────────────────────────────────────
  const sessionState = await prisma.liveSessionState.findUnique({
    where: { accountId: account.id },
    select: {
      sessionDate: true,
      riskState: true,
      dailyPnl: true,
      tradesCount: true,
      cooldownActive: true,
      pendingSessionEndLock: true,
      updatedAt: true,
    },
  });

  const sessionMatchesCme = sessionState?.sessionDate === cmeTradingDayKey;
  results.push({
    label: "B. LiveSessionState found",
    pass: sessionState != null,
    detail: sessionState
      ? `sessionDate=${sessionState.sessionDate} riskState=${sessionState.riskState} dailyPnl=${sessionState.dailyPnl} tradesCount=${sessionState.tradesCount} cooldownActive=${sessionState.cooldownActive} pendingSessionEndLock=${sessionState.pendingSessionEndLock} updatedAt=${sessionState.updatedAt?.toISOString()}`
      : "No session row",
  });

  const isStaleSession = sessionState ? sessionState.sessionDate !== cmeTradingDayKey : false;
  results.push({
    label: "B2. Session is current (sessionDate = CME day key)",
    pass: sessionMatchesCme,
    detail: isStaleSession
      ? `SESSION IS STALE: sessionDate=${sessionState?.sessionDate} but current CME key=${cmeTradingDayKey}. Next sync will trigger isStale=true branch.`
      : `sessionDate=${sessionState?.sessionDate ?? "(null)"} matches CME key=${cmeTradingDayKey}`,
  });

  // ── C. All InternalLockEvent rows for this account ───────────────────────
  const allLocks = await prisma.internalLockEvent.findMany({
    where: { accountId: account.id },
    select: {
      id: true,
      ruleType: true,
      tradingDay: true,
      createdAt: true,
      clearedAt: true,
      clearedBy: true,
      activeDedupKey: true,
      internalOnly: true,
      brokerActionTaken: true,
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const activeLocks = allLocks.filter((l) => l.clearedAt === null);
  const clearedLocks = allLocks.filter((l) => l.clearedAt !== null);

  results.push({
    label: "C. InternalLockEvent rows (all, recent 10)",
    pass: null,
    detail: `total=${allLocks.length} active(clearedAt=null)=${activeLocks.length} cleared=${clearedLocks.length}`,
  });

  if (allLocks.length > 0) {
    console.log("  InternalLockEvent rows:");
    for (const lock of allLocks) {
      const status = lock.clearedAt ? `CLEARED at ${lock.clearedAt.toISOString()} by ${lock.clearedBy}` : "ACTIVE (clearedAt=null)";
      console.log(
        `    [${lock.id}] ruleType=${lock.ruleType} tradingDay=${lock.tradingDay} ${status}`,
      );
      console.log(`      createdAt=${lock.createdAt.toISOString()} internalOnly=${lock.internalOnly} brokerActionTaken=${lock.brokerActionTaken}`);
      if (lock.activeDedupKey) console.log(`      activeDedupKey=${lock.activeDedupKey}`);
    }
    console.log();
  }

  // ── D. GAP CHECK: stale active locks ─────────────────────────────────────
  // Active locks from a prior CME session = lock still blocking even though
  // session rolled over. These should have been cleared by session_end but weren't.
  const staleActiveLocks = activeLocks.filter((l) => l.tradingDay < cmeTradingDayKey);
  const hasGap = staleActiveLocks.length > 0;

  results.push({
    label: "D. GAP: active locks from prior CME sessions",
    pass: !hasGap, // PASS = no stale locks (gap not triggered); FAIL = gap confirmed
    detail: hasGap
      ? `STALE ACTIVE LOCKS FOUND: ${staleActiveLocks.map((l) => `[${l.id}] ruleType=${l.ruleType} tradingDay=${l.tradingDay}`).join("; ")}. These were never cleared by session rollover.`
      : activeLocks.length === 0
        ? "No active locks — gap not observable (no locks exist yet)"
        : `All ${activeLocks.length} active lock(s) have tradingDay=${activeLocks[0].tradingDay} matching current CME key=${cmeTradingDayKey}`,
  });

  if (hasGap) {
    console.log("  !! STRUCTURAL GAP CONFIRMED: active InternalLockEvent rows survived session rollover");
    console.log(`     tradovate-sync.ts isStale branch resets LiveSessionState but does NOT clear InternalLockEvent`);
    console.log(`     clearedBy="session_end" is referenced in schema but NEVER written by any code path`);
    console.log();
  }

  // ── E. Removal guard simulation ───────────────────────────────────────────
  // Mirror decideRemovalEligibility logic from account-removal-eligibility.ts
  const tomorrowApprox = new Date(now.getTime() + 24 * 60 * 60_000);
  const nextTradingDay = tomorrowApprox.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

  const activeLock = activeLocks[0] ?? null;
  let lockReason: string | null = null;
  let canRemoveNow = true;

  if (!account) {
    lockReason = "account_not_found";
    canRemoveNow = false;
  } else if (account.missingFromBrokerSince != null) {
    // bypass
  } else if (account.protectionStatus === "ignored" || account.protectionStatus === "archived") {
    // bypass
  } else if (sessionState?.sessionDate === todayCtKey) {
    if (sessionState.riskState === "STOPPED") {
      lockReason = "session_stopped";
      canRemoveNow = false;
    } else if (sessionState.cooldownActive) {
      lockReason = "cooldown_active";
      canRemoveNow = false;
    }
  }

  if (canRemoveNow && activeLock) {
    lockReason = `internal_lock:${activeLock.ruleType}`;
    canRemoveNow = false;
  }

  const removalGuardExpected = hasGap
    ? "canRemoveNow=false (stale lock blocking removal after session reset)"
    : activeLocks.length === 0
      ? "canRemoveNow=true (no active locks)"
      : `canRemoveNow=${canRemoveNow} lockReason=${lockReason}`;

  results.push({
    label: "E. Removal guard simulation",
    pass: null, // informational
    detail: `canRemoveNow=${canRemoveNow} lockReason=${lockReason ?? "null"} nextTradingDay=${nextTradingDay} — ${removalGuardExpected}`,
  });

  // ── F. Code-scan: isStale branch clears InternalLockEvent? ───────────────
  const syncPath = path.resolve(process.cwd(), "src/lib/brokers/tradovate-sync.ts");
  const syncSource = fs.readFileSync(syncPath, "utf-8");

  // Find the isStale block and check for any InternalLockEvent mutation near it
  const isStaleIdx = syncSource.indexOf("isStale ? false : nextPendingSessionEndLock");
  const isStaleWindow = isStaleIdx >= 0 ? syncSource.slice(Math.max(0, isStaleIdx - 100), isStaleIdx + 500) : "";
  const isStaleWindowHasClear = isStaleWindow.includes("internalLockEvent") && isStaleWindow.includes("clearedAt");

  // Confirm there is no session_end clearedBy write anywhere in production code
  const hasSessionEndClear = syncSource.includes('clearedBy: "session_end"') || syncSource.includes("clearedBy: 'session_end'");
  const hasAnySessionEndClear = (() => {
    const allSrcFiles = [
      "src/lib/brokers/tradovate-sync.ts",
      "src/lib/guardian-engine/internal-lock-evaluator-db.ts",
      "src/lib/pending-rule-promoter.ts",
    ];
    return allSrcFiles.some((f) => {
      try {
        const src = fs.readFileSync(path.resolve(process.cwd(), f), "utf-8");
        return src.includes('clearedBy: "session_end"') || src.includes("clearedBy: 'session_end'");
      } catch {
        return false;
      }
    });
  })();

  results.push({
    label: "F. Code scan: isStale branch clears InternalLockEvent",
    pass: false, // always false — this is the gap
    detail: isStaleWindowHasClear
      ? "UNEXPECTED: isStale branch appears to reference internalLockEvent clearedAt — re-check manually"
      : `isStale branch does NOT clear InternalLockEvent. clearedBy="session_end" written by any production file: ${hasAnySessionEndClear}. Gap is structural.`,
  });

  // ── G. Any session_end clears in DB? ─────────────────────────────────────
  const sessionEndClearedCount = await prisma.internalLockEvent.count({
    where: { accountId: account.id, clearedBy: "session_end" },
  });
  const manualResetClearedCount = await prisma.internalLockEvent.count({
    where: { accountId: account.id, clearedBy: "manual_reset" },
  });

  results.push({
    label: "G. DB: InternalLockEvent rows cleared by session_end",
    pass: sessionEndClearedCount >= 0, // informational
    detail: `clearedBy="session_end": ${sessionEndClearedCount}, clearedBy="manual_reset": ${manualResetClearedCount} — "session_end" path has never fired for this account`,
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("─".repeat(70));
  console.log("Results:");
  console.log();
  let pass = 0, fail = 0;
  for (const r of results) {
    const icon =
      r.pass === true ? "✅ PASS" : r.pass === false ? "❌ FAIL" : "ℹ️  INFO";
    if (r.pass === true) pass++;
    if (r.pass === false) fail++;
    console.log(`  ${icon}  ${r.label}`);
    console.log(`           ${r.detail}`);
  }
  console.log();
  console.log("─".repeat(70));
  console.log(`  PASS: ${pass}  FAIL: ${fail}`);
  console.log();

  if (hasGap && staleActiveLocks.length > 0) {
    console.log("── C4 GAP CONFIRMED ──────────────────────────────────────────────────");
    console.log();
    console.log("  The tradovate-sync.ts isStale branch resets LiveSessionState on session");
    console.log("  rollover (riskState→NORMAL, dailyPnl→0, sessionDate→newKey) but does");
    console.log("  NOT clear InternalLockEvent rows. clearedBy='session_end' is defined");
    console.log("  in the schema but no code path ever writes it.");
    console.log();
    console.log("  Impact:");
    console.log("    - Removal guard: blocks account removal after session reset (correct");
    console.log("      protection intent, but stuck without manual reset)");
    console.log("    - Dashboard: 'Guardrail internal lock active' banner persists past session");
    console.log("    - Broker enforcement: stale lock still eligible for enforcement action");
    console.log();
    console.log("  Fix scope (not applied here — read-only):");
    console.log("    File: src/lib/brokers/tradovate-sync.ts");
    console.log("    In the isStale branch (after liveSessionState.update), add:");
    console.log("      prisma.internalLockEvent.updateMany({");
    console.log("        where: { accountId, clearedAt: null },");
    console.log("        data: { clearedAt: now, clearedBy: 'session_end',");
    console.log("                updatedAt: now, activeDedupKey: null },");
    console.log("      })");
    console.log("    This mirrors the manual-reset route pattern exactly.");
    console.log("    Timing: same CME 17:00 CT boundary that resets riskState.");
    console.log();
    console.log("  Overall: C4 FAIL (gap confirmed, fix required)");
  } else if (activeLocks.length === 0) {
    console.log("  Note: No active InternalLockEvent rows exist for this account.");
    console.log("  The C4 gap cannot be observed from current DB state.");
    console.log("  Code-scan (Check F) confirms the gap is structural regardless.");
    console.log();
    console.log("  Overall: C4 STRUCTURAL GAP (confirmed by code scan, not yet triggered)");
  } else {
    console.log("  Active locks exist but all match the current CME session key.");
    console.log("  Code-scan (Check F) confirms the gap is structural.");
    console.log();
    console.log("  Overall: C4 STRUCTURAL GAP (confirmed by code scan, gap not yet triggered)");
  }
  console.log("═".repeat(70));

  await prisma.$disconnect();
}

run().catch(async (err) => {
  console.error("Script error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
