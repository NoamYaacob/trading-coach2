/**
 * GET /api/debug/broker-lock-diagnostic/[accountId]
 *
 * Read-only diagnostic: given a Guardrail account id, returns the current
 * userAccountAutoLiq/deps record from Tradovate WITHOUT modifying anything.
 *
 * Use this to verify:
 *   - which Tradovate environment (demo vs live) will be used for a given account
 *   - the base URL hostname the client resolves to
 *   - what the current autoLiq record looks like (changesLocked, dailyLossAutoLiq)
 *   - that externalAccountId / masterid are correct
 *
 * No writes. No risk-setting changes. No order actions.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TradovateClient } from "@/lib/brokers/tradovate-client";
import { TradovateClientError } from "@/lib/brokers/tradovate-client-helpers";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> },
) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { accountId } = await params;

  const account = await prisma.connectedAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      label: true,
      platform: true,
      accountType: true,
      externalAccountId: true,
      isActive: true,
      missingFromBrokerSince: true,
      protectionStatus: true,
      brokerConnectionId: true,
      brokerConnection: {
        select: {
          id: true,
          env: true,
          connectionStatus: true,
          permissionLevel: true,
        },
      },
    },
  });

  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  // Only allow the authenticated user to probe their own accounts.
  const ownership = await prisma.connectedAccount.findFirst({
    where: { id: accountId, userId: currentUser.id },
    select: { id: true },
  });
  if (!ownership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const connectedAccountFields = {
    id: account.id,
    label: account.label,
    platform: account.platform,
    accountType: account.accountType,
    externalAccountId: account.externalAccountId,
    isActive: account.isActive,
    missingFromBrokerSince: account.missingFromBrokerSince?.toISOString() ?? null,
    protectionStatus: account.protectionStatus,
    brokerConnectionId: account.brokerConnectionId,
    brokerConnectionEnv: account.brokerConnection?.env ?? null,
    brokerConnectionStatus: account.brokerConnection?.connectionStatus ?? null,
    brokerConnectionPermissionLevel: account.brokerConnection?.permissionLevel ?? null,
  };

  // Env/accountType consistency check (same guard as applyManualBrokerLock).
  const bcEnv = account.brokerConnection?.env ?? null;
  const accountType = account.accountType ?? null;
  let envConsistency: "ok" | "mismatch_demo_account_live_connection" | "mismatch_live_account_demo_connection" | "unknown" = "unknown";
  if (bcEnv != null && accountType != null) {
    const accountIsDemo = accountType === "demo";
    const connectionIsDemo = bcEnv === "demo";
    if (accountIsDemo && !connectionIsDemo) {
      envConsistency = "mismatch_demo_account_live_connection";
    } else if (!accountIsDemo && connectionIsDemo) {
      envConsistency = "mismatch_live_account_demo_connection";
    } else {
      envConsistency = "ok";
    }
  }

  // Read-only Tradovate probe — no writes of any kind.
  let tradovateProbe:
    | {
        status: "ok";
        baseUrlHostname: string | null;
        tvMasterid: number | null;
        autoLiqRecords: unknown[];
        autoLiqRecordAccountIdInSchema: boolean;
        firstRecord: unknown | null;
      }
    | { status: "error"; code: string; message: string }
    | { status: "skipped"; reason: string } = { status: "skipped", reason: "not attempted" };

  if (account.isActive && account.missingFromBrokerSince == null && account.externalAccountId != null) {
    try {
      const client = new TradovateClient(account.id, currentUser.id);
      await client.initialize();
      const records = await client.getUserAccountAutoLiq();

      // Derive hostname for display (the client doesn't expose #baseUrl directly;
      // we can infer it from BrokerConnection.env and the known env config).
      const { getTradovateConfig } = await import("@/lib/brokers/tradovate-env");
      const cfgStatus = getTradovateConfig();
      const baseUrl = cfgStatus.state === "ready"
        ? cfgStatus.config.apiBaseUrl[bcEnv as "demo" | "live" ?? "demo"]
        : null;
      const baseUrlHostname = baseUrl
        ? (() => { try { return new URL(baseUrl).hostname; } catch { return baseUrl; } })()
        : null;

      const tvMasterid = account.externalAccountId ? parseInt(account.externalAccountId, 10) : null;

      tradovateProbe = {
        status: "ok",
        baseUrlHostname,
        tvMasterid,
        autoLiqRecords: records,
        autoLiqRecordAccountIdInSchema: records.length > 0 && "accountId" in (records[0] as object),
        firstRecord: records[0] ?? null,
      };
    } catch (err) {
      const code = err instanceof TradovateClientError ? err.code : "UNKNOWN";
      tradovateProbe = {
        status: "error",
        code,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  } else {
    tradovateProbe = {
      status: "skipped",
      reason: account.externalAccountId == null
        ? "externalAccountId is null — no masterid to query"
        : !account.isActive
          ? "account is inactive (archived)"
          : "account is missing from broker",
    };
  }

  return NextResponse.json({
    connectedAccount: connectedAccountFields,
    envConsistency,
    tradovateProbe,
    note: "Read-only diagnostic. No Tradovate writes were made.",
  });
}
