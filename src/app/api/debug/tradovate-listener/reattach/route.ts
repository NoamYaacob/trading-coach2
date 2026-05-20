import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/debug/tradovate-listener/reattach
 *
 * Executes or previews reattachment of ConnectedAccount rows whose
 * `brokerConnectionId` FK points to a stale/unhealthy BrokerConnection.
 *
 * Query parameters:
 *   apply      (default: false) — "true" to execute updates; anything else is dry-run
 *   confidence (default: "high") — minimum confidence level: "high" | "medium" | "low"
 *
 * Default behaviour (no params): dry-run, high-confidence only.
 * Only `apply=true&confidence=high` will write. Medium and low confidence
 * rows are never touched unless explicitly requested.
 *
 * In apply mode the only mutation is:
 *   ConnectedAccount.brokerConnectionId → targetBrokerConnectionId
 * No BrokerConnection rows are deleted or modified.
 * No token fields are read, decrypted, or written.
 * No enforcement columns (riskState, etc.) are touched.
 *
 * Security:
 *   - Requires authenticated session (401 otherwise).
 *   - Always requires x-cron-secret header matching CRON_SECRET (not just production),
 *     because apply mode writes to the database.
 *   - Only operates on connections owned by the current user.
 *   - Never reads, decrypts, or returns token fields.
 *   - Never uses a live connection as a reattach target unless
 *     TRADOVATE_LISTENER_ENABLE_LIVE=true.
 */
