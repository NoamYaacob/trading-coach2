/**
 * GET /api/debug/connected-accounts
 *
 * Read-only diagnostic endpoint. Lists the current user's connected accounts
 * with all fields needed to identify which account to pass to the daily-loss
 * recovery probe (`/api/debug/broker-enforcement/daily-loss-recovery-probe`).
 *
 * Safety:
 *   - Read-only — never writes any DB row, never mutates anything
 *   - No broker calls, no TradovateClient import, no Tradovate API requests
 *   - Auth: authenticated session + x-cron-secret header
 *   - User-scoped: only returns accounts owned by the current session user
 *   - No secret values returned (no tokens, no encrypted fields)
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseTradovateMasterId } from "@/lib/brokers/tradovate-master-id";

/** BrokerConnection.connectionStatus values that prevent broker writes. */
const NON_LIVE_CONNECTION_STATUSES = new Set([
  "expired",
  "connection_error",
  "not_connected",
  "pending_webhook",
  "oauth_pending_storage",
]);

function deriveCanUseForRecoveryProbePreview(account: {
  platform: string;
  isActive: boolean;
  missingFromBrokerSince: Date | null;
  externalAccountId: string | null;
  brokerConnection: {
    env: string;
    connectionStatus: string;
    permissionLevel: string | null;
  } | null;
}): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (account.platform !== "tradovate") {
    reasons.push("platform is not tradovate");
  }
  if (account.brokerConnection == null) {
    reasons.push("no broker connection");
  } else {
    if (account.brokerConnection.env !== "demo") {
      reasons.push("connection env is not demo");
    }
    const connStatus = account.brokerConnection.connectionStatus;
    if (NON_LIVE_CONNECTION_STATUSES.has(connStatus)) {
      reasons.push(`connection status '${connStatus}' is not live`);
    }
    if (account.brokerConnection.permissionLevel !== "full_access") {
      reasons.push(
        `permissionLevel is '${account.brokerConnection.permissionLevel ?? "null"}', expected full_access`,
      );
    }
  }
  if (!account.isActive) {
    reasons.push("account is not active");
  }
  if (account.missingFromBrokerSince != null) {
    reasons.push("missingFromBrokerSince is set (account missing from broker)");
  }
  if (parseTradovateMasterId(account.externalAccountId ?? null) === null) {
    reasons.push(
      `externalAccountId '${account.externalAccountId ?? "null"}' is not a valid Tradovate masterid`,
    );
  }

  return { eligible: reasons.length === 0, reasons };
}

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

  const accounts = await prisma.connectedAccount.findMany({
    where: { userId: currentUser.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      label: true,
      externalAccountId: true,
      platform: true,
      propFirm: true,
      accountType: true,
      isActive: true,
      connectionStatus: true,
      brokerConnectionId: true,
      lastSyncAt: true,
      missingFromBrokerSince: true,
      brokerConnection: {
        select: {
          env: true,
          connectionStatus: true,
          permissionLevel: true,
        },
      },
      riskRules: {
        select: {
          maxDailyLoss: true,
          maxContracts: true,
          maxContractsBySymbolJson: true,
        },
      },
    },
  });

  const result = accounts.map((account) => {
    const { eligible, reasons } = deriveCanUseForRecoveryProbePreview({
      platform: account.platform,
      isActive: account.isActive,
      missingFromBrokerSince: account.missingFromBrokerSince,
      externalAccountId: account.externalAccountId,
      brokerConnection: account.brokerConnection,
    });

    return {
      id: account.id,
      label: account.label,
      externalAccountId: account.externalAccountId,
      platform: account.platform,
      propFirm: account.propFirm,
      accountType: account.accountType,
      env: account.brokerConnection?.env ?? null,
      connectionStatus: account.connectionStatus,
      brokerConnectionStatus: account.brokerConnection?.connectionStatus ?? null,
      permissionLevel: account.brokerConnection?.permissionLevel ?? null,
      brokerConnectionId: account.brokerConnectionId,
      isActive: account.isActive,
      missingFromBrokerSince: account.missingFromBrokerSince?.toISOString() ?? null,
      lastSyncAt: account.lastSyncAt?.toISOString() ?? null,
      hasAccountRiskRules: account.riskRules != null,
      maxDailyLoss: account.riskRules?.maxDailyLoss?.toString() ?? null,
      maxContracts: account.riskRules?.maxContracts ?? null,
      maxContractsBySymbolJson: account.riskRules?.maxContractsBySymbolJson ?? null,
      canUseForRecoveryProbePreview: eligible,
      reasons: eligible ? [] : reasons,
    };
  });

  return NextResponse.json({
    ok: true,
    note: "Read-only diagnostic — no writes, no broker calls.",
    count: result.length,
    accounts: result,
  });
}
