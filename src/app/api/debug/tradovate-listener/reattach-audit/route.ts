import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/debug/tradovate-listener/reattach-audit
 *
 * Read-only audit of ConnectedAccount rows whose `brokerConnectionId` FK
 * points to a stale/unhealthy BrokerConnection when a healthier alternative
 * exists for the same user + env + brokerUserId.
 *
 * Nothing is written. The response includes a `dryRunPreview` section that
 * prints the exact Prisma `update` calls that *would* reattach each account —
 * operators copy-paste them into a verified migration script after review.
 *
 * Confidence levels:
 *   high   — same userId + env + brokerUserId match on a healthy connection
 *   medium — same userId + env only (brokerUserId null/missing on one side)
 *   low    — same userId + env, but multiple candidates; manual review needed
 *
 * Security:
 *   - Requires authenticated session (401 otherwise).
 *   - In production requires `x-cron-secret` header matching CRON_SECRET env var.
 *   - Only returns rows owned by the current user.
 *   - Never reads, decrypts, or returns token fields.
 */
export async function GET(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (process.env.NODE_ENV === "production") {
    const secret = request.headers.get("x-cron-secret");
    const expected = process.env.CRON_SECRET;
    if (!expected || secret !== expected) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  // ── Load all Tradovate BrokerConnections for the user ──────────────────────
  const brokerConnections = await prisma.brokerConnection.findMany({
    where: { userId: currentUser.id, platform: "tradovate" },
    select: {
      id: true,
      env: true,
      brokerUserId: true,
      connectionStatus: true,
      listenerStatus: true,
      listenerLastHeartbeatAt: true,
      tokenExpiresAt: true,
      lastRenewError: true,
      createdAt: true,
      _count: { select: { accounts: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // ── Load all ConnectedAccounts linked to those connections ─────────────────
  const connectedAccounts = await prisma.connectedAccount.findMany({
    where: {
      userId: currentUser.id,
      platform: "tradovate",
      brokerConnectionId: { not: null },
    },
    select: {
      id: true,
      label: true,
      externalAccountId: true,
      propFirm: true,
      connectionStatus: true,
      brokerConnectionId: true,
      brokerConnection: {
        select: {
          id: true,
          env: true,
          brokerUserId: true,
          connectionStatus: true,
          listenerStatus: true,
          listenerLastHeartbeatAt: true,
          tokenExpiresAt: true,
          lastRenewError: true,
          createdAt: true,
        },
      },
    },
  });

  const now = Date.now();

  // ── Helpers ────────────────────────────────────────────────────────────────
  const isHealthy = (c: {
    connectionStatus: string;
    listenerStatus: string | null;
    tokenExpiresAt: Date | null;
    lastRenewError: string | null;
  }): boolean => {
    if (c.connectionStatus === "expired") return false;
    if (c.connectionStatus === "connection_error") return false;
    if (c.lastRenewError !== null) return false;
    if (c.tokenExpiresAt !== null && c.tokenExpiresAt.getTime() < now) return false;
    if (c.listenerStatus === "error") return false;
    return true;
  };

  const isStale = (c: {
    connectionStatus: string;
    listenerStatus: string | null;
    tokenExpiresAt: Date | null;
    lastRenewError: string | null;
  }): boolean => !isHealthy(c);

  const staleReason = (c: {
    connectionStatus: string;
    listenerStatus: string | null;
    tokenExpiresAt: Date | null;
    lastRenewError: string | null;
  }): string => {
    if (c.connectionStatus === "expired") return "connectionStatus=expired";
    if (c.connectionStatus === "connection_error") return "connectionStatus=connection_error";
    if (c.lastRenewError !== null) return `lastRenewError="${c.lastRenewError}"`;
    if (c.tokenExpiresAt !== null && c.tokenExpiresAt.getTime() < now) return "tokenExpired";
    if (c.listenerStatus === "error") return "listenerStatus=error";
    return "unknown";
  };

  // ── Find reattach candidates ───────────────────────────────────────────────
  // Index healthy broker connections by env and brokerUserId for fast lookup.
  const healthyByEnvAndBrokerUserId = new Map<string, typeof brokerConnections>();
  const healthyByEnv = new Map<string, typeof brokerConnections>();

  for (const bc of brokerConnections) {
    if (!isHealthy(bc)) continue;
    const env = bc.env;
    if (!healthyByEnv.has(env)) healthyByEnv.set(env, []);
    healthyByEnv.get(env)!.push(bc);

    if (bc.brokerUserId) {
      const key = `${env}::${bc.brokerUserId}`;
      if (!healthyByEnvAndBrokerUserId.has(key)) healthyByEnvAndBrokerUserId.set(key, []);
      healthyByEnvAndBrokerUserId.get(key)!.push(bc);
    }
  }

  type Recommendation = {
    accountId: string;
    accountLabel: string;
    externalAccountId: string | null;
    propFirm: string | null;
    currentBrokerConnectionId: string;
    currentConnectionStatus: string;
    currentListenerStatus: string | null;
    currentAccountCount: number;
    currentCreatedAt: string;
    staleReason: string;
    targetBrokerConnectionId: string;
    targetConnectionStatus: string;
    targetListenerStatus: string | null;
    targetAccountCount: number;
    targetCreatedAt: string;
    confidence: "high" | "medium" | "low";
    confidenceReason: string;
  };

  const recommendations: Recommendation[] = [];

  for (const acct of connectedAccounts) {
    const current = acct.brokerConnection;
    if (!current) continue;
    if (!isStale(current)) continue;

    const env = current.env;
    const brokerUserId = current.brokerUserId;

    // Look for the best target connection
    let target: (typeof brokerConnections)[0] | null = null;
    let confidence: "high" | "medium" | "low" = "low";
    let confidenceReason = "";

    if (brokerUserId) {
      const key = `${env}::${brokerUserId}`;
      const candidates = healthyByEnvAndBrokerUserId.get(key) ?? [];
      // Prefer most recently created healthy connection
      const best = candidates.find((c) => c.id !== current.id) ?? null;
      if (best) {
        target = best;
        confidence = "high";
        confidenceReason = `same env="${env}" + brokerUserId="${brokerUserId}"`;
      }
    }

    if (!target) {
      const candidates = (healthyByEnv.get(env) ?? []).filter((c) => c.id !== current.id);
      if (candidates.length === 1) {
        target = candidates[0]!;
        confidence = "medium";
        confidenceReason = `same env="${env}" only (brokerUserId not matched)`;
      } else if (candidates.length > 1) {
        // Multiple candidates — pick newest but flag as low confidence
        target = candidates[0]!;
        confidence = "low";
        confidenceReason = `same env="${env}" but ${candidates.length} candidates; manual review required`;
      }
    }

    if (!target) continue;

    const currentBcFull = brokerConnections.find((b) => b.id === current.id);
    const currentAccountCount = currentBcFull?._count.accounts ?? 0;
    const targetAccountCount = target._count.accounts;

    recommendations.push({
      accountId: acct.id,
      accountLabel: acct.label,
      externalAccountId: acct.externalAccountId ?? null,
      propFirm: acct.propFirm ?? null,
      currentBrokerConnectionId: current.id,
      currentConnectionStatus: current.connectionStatus,
      currentListenerStatus: current.listenerStatus,
      currentAccountCount,
      currentCreatedAt: current.createdAt.toISOString(),
      staleReason: staleReason(current),
      targetBrokerConnectionId: target.id,
      targetConnectionStatus: target.connectionStatus,
      targetListenerStatus: target.listenerStatus,
      targetAccountCount,
      targetCreatedAt: target.createdAt.toISOString(),
      confidence,
      confidenceReason,
    });
  }

  // Sort: high confidence first, then medium, then low
  const confidenceOrder = { high: 0, medium: 1, low: 2 };
  recommendations.sort(
    (a, b) => confidenceOrder[a.confidence] - confidenceOrder[b.confidence],
  );

  // ── Dry-run preview ────────────────────────────────────────────────────────
  // Print the Prisma update calls that would reattach each account.
  // These are strings only — nothing is executed.
  const dryRunPreview = recommendations.map((r) => ({
    accountId: r.accountId,
    accountLabel: r.accountLabel,
    confidence: r.confidence,
    prismaCall: `prisma.connectedAccount.update({ where: { id: "${r.accountId}" }, data: { brokerConnectionId: "${r.targetBrokerConnectionId}" } })`,
  }));

  // ── Connections summary ────────────────────────────────────────────────────
  const connectionsSummary = brokerConnections.map((bc) => ({
    connectionId: bc.id,
    env: bc.env,
    brokerUserId: bc.brokerUserId,
    connectionStatus: bc.connectionStatus,
    listenerStatus: bc.listenerStatus,
    accountCount: bc._count.accounts,
    healthy: isHealthy(bc),
    createdAt: bc.createdAt.toISOString(),
  }));

  return NextResponse.json({
    ok: true,
    mode: "read_only_audit",
    summary: {
      totalConnections: brokerConnections.length,
      healthyConnections: brokerConnections.filter(isHealthy).length,
      staleConnections: brokerConnections.filter(isStale).length,
      accountsChecked: connectedAccounts.length,
      accountsNeedingReattach: recommendations.length,
      highConfidence: recommendations.filter((r) => r.confidence === "high").length,
      mediumConfidence: recommendations.filter((r) => r.confidence === "medium").length,
      lowConfidence: recommendations.filter((r) => r.confidence === "low").length,
    },
    recommendations,
    dryRunPreview,
    connections: connectionsSummary,
  });
}
