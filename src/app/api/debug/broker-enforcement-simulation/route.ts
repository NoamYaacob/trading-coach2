/**
 * GET /api/debug/broker-enforcement-simulation
 *
 * Phase 2C-B: read-only broker enforcement simulation endpoint.
 *
 * Evaluates all active InternalLockEvents (clearedAt IS NULL) and determines
 * what broker action *would* be attempted for each, without calling Tradovate
 * or writing any DB row. Returns structured simulation candidates for audit.
 *
 * Safety:
 *   - Read-only — never writes any DB row
 *   - No broker writes — no Tradovate API calls of any kind
 *   - Auth: authenticated session + x-cron-secret always required
 *   - Gated on BROKER_ENFORCEMENT_SIMULATION_ENABLED=true (default false)
 *   - Only returns rows owned by the current user (userId filter)
 *   - Live accounts always skipped regardless of other flags
 *   - BROKER_ENFORCEMENT_ENABLED must remain false/absent
 *
 * Response fields per candidate:
 *   - accountId, internalLockEventId, ruleType
 *   - brokerEligible: true only for daily_loss_limit with full_access + demo
 *   - wouldBrokerActionType: Tradovate endpoint name, or null
 *   - skipReason: human-readable reason for ineligibility, or null
 *   - listenerBrokerDedupKey: idempotency key that would guard the write
 *   - simulatedPayloadPreview: payload shape, no secrets, simulationOnly=true
 *   - brokerActionTaken: always false
 *   - simulationOnly: always true
 *
 * Query params:
 *   - accountId: filter to a specific ConnectedAccount.id (optional)
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { simulateBrokerEnforcement } from "@/lib/guardian-engine/broker-enforcement-simulation";

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

  if (process.env.BROKER_ENFORCEMENT_SIMULATION_ENABLED !== "true") {
    return NextResponse.json(
      {
        note: "Simulation disabled — set BROKER_ENFORCEMENT_SIMULATION_ENABLED=true to enable.",
        simulationEnabled: false,
        candidates: [],
      },
      { status: 200 },
    );
  }

  const sp = request.nextUrl.searchParams;
  const accountIdFilter = sp.get("accountId") ?? undefined;

  const activeLocks = await prisma.internalLockEvent.findMany({
    where: {
      userId: currentUser.id,
      clearedAt: null,
      ...(accountIdFilter ? { accountId: accountIdFilter } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      accountId: true,
      ruleType: true,
      tradingDay: true,
      observedAmount: true,
      account: {
        select: {
          label: true,
          externalAccountId: true,
          brokerConnection: {
            select: {
              env: true,
              connectionStatus: true,
              permissionLevel: true,
            },
          },
        },
      },
    },
  });

  const candidates = activeLocks.map((lock) => {
    const conn = lock.account.brokerConnection;
    return simulateBrokerEnforcement({
      accountId: lock.accountId,
      internalLockEventId: lock.id,
      ruleType: lock.ruleType,
      env: conn?.env ?? "live",
      connectionStatus: conn?.connectionStatus ?? null,
      permissionLevel: conn?.permissionLevel ?? null,
      externalAccountId: lock.account.externalAccountId,
      observedAmount: lock.observedAmount != null ? Number(lock.observedAmount) : null,
      tradingDay: lock.tradingDay,
    });
  });

  const eligible = candidates.filter((c) => c.brokerEligible);
  const skipped = candidates.filter((c) => !c.brokerEligible);

  return NextResponse.json({
    note: "Simulation only — no Tradovate request was sent. BROKER_ENFORCEMENT_ENABLED is not active.",
    simulationEnabled: true,
    brokerEnforcementEnabled: false,
    activeLockCount: activeLocks.length,
    eligibleCount: eligible.length,
    skippedCount: skipped.length,
    candidates,
  });
}
