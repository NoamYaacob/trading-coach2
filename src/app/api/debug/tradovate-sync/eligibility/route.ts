/**
 * GET /api/debug/tradovate-sync/eligibility
 *
 * Read-only diagnostic: explains exactly why /api/cron/tradovate-sync synced
 * 0 connections, and whether each account is eligible, stale, or skipped.
 *
 * Safety:
 *   - Read-only — never writes any DB row
 *   - No sync is triggered from this endpoint
 *   - No enforcement, no broker writes, no riskState mutations
 *   - Auth: x-cron-secret always required
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import {
  deriveAccountEligibility,
  deriveConnectionEligibility,
  CRON_ELIGIBLE_CONNECTION_STATUSES,
  CRON_FRESHNESS_THRESHOLD_MS,
  type AccountEligibilityInput,
  type AccountEligibilitySummary,
} from "@/lib/brokers/tradovate-sync-eligibility-helpers";

export async function GET(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const now = new Date();

  // Load all Tradovate connections with their accounts and session states.
  // We deliberately include ALL connections (not just cron-eligible ones) so
  // the response explains why excluded connections are excluded.
  const connections = await prisma.brokerConnection.findMany({
    where: { platform: "tradovate" },
    select: {
      id: true,
      env: true,
      connectionStatus: true,
      listenerStatus: true,
      brokerUserId: true,
      accounts: {
        select: {
          id: true,
          label: true,
          externalAccountId: true,
          isActive: true,
          protectionStatus: true,
          brokerConnectionId: true,
          errorMessage: true,
          lastSyncAt: true,
          missingFromBrokerSince: true,
          sessionState: {
            select: {
              sessionDate: true,
              tradesCount: true,
              tradeCountSource: true,
              dailyPnl: true,
              consecutiveLosses: true,
              updatedAt: true,
            },
          },
        },
        orderBy: { label: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const connectionStatusEligible = (status: string) =>
    (CRON_ELIGIBLE_CONNECTION_STATUSES as readonly string[]).includes(status);

  let cronEligibleConnections = 0;
  let staleConnectionsCount = 0;
  let skippedConnectionsCount = 0;

  const connectionViews = connections.map((conn) => {
    const connEligible = connectionStatusEligible(conn.connectionStatus);

    const accountViews = conn.accounts.map((account) => {
      const session = account.sessionState;
      const eligInput: AccountEligibilityInput = {
        accountId: account.id,
        label: account.label,
        externalAccountId: account.externalAccountId,
        isActive: account.isActive,
        protectionStatus: account.protectionStatus,
        errorMessage: account.errorMessage,
        lastSyncAt: account.lastSyncAt,
        missingFromBrokerSince: account.missingFromBrokerSince,
        sessionUpdatedAt: session?.updatedAt ?? null,
        connectionStatusEligible: connEligible,
        now,
        freshnessThresholdMs: CRON_FRESHNESS_THRESHOLD_MS,
      };
      const elig = deriveAccountEligibility(eligInput);

      return {
        accountId: account.id,
        label: account.label,
        externalAccountId: account.externalAccountId,
        isActive: account.isActive,
        protectionStatus: account.protectionStatus,
        brokerConnectionId: account.brokerConnectionId,
        errorMessage: account.errorMessage,
        lastSyncAt: account.lastSyncAt,
        lastSyncAgeMs: elig.lastSyncAgeMs,
        sessionUpdatedAt: session?.updatedAt ?? null,
        sessionDate: session?.sessionDate ?? null,
        tradesCount: session?.tradesCount ?? null,
        tradeCountSource: session?.tradeCountSource ?? null,
        dailyPnl: session?.dailyPnl != null ? Number(session.dailyPnl) : null,
        consecutiveLosses: session?.consecutiveLosses ?? null,
        missingFromBrokerSince: account.missingFromBrokerSince,
        wouldSync: elig.wouldSync,
        skipReason: elig.skipReason,
        partialSyncSuspected: elig.partialSyncSuspected,
      };
    });

    const accountEligResults: AccountEligibilitySummary[] = accountViews.map((a) => ({
      wouldSync: a.wouldSync,
      skipReason: a.skipReason,
    }));

    const connElig = deriveConnectionEligibility({
      connectionStatus: conn.connectionStatus,
      accountResults: accountEligResults,
    });

    if (connElig.matchesCronFilter) {
      cronEligibleConnections++;
      if (connElig.wouldSync) {
        staleConnectionsCount++;
      } else {
        skippedConnectionsCount++;
      }
    } else {
      skippedConnectionsCount++;
    }

    return {
      connectionId: conn.id,
      env: conn.env,
      connectionStatus: conn.connectionStatus,
      listenerStatus: conn.listenerStatus ?? null,
      brokerUserId: conn.brokerUserId ?? null,
      matchesCronFilter: connElig.matchesCronFilter,
      connectionSkipReason: connElig.connectionSkipReason,
      accountCount: conn.accounts.length,
      eligibleAccountCount: connElig.eligibleAccountCount,
      staleAccountCount: connElig.staleAccountCount,
      wouldSync: connElig.wouldSync,
      accounts: accountViews,
    };
  });

  return NextResponse.json({
    note: "Read-only sync eligibility diagnostic — no sync was triggered.",
    ok: true,
    now,
    freshnessThresholdMs: CRON_FRESHNESS_THRESHOLD_MS,
    totalConnections: connections.length,
    cronEligibleConnections,
    staleConnections: staleConnectionsCount,
    skippedConnections: skippedConnectionsCount,
    connections: connectionViews,
  });
}
