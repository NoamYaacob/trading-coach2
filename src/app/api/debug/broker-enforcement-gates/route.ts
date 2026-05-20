/**
 * GET /api/debug/broker-enforcement-gates
 *
 * Phase 2C-C read-only diagnostic endpoint.
 *
 * Shows the state of all 10 broker enforcement gates for every active
 * InternalLockEvent owned by the current user. Does not write anything.
 * Useful for confirming that all prerequisites are in place before enabling
 * BROKER_ENFORCEMENT_ENABLED=true.
 *
 * Safety:
 *   - Read-only — no writes of any kind
 *   - No broker calls, no Tradovate API requests
 *   - Auth: authenticated session + x-cron-secret header
 *   - Only reads rows owned by the current user
 *
 * Response fields:
 *   brokerEnforcementEnabled  — current process.env value (must be false in prod)
 *   listenerLiveEnabled       — TRADOVATE_LISTENER_ENABLE_LIVE flag value
 *   allowlist                 — parsed BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST
 *   activeLockCount           — total active InternalLockEvents for this user
 *   eligibleCount             — locks that pass all gates
 *   skippedCount              — locks blocked by at least one gate
 *   candidates[]              — per-lock gate evaluation details
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  evaluateBrokerEnforcementGates,
  parseBrokerEnforcementAllowlist,
} from "@/lib/guardian-engine/broker-enforcement-gate";
import { buildListenerBrokerDedupKey } from "@/lib/guardian-engine/broker-enforcement-dedup";

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

  // ── Resolve env vars ──────────────────────────────────────────────────────
  const brokerEnforcementEnabled = process.env.BROKER_ENFORCEMENT_ENABLED === "true";
  const listenerLiveEnabled = process.env.TRADOVATE_LISTENER_ENABLE_LIVE === "true";
  const allowlist = parseBrokerEnforcementAllowlist(
    process.env.BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST,
  );

  // ── Load all active InternalLockEvents for this user ─────────────────────
  const activeLocks = await prisma.internalLockEvent.findMany({
    where: {
      userId: currentUser.id,
      clearedAt: null,
    },
    select: {
      id: true,
      accountId: true,
      ruleType: true,
      tradingDay: true,
      observedAmount: true,
      createdAt: true,
      account: {
        select: {
          isActive: true,
          missingFromBrokerSince: true,
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
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // ── Batch dedup key existence check ──────────────────────────────────────
  const dedupKeys = activeLocks.map((lock) =>
    buildListenerBrokerDedupKey(lock.accountId, lock.ruleType, lock.tradingDay),
  );

  const existingInterventions = await prisma.guardianIntervention.findMany({
    where: {
      listenerBrokerDedupKey: { in: dedupKeys },
    },
    select: { listenerBrokerDedupKey: true },
  });
  const existingDedupKeySet = new Set(
    existingInterventions.map((i) => i.listenerBrokerDedupKey).filter(Boolean),
  );

  // ── Evaluate gates for each lock ──────────────────────────────────────────
  const candidates = activeLocks.map((lock) => {
    const conn = lock.account.brokerConnection;
    const dedupKey = buildListenerBrokerDedupKey(
      lock.accountId,
      lock.ruleType,
      lock.tradingDay,
    );

    const gateResult = evaluateBrokerEnforcementGates({
      brokerEnforcementEnabled,
      listenerLiveEnabled,
      allowlistAccountIds: allowlist,
      accountId: lock.accountId,
      env: conn?.env ?? "live",
      isActive: lock.account.isActive,
      missingFromBroker: lock.account.missingFromBrokerSince != null,
      connectionStatus: conn?.connectionStatus ?? null,
      permissionLevel: conn?.permissionLevel ?? null,
      activeInternalLockEventId: lock.id,
      ruleType: lock.ruleType,
      observedAmount: lock.observedAmount != null ? Number(lock.observedAmount) : null,
      tradingDay: lock.tradingDay,
      existingInterventionWithDedupKey: existingDedupKeySet.has(dedupKey),
    });

    return {
      internalLockEventId: lock.id,
      accountId: lock.accountId,
      ruleType: lock.ruleType,
      tradingDay: lock.tradingDay,
      observedAmount: lock.observedAmount != null ? Number(lock.observedAmount) : null,
      env: conn?.env ?? null,
      connectionStatus: conn?.connectionStatus ?? null,
      permissionLevel: conn?.permissionLevel ?? null,
      isActive: lock.account.isActive,
      missingFromBroker: lock.account.missingFromBrokerSince != null,
      inAllowlist: allowlist.includes(lock.accountId),
      existingInterventionWithDedupKey: existingDedupKeySet.has(dedupKey),
      gateResult: {
        allowed: gateResult.allowed,
        skipReason: gateResult.skipReason,
        dedupKey: gateResult.dedupKey,
        brokerActionType: gateResult.brokerActionType,
        payloadPreview: gateResult.payloadPreview,
      },
    };
  });

  const eligibleCount = candidates.filter((c) => c.gateResult.allowed).length;
  const skippedCount = candidates.length - eligibleCount;

  return NextResponse.json({
    note: "Read-only diagnostic — no writes, no broker calls.",
    brokerEnforcementEnabled,
    listenerLiveEnabled,
    allowlist,
    activeLockCount: candidates.length,
    eligibleCount,
    skippedCount,
    candidates,
  });
}
