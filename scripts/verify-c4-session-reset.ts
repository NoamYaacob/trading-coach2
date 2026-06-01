#!/usr/bin/env tsx
/**
 * C4 Session-Reset Behavior Verification — READ ONLY, zero writes.
 *
 * Verifies the FIXED session-reset behavior: when the CME trading session rolls
 * over (17:00 CT) and a subsequent sync marks LiveSessionState as "stale"
 * (sessionDate !== new tradingDayKey), the isStale branch in tradovate-sync.ts
 * must clear active InternalLockEvent rows (clearedBy="session_end") alongside
 * the riskState/dailyPnl reset — so a finished session's lock no longer blocks
 * account removal, the dashboard banner, or broker enforcement.
 *
 * IMPORTANT: This script is read-only. It uses findFirst / findMany / count /
 * $disconnect only. No update / upsert / delete / create. No broker calls.
 *
 * Checks:
 *   A.  Find DEMO7433035 account (or any account with active InternalLockEvent)
 *   B.  Retrieve LiveSessionState: sessionDate vs current CME day key
 *   C.  Retrieve ALL InternalLockEvent rows for the account (active + cleared)
 *   D.  REGRESSION CHECK: a lock with clearedAt=null AND tradingDay < current CME
 *       key is a failure only when the session has ALREADY rolled (sessionDate =
 *       current key) — meaning the isStale cleanup ran but left the lock active.
 *       When the session itself is still stale, the lock is a transient that the
 *       next rollover sync will clear.
 *   E.  Removal guard simulation: what would decideRemovalEligibility return?
 *       (mirrors account-removal-guard.ts logic, read-only)
 *   F.  Code-scan: confirm the isStale branch clears InternalLockEvent via
 *       updateMany {clearedAt:null} → clearedBy="session_end", activeDedupKey=null
 *   G.  Report counts of clearedBy="session_end" vs "manual_reset" in DB
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

  // Post-fix semantics: a stale active lock is only a genuine regression when
  // the session has ALREADY rolled (sessionDate = current CME key) yet the lock
  // survived — the isStale cleanup should have cleared it on that sync. When the
  // session itself is still stale, no sync has run since rollover; the next sync
  // will clear both together, so a transient stale lock is expected, not a bug.
  const sessionAlreadyRolled = sessionState?.sessionDate === cmeTradingDayKey;
  const regressionLeak = hasGap && sessionAlreadyRolled;

  results.push({
    label: "D. Stale active locks survived a completed rollover",
    pass: !regressionLeak, // FAIL only when session rolled but a prior-session lock remains active
    detail: regressionLeak
      ? `REGRESSION: session already rolled to ${cmeTradingDayKey} but active lock(s) from a prior session survived: ${staleActiveLocks.map((l) => `[${l.id}] ruleType=${l.ruleType} tradingDay=${l.tradingDay}`).join("; ")}. The isStale cleanup did not fire.`
      : hasGap
        ? `Transient: stale active lock(s) exist (${staleActiveLocks.map((l) => l.tradingDay).join(",")}) but the session is also stale (sessionDate=${sessionState?.sessionDate}). The next sync's isStale cleanup will clear them.`
        : activeLocks.length === 0
          ? "No active locks — nothing to clear"
          : `All ${activeLocks.length} active lock(s) carry tradingDay=${activeLocks[0].tradingDay} matching current CME key=${cmeTradingDayKey}`,
  });

  if (regressionLeak) {
    console.log("  !! REGRESSION: active InternalLockEvent rows survived a COMPLETED session rollover");
    console.log("     The isStale cleanup in tradovate-sync.ts should have cleared these.");
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

  // ── F. Code-scan: isStale branch clears InternalLockEvent (FIX VERIFY) ───
  // After the C4 fix, the isStale rollover branch in tradovate-sync.ts MUST
  // clear active locks via updateMany with clearedBy="session_end". This check
  // PASSES when the fix is present and FAILS if it has regressed.
  const syncPath = path.resolve(process.cwd(), "src/lib/brokers/tradovate-sync.ts");
  const syncSource = fs.readFileSync(syncPath, "utf-8");

  // Strip comments so we assert on real code, not the explanatory comment.
  const syncCode = syncSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  const isStaleGuardIdx = syncCode.indexOf("if (isStale)");
  const updateManyIdx = syncCode.indexOf("internalLockEvent.updateMany");
  const cleanupBlock =
    updateManyIdx >= 0 ? syncCode.slice(updateManyIdx, updateManyIdx + 400) : "";

  const fixPresent =
    isStaleGuardIdx >= 0 &&
    updateManyIdx > isStaleGuardIdx &&
    updateManyIdx - isStaleGuardIdx < 300 &&
    cleanupBlock.includes("clearedAt: null") &&
    cleanupBlock.includes('clearedBy: "session_end"') &&
    cleanupBlock.includes("activeDedupKey: null");

  results.push({
    label: "F. Code scan: isStale branch clears InternalLockEvent (C4 fix)",
    pass: fixPresent,
    detail: fixPresent
      ? 'isStale branch clears active locks via internalLockEvent.updateMany {clearedAt:null} → clearedBy="session_end", activeDedupKey=null. Fix present.'
      : "REGRESSION: isStale branch does not clear InternalLockEvent with the expected fields. The C4 fix is missing.",
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
    pass: null, // informational
    detail: `clearedBy="session_end": ${sessionEndClearedCount}, clearedBy="manual_reset": ${manualResetClearedCount}${sessionEndClearedCount > 0 ? " — session_end cleanup has fired (fix observed in production data)" : " — no session_end clears yet (cleanup fires on the next rollover sync)"}`,
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

  // Overall verdict reflects the FIXED behavior. The C4 fix is correct when:
  //   - the code scan (F) shows the isStale cleanup is present, AND
  //   - no lock survived a completed rollover (D regression not triggered).
  const fixOk = fixPresent && !regressionLeak;

  if (regressionLeak) {
    console.log("── C4 REGRESSION ─────────────────────────────────────────────────────");
    console.log();
    console.log("  The session has rolled over but an active InternalLockEvent from a");
    console.log("  prior session survived. The isStale cleanup in tradovate-sync.ts did");
    console.log("  not clear it. Investigate whether the cleanup branch ran on the");
    console.log("  rollover sync (check Railway logs and the lock's clearedBy/clearedAt).");
    console.log();
    console.log("  Overall: C4 FAIL (regression — stale lock survived a completed rollover)");
  } else if (!fixPresent) {
    console.log("── C4 FIX MISSING ────────────────────────────────────────────────────");
    console.log();
    console.log("  The isStale branch in tradovate-sync.ts does not clear active");
    console.log("  InternalLockEvent rows with the expected fields (clearedAt: null →");
    console.log('   clearedBy="session_end", activeDedupKey=null). The C4 fix has');
    console.log("  regressed or was reverted.");
    console.log();
    console.log("  Overall: C4 FAIL (fix not present in source)");
  } else if (hasGap) {
    console.log("── C4 FIX PRESENT — transient stale lock pending next sync ────────────");
    console.log();
    console.log("  The isStale cleanup is present in source. A stale active lock exists");
    console.log("  but the session itself has not yet rolled in the DB (no sync since");
    console.log("  17:00 CT). The next sync's isStale branch will clear it together with");
    console.log("  the LiveSessionState reset.");
    console.log();
    console.log("  Overall: C4 PASS (fix in place; transient lock clears on next sync)");
  } else {
    console.log("── C4 FIX VERIFIED ───────────────────────────────────────────────────");
    console.log();
    console.log("  The isStale branch clears active InternalLockEvent rows on session");
    console.log('  rollover (clearedBy="session_end", activeDedupKey=null), mirroring the');
    console.log("  manual-reset route. No active lock survived a completed rollover.");
    console.log();
    console.log(`  Overall: C4 ${fixOk ? "PASS" : "FAIL"} (session-reset cleanup working)`);
  }
  console.log("═".repeat(70));

  await prisma.$disconnect();
}

run().catch(async (err) => {
  console.error("Script error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
