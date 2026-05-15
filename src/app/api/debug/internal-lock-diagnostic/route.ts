/**
 * GET /api/debug/internal-lock-diagnostic
 *
 * Phase 2B diagnostic endpoint — read-only. Surfaces every fact needed to
 * diagnose why applyInternalLockForConnection is or is not creating a lock.
 *
 * Checks (in the order the real function executes):
 *   1. GUARDRAIL_INTERNAL_LOCK_ENABLED flag value (web-process view)
 *   2. DB schema probe — does activeDedupKey column exist in InternalLockEvent?
 *      (The most likely failure point after the idempotency fix migration)
 *   3. Account query results: isActive, protectionStatus, env, riskRules,
 *      sessionState — every field that gates the real function
 *   4. canApplyInternalLock evaluation
 *   5. evaluateDryRunRules result — violations, primary rule
 *   6. Computed activeDedupKey
 *   7. Existing active lock count for this account
 *   8. Any active lock rows with a non-null activeDedupKey (confirms old rows
 *      were correctly cleared to null)
 *
 * Safety:
 *   - Read-only — never writes any DB row
 *   - No broker writes, no Tradovate calls
 *   - Auth: authenticated session + x-cron-secret
 *   - Only reads rows owned by the current user
 *
 * Query params:
 *   - accountId: required — the ConnectedAccount.id to diagnose
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canApplyInternalLock, buildInternalLockDedupKey } from "@/lib/guardian-engine/internal-lock-evaluator";
import { evaluateDryRunRules } from "@/lib/guardian-engine/dry-run-rule-evaluator";

export async function GET(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const secret = request.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const accountId = sp.get("accountId");
  if (!accountId) {
    return NextResponse.json(
      { error: "accountId query param required" },
      { status: 400 },
    );
  }

  // ── 1. Flag state (web-process view) ────────────────────────────────────
  const internalLockEnabled = process.env.GUARDRAIL_INTERNAL_LOCK_ENABLED === "true";

  // ── 2. DB schema probe — does activeDedupKey column exist? ─────────────
  // If migration 20260522000000_add_internal_lock_event_dedup_key was NOT
  // applied, this query will throw a DB error. We catch it so the rest of
  // the diagnostic still runs.
  let activeDedupKeyColumnExists: boolean;
  let activeDedupKeyProbeError: string | null = null;
  try {
    await prisma.internalLockEvent.findFirst({
      where: { accountId },
      select: { activeDedupKey: true },
      take: 1,
    });
    activeDedupKeyColumnExists = true;
  } catch (err) {
    activeDedupKeyColumnExists = false;
    activeDedupKeyProbeError =
      err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }

  // ── 3. Account query — mirrors applyInternalLockForConnection exactly ───
  const account = await prisma.connectedAccount.findFirst({
    where: { id: accountId, userId: currentUser.id },
    select: {
      id: true,
      userId: true,
      externalAccountId: true,
      isActive: true,
      protectionStatus: true,
      brokerConnection: {
        select: { env: true, connectionStatus: true },
      },
      sessionState: {
        select: {
          riskState: true,
          dailyPnl: true,
          tradesCount: true,
          tradeCountSource: true,
          consecutiveLosses: true,
          sessionDate: true,
        },
      },
      riskRules: {
        select: {
          maxDailyLoss: true,
          maxTradesPerDay: true,
          stopAfterLosses: true,
        },
      },
    },
  });

  if (!account) {
    return NextResponse.json(
      { error: "account not found or not owned by current user" },
      { status: 404 },
    );
  }

  // ── 4. Gate evaluation — mirrors applyInternalLockForConnection ─────────
  const today = new Date().toISOString().slice(0, 10);
  const session = account.sessionState;
  const rules = account.riskRules;
  const env = account.brokerConnection?.env ?? "live";

  const gateResults = {
    hasSession: session != null,
    sessionRiskState: session?.riskState ?? null,
    sessionDate: session?.sessionDate ?? null,
    hasRiskRules: rules != null,
    maxDailyLossInAccountRules: rules?.maxDailyLoss != null ? Number(rules.maxDailyLoss) : null,
    maxTradesPerDayInAccountRules: rules?.maxTradesPerDay ?? null,
    stopAfterLossesInAccountRules: rules?.stopAfterLosses ?? null,
    env,
    isActive: account.isActive,
    protectionStatus: account.protectionStatus,
    skipReasons: [] as string[],
  };

  // Simulate the guard conditions
  if (!account.isActive) gateResults.skipReasons.push("isActive=false");
  if (account.protectionStatus !== "protected") {
    gateResults.skipReasons.push(`protectionStatus="${account.protectionStatus}" (must be "protected")`);
  }
  if (!session) gateResults.skipReasons.push("no LiveSessionState row");
  if (!rules) gateResults.skipReasons.push("no AccountRiskRules row — maxDailyLoss comes from user-level RiskRules which this evaluator does NOT read");

  const canLock = session != null && rules != null
    ? canApplyInternalLock({ env, riskState: session.riskState, flagEnabled: true })
    : false;

  if (session && rules && !canLock) {
    if (env !== "demo") gateResults.skipReasons.push(`env="${env}" (must be "demo")`);
    if (session.riskState === "STOPPED") gateResults.skipReasons.push('riskState="STOPPED" (already locked — idempotent skip)');
  }

  // ── 5. Rule evaluation ───────────────────────────────────────────────────
  const tradingDay = session?.sessionDate ?? today;
  let violations: ReturnType<typeof evaluateDryRunRules>["violations"] = [];
  let evaluationNote: string | null = null;

  if (session && rules) {
    const evalResult = evaluateDryRunRules({
      accountId: account.id,
      userId: account.userId,
      externalAccountId: account.externalAccountId ?? null,
      env,
      tradingDay,
      dailyPnl: Number(session.dailyPnl),
      tradesCount: session.tradesCount,
      tradeCountSource: session.tradeCountSource,
      consecutiveLosses: session.consecutiveLosses,
      maxDailyLoss: rules.maxDailyLoss != null ? Number(rules.maxDailyLoss) : null,
      maxTradesPerDay: rules.maxTradesPerDay ?? null,
      stopAfterLosses: rules.stopAfterLosses ?? null,
    });
    violations = evalResult.violations;
    if (violations.length === 0) {
      evaluationNote = "No violations detected — lock would not fire even if all other gates passed.";
    }
  } else {
    evaluationNote = "Evaluation skipped — missing session or riskRules.";
  }

  const primaryViolation = violations[0] ?? null;

  // ── 6. Computed dedup key ────────────────────────────────────────────────
  const computedDedupKey = primaryViolation
    ? buildInternalLockDedupKey(account.id, primaryViolation.ruleType, tradingDay)
    : null;

  // ── 7. Active lock state for this account ───────────────────────────────
  const [activeLocks, allLocks] = await Promise.all([
    prisma.internalLockEvent.findMany({
      where: { accountId, clearedAt: null },
      select: {
        id: true,
        ruleType: true,
        tradingDay: true,
        activeDedupKey: activeDedupKeyColumnExists ? true : undefined,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.internalLockEvent.count({ where: { accountId } }),
  ]);

  // ── 8. Diagnosis summary ─────────────────────────────────────────────────
  const wouldCreateLock =
    activeDedupKeyColumnExists &&
    internalLockEnabled &&
    account.isActive &&
    account.protectionStatus === "protected" &&
    session != null &&
    rules != null &&
    canLock &&
    violations.length > 0;

  const diagnosisPoints: string[] = [];

  if (!activeDedupKeyColumnExists) {
    diagnosisPoints.push(
      "CRITICAL: activeDedupKey column does not exist in the DB. " +
      "Migration 20260522000000_add_internal_lock_event_dedup_key was NOT applied. " +
      "The upsert fails with a DB column-not-found error every time applyInternalLockForConnection runs. " +
      "This error is silently swallowed by the .catch() block in the listener worker. " +
      "FIX: apply the migration to the production DB, then restart the listener worker.",
    );
  }
  if (!internalLockEnabled) {
    diagnosisPoints.push(
      "GUARDRAIL_INTERNAL_LOCK_ENABLED is false in the web process. " +
      "Note: the listener-worker is a separate process — its env var may differ.",
    );
  }
  if (gateResults.skipReasons.length > 0) {
    diagnosisPoints.push(`Gate would skip this account: ${gateResults.skipReasons.join("; ")}`);
  }
  if (violations.length === 0 && session != null && rules != null) {
    diagnosisPoints.push(
      "evaluateDryRunRules found no violations. " +
      "If the dashboard shows would_fire, it may be reading from DryRunViolation rows (Phase 2A) " +
      "which use a different query path that DOES read user-level RiskRules fallback.",
    );
  }
  if (wouldCreateLock) {
    diagnosisPoints.push(
      "All gates pass and a violation is detected — the lock WOULD be created if the migration is deployed.",
    );
  }

  return NextResponse.json({
    note: "Read-only diagnostic — no writes. Check diagnosisPoints for the likely root cause.",
    internalLockEnabledInWebProcess: internalLockEnabled,
    activeDedupKeyColumnExists,
    activeDedupKeyProbeError,
    wouldCreateLock,
    diagnosisPoints,
    gates: gateResults,
    sessionDetails: session
      ? {
          riskState: session.riskState,
          sessionDate: session.sessionDate,
          dailyPnl: Number(session.dailyPnl),
          tradesCount: session.tradesCount,
          consecutiveLosses: session.consecutiveLosses,
        }
      : null,
    violations: violations.map((v) => ({
      ruleType: v.ruleType,
      observedAmount: v.observedAmount,
      observedCount: v.observedCount,
      thresholdAmount: v.thresholdAmount,
      thresholdCount: v.thresholdCount,
    })),
    evaluationNote,
    computedDedupKey,
    tradingDay,
    activeLocks,
    totalHistoricalLockCount: allLocks,
  });
}
