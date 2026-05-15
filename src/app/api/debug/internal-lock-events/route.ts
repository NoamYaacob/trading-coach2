/**
 * GET /api/debug/internal-lock-events
 *
 * Read-only history of InternalLockEvent rows — the Phase 2B audit trail.
 * Returns totals, active/cleared counts, and rows grouped by account and
 * rule type so operators can review lock history without trawling raw DB.
 *
 * Also returns linked GuardianIntervention rows (Phase 2C-A foundation):
 *   - brokerEnforcements.count       — how many GuardianInterventions link to these locks
 *   - brokerEnforcements.hasAnyBrokerLocked — whether any broker write succeeded
 *   - brokerEnforcements.items       — intervention id, dedupKey, lockStatus per lock event
 *
 * Safety:
 *   - Read-only — never writes any DB row
 *   - No enforcement, no broker writes, no riskState mutations
 *   - Auth: authenticated session + x-cron-secret always required
 *   - Only returns rows owned by the current user (userId filter)
 *
 * Response note field explicitly states:
 *   "Internal app lock only — no broker action was sent."
 *
 * Query params:
 *   - days:      number of days to include (default 7, max 30)
 *   - accountId: filter to a specific ConnectedAccount.id (optional)
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  buildLockEventSummary,
  type LockEventRow,
} from "@/lib/guardian-engine/internal-lock-event-summary-helpers";

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
  const daysParam = Math.min(30, Math.max(1, parseInt(sp.get("days") ?? "7", 10) || 7));
  const accountIdFilter = sp.get("accountId") ?? undefined;

  const since = new Date(Date.now() - daysParam * 24 * 60 * 60 * 1000);

  const rows = await prisma.internalLockEvent.findMany({
    where: {
      userId: currentUser.id,
      createdAt: { gte: since },
      ...(accountIdFilter ? { accountId: accountIdFilter } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      accountId: true,
      ruleType: true,
      tradingDay: true,
      thresholdAmount: true,
      thresholdCount: true,
      observedAmount: true,
      observedCount: true,
      internalOnly: true,
      brokerActionTaken: true,
      createdAt: true,
      clearedAt: true,
      clearedBy: true,
      account: {
        select: {
          label: true,
          externalAccountId: true,
          brokerConnection: { select: { env: true } },
        },
      },
    },
  });

  const cappedAt200 = rows.length === 200;

  const lockEventRows: LockEventRow[] = rows.map((r) => ({
    id: r.id,
    accountId: r.accountId,
    accountLabel: r.account.label,
    externalAccountId: r.account.externalAccountId,
    env: r.account.brokerConnection?.env ?? "demo",
    ruleType: r.ruleType,
    tradingDay: r.tradingDay,
    thresholdAmount: r.thresholdAmount != null ? Number(r.thresholdAmount) : null,
    thresholdCount: r.thresholdCount ?? null,
    observedAmount: r.observedAmount != null ? Number(r.observedAmount) : null,
    observedCount: r.observedCount ?? null,
    internalOnly: r.internalOnly,
    brokerActionTaken: r.brokerActionTaken,
    createdAt: r.createdAt,
    clearedAt: r.clearedAt,
    clearedBy: r.clearedBy,
  }));

  const summary = buildLockEventSummary(lockEventRows);

  const lockEventIds = lockEventRows.map((r) => r.id);
  const interventions =
    lockEventIds.length > 0
      ? await prisma.guardianIntervention.findMany({
          where: { internalLockEventId: { in: lockEventIds } },
          select: {
            id: true,
            internalLockEventId: true,
            listenerBrokerDedupKey: true,
            brokerLockStatus: true,
          },
        })
      : [];

  const hasAnyBrokerLocked = interventions.some((i) => i.brokerLockStatus === "broker_locked");

  const brokerEnforcements = {
    count: interventions.length,
    hasAnyBrokerLocked,
    // True when a broker_locked GuardianIntervention exists for a lock that has
    // since been reset (activeCount=0). The broker-side changesLocked may still
    // be in effect on Tradovate until the next session open — see runbook R5.
    hasHistoricalBrokerLockOnly: hasAnyBrokerLocked && summary.activeCount === 0,
    items: interventions.map((i) => ({
      interventionId: i.id,
      internalLockEventId: i.internalLockEventId,
      dedupKey: i.listenerBrokerDedupKey,
      brokerLockStatus: i.brokerLockStatus,
    })),
  };

  return NextResponse.json({
    note: "Internal lock event history. Broker write results (if any) are in brokerEnforcements. A broker_locked row is a historical audit record — it does not reflect whether the Tradovate risk setting is still active.",
    internalLockEnabled: process.env.GUARDRAIL_INTERNAL_LOCK_ENABLED === "true",
    queryDays: daysParam,
    ...(cappedAt200
      ? { warning: "Result capped at 200 rows — consider narrowing the days or accountId filter." }
      : {}),
    ...summary,
    brokerEnforcements,
  });
}