export async function GET(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // CRON_SECRET required in all environments — not just production — because
  // apply mode writes to the database and must not be accessible without the secret.
  const secret = request.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const applyMode = sp.get("apply") === "true";
  const confidenceParam = sp.get("confidence") ?? "high";

  if (!["high", "medium", "low"].includes(confidenceParam)) {
    return NextResponse.json(
      { error: 'invalid confidence parameter; must be "high", "medium", or "low"' },
      { status: 400 },
    );
  }

  // Build the accepted confidence set — default is high-only.
  // Medium/low require explicit opt-in via the confidence param.
  const acceptedConfidence = new Set<"high" | "medium" | "low">(["high"]);
  if (confidenceParam === "medium") acceptedConfidence.add("medium");
  if (confidenceParam === "low") {
    acceptedConfidence.add("medium");
    acceptedConfidence.add("low");
  }

  const enableLive = process.env.TRADOVATE_LISTENER_ENABLE_LIVE === "true";
  const now = Date.now();

  // ── Load broker connections ────────────────────────────────────────────────
  const brokerConnections = await prisma.brokerConnection.findMany({
    where: { userId: currentUser.id, platform: "tradovate" },
    select: {
      id: true,
      env: true,
      brokerUserId: true,
      connectionStatus: true,
      listenerStatus: true,
      tokenExpiresAt: true,
      lastRenewError: true,
      createdAt: true,
      _count: { select: { accounts: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // ── Load accounts with a broker connection FK ──────────────────────────────
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
      brokerConnectionId: true,
      brokerConnection: {
        select: {
          id: true,
          env: true,
          brokerUserId: true,
          connectionStatus: true,
          listenerStatus: true,
          tokenExpiresAt: true,
          lastRenewError: true,
          createdAt: true,
        },
      },
    },
  });

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

  const whyStale = (c: {
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

  // ── Index healthy connections ──────────────────────────────────────────────
  const healthyByEnvAndBrokerUserId = new Map<string, typeof brokerConnections>();
  const healthyByEnv = new Map<string, typeof brokerConnections>();

  for (const bc of brokerConnections) {
    if (!isHealthy(bc)) continue;
    if (!healthyByEnv.has(bc.env)) healthyByEnv.set(bc.env, []);
    healthyByEnv.get(bc.env)!.push(bc);
    if (bc.brokerUserId) {
      const key = `${bc.env}::${bc.brokerUserId}`;
      if (!healthyByEnvAndBrokerUserId.has(key)) healthyByEnvAndBrokerUserId.set(key, []);
      healthyByEnvAndBrokerUserId.get(key)!.push(bc);
    }
  }

  // ── Build recommendations ──────────────────────────────────────────────────
  type Rec = {
    accountId: string;
    accountLabel: string;
    externalAccountId: string | null;
    currentBrokerConnectionId: string;
    currentConnectionStatus: string;
    staleReason: string;
    targetBrokerConnectionId: string;
    targetEnv: string;
    targetConnectionStatus: string;
    targetAccountCount: number;
    confidence: "high" | "medium" | "low";
    confidenceReason: string;
  };

  const allRecs: Rec[] = [];

  for (const acct of connectedAccounts) {
    const current = acct.brokerConnection;
    if (!current) continue;
    if (isHealthy(current)) continue;

    const brokerUserId = current.brokerUserId;
    let target: (typeof brokerConnections)[0] | null = null;
    let confidence: "high" | "medium" | "low" = "low";
    let confidenceReason = "";

    if (brokerUserId) {
      const key = `${current.env}::${brokerUserId}`;
      const best = (healthyByEnvAndBrokerUserId.get(key) ?? []).find((c) => c.id !== current.id) ?? null;
      if (best) {
        target = best;
        confidence = "high";
        confidenceReason = `same env="${current.env}" + brokerUserId="${brokerUserId}"`;
      }
    }

    if (!target) {
      const candidates = (healthyByEnv.get(current.env) ?? []).filter((c) => c.id !== current.id);
      if (candidates.length === 1) {
        target = candidates[0]!;
        confidence = "medium";
        confidenceReason = `same env="${current.env}" only (brokerUserId not matched)`;
      } else if (candidates.length > 1) {
        target = candidates[0]!;
        confidence = "low";
        confidenceReason = `same env="${current.env}" but ${candidates.length} candidates; manual review required`;
      }
    }

    if (!target) continue;

    allRecs.push({
      accountId: acct.id,
      accountLabel: acct.label,
      externalAccountId: acct.externalAccountId ?? null,
      currentBrokerConnectionId: current.id,
      currentConnectionStatus: current.connectionStatus,
      staleReason: whyStale(current),
      targetBrokerConnectionId: target.id,
      targetEnv: target.env,
      targetConnectionStatus: target.connectionStatus,
      targetAccountCount: target._count.accounts,
      confidence,
      confidenceReason,
    });
  }

  // ── Filter by confidence ───────────────────────────────────────────────────
  const confidenceFiltered = allRecs.filter((r) => acceptedConfidence.has(r.confidence));
  const skippedByConfidence = allRecs.filter((r) => !acceptedConfidence.has(r.confidence));

  // ── Live safety guard ──────────────────────────────────────────────────────
  // Never use a live BrokerConnection as a reattach target unless the live
  // listener flag is explicitly enabled. Live accounts carry real money.
  const skippedLiveGuard = !enableLive
    ? confidenceFiltered.filter((r) => r.targetEnv === "live")
    : [];
  const eligible = !enableLive
    ? confidenceFiltered.filter((r) => r.targetEnv !== "live")
    : confidenceFiltered;

  // ── Apply mode ─────────────────────────────────────────────────────────────
  if (applyMode) {
    const applied: Array<{
      accountId: string;
      accountLabel: string;
      fromConnectionId: string;
      toConnectionId: string;
      confidence: string;
    }> = [];

    for (const rec of eligible) {
      await prisma.connectedAccount.update({
        where: { id: rec.accountId },
        data: { brokerConnectionId: rec.targetBrokerConnectionId },
      });
      applied.push({
        accountId: rec.accountId,
        accountLabel: rec.accountLabel,
        fromConnectionId: rec.currentBrokerConnectionId,
        toConnectionId: rec.targetBrokerConnectionId,
        confidence: rec.confidence,
      });
    }

    return NextResponse.json({
      ok: true,
      mode: "apply",
      params: { apply: true, confidence: confidenceParam },
      summary: {
        applied: applied.length,
        skippedByConfidence: skippedByConfidence.length,
        skippedLiveGuard: skippedLiveGuard.length,
      },
      applied,
      skippedByConfidence,
      skippedLiveGuard,
    });
  }

  // ── Dry-run mode ───────────────────────────────────────────────────────────
  const dryRunPreview = eligible.map((r) => ({
    accountId: r.accountId,
    accountLabel: r.accountLabel,
    confidence: r.confidence,
    prismaCall: `prisma.connectedAccount.update({ where: { id: "${r.accountId}" }, data: { brokerConnectionId: "${r.targetBrokerConnectionId}" } })`,
  }));

  return NextResponse.json({
    ok: true,
    mode: "dry_run",
    params: { apply: false, confidence: confidenceParam },
    summary: {
      wouldApply: eligible.length,
      skippedByConfidence: skippedByConfidence.length,
      skippedLiveGuard: skippedLiveGuard.length,
    },
    wouldApply: eligible,
    skippedByConfidence,
    skippedLiveGuard,
    dryRunPreview,
  });
}
