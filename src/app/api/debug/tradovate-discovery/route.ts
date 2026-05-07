import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseAndDecrypt } from "@/lib/security/token-crypto";
import {
  fetchTradovateAccountList,
  decideReconciliation,
  type DiscoveredAccount,
  type LocalAccountForReconciliation,
} from "@/lib/brokers/tradovate-discovery";
import { getTradovateConfig } from "@/lib/brokers/tradovate-env";

/**
 * Diagnostic endpoint for investigating why newly-purchased broker accounts
 * don't surface in the "New broker account detected" dashboard panel.
 *
 * Usage:
 *   GET /api/debug/tradovate-discovery?connectionId=<brokerConnectionId>
 *
 * Returns a full trace of what /account/list returns, what the local DB has,
 * and what the reconciliation engine would create / flag missing — without
 * writing anything to the DB.
 *
 * Authentication: requires a valid session. The connectionId must belong to
 * the current user.
 */
export async function GET(request: Request) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const connectionId = searchParams.get("connectionId");
  if (!connectionId) {
    return NextResponse.json(
      { error: "connectionId query parameter required" },
      { status: 400 },
    );
  }

  // Load the connection — also verifies ownership.
  const connection = await prisma.brokerConnection.findFirst({
    where: { id: connectionId, userId: currentUser.id, platform: "tradovate" },
    select: {
      id: true,
      env: true,
      connectionStatus: true,
      accessTokenEncrypted: true,
      createdAt: true,
    },
  });

  if (!connection) {
    // List the user's connections so they can pick the right one.
    const available = await prisma.brokerConnection.findMany({
      where: { userId: currentUser.id, platform: "tradovate" },
      select: { id: true, env: true, connectionStatus: true, createdAt: true },
    });
    return NextResponse.json(
      {
        error: "connection not found or does not belong to current user",
        receivedConnectionId: connectionId,
        availableConnections: available,
      },
      { status: 404 },
    );
  }

  // ── Config check ─────────────────────────────────────────────────────────
  const cfg = getTradovateConfig();
  if (cfg.state !== "ready") {
    return NextResponse.json(
      {
        error: "Tradovate config not ready",
        configState: cfg.state,
        connectionId,
        env: connection.env,
      },
      { status: 503 },
    );
  }

  const env = connection.env as "live" | "demo";
  const baseUrl = cfg.config.apiBaseUrl[env];

  // ── Step 1: call /account/list ─────────────────────────────────────────
  let accessToken: string;
  try {
    accessToken = parseAndDecrypt(connection.accessTokenEncrypted);
  } catch (err) {
    return NextResponse.json(
      {
        error: "failed to decrypt access token",
        detail: err instanceof Error ? err.message : "unknown",
        connectionId,
        env,
      },
      { status: 500 },
    );
  }

  const discovered: DiscoveredAccount[] | null = await fetchTradovateAccountList(
    baseUrl,
    accessToken,
  );

  // ── Step 2: query local DB accounts ───────────────────────────────────
  const localRows = await prisma.connectedAccount.findMany({
    where: { userId: currentUser.id, platform: "tradovate" },
    select: {
      id: true,
      label: true,
      externalAccountId: true,
      brokerConnectionId: true,
      protectionStatus: true,
      missingFromBrokerSince: true,
      lastSeenInBrokerAt: true,
      isActive: true,
    },
    orderBy: { label: "asc" },
  });

  const localForReconciliation: LocalAccountForReconciliation[] = localRows.map((r) => ({
    id: r.id,
    externalAccountId: r.externalAccountId,
    brokerConnectionId: r.brokerConnectionId,
    protectionStatus: r.protectionStatus,
    missingFromBrokerSince: r.missingFromBrokerSince,
  }));

  // ── Step 3: dry-run reconciliation (no DB writes) ──────────────────────
  const decision =
    discovered != null
      ? decideReconciliation({
          brokerConnectionId: connectionId,
          discovered,
          localAccounts: localForReconciliation,
        })
      : null;

  // Compute skip reasons for broker accounts that are in /account/list but
  // would not create a new row (already exist, or are inactive).
  const skipped: Array<{
    externalAccountId: string;
    name: string;
    active: boolean;
    reason: string;
  }> = [];
  if (discovered != null) {
    const norm = (s: string) => s.trim().toLowerCase();
    for (const d of discovered) {
      const existing = localRows.find(
        (r) => r.externalAccountId != null && norm(r.externalAccountId) === norm(d.externalAccountId),
      );
      if (existing) {
        skipped.push({
          externalAccountId: d.externalAccountId,
          name: d.name,
          active: d.active,
          reason: `already_exists — protectionStatus=${existing.protectionStatus} label="${existing.label}"`,
        });
      } else if (!d.active) {
        skipped.push({
          externalAccountId: d.externalAccountId,
          name: d.name,
          active: d.active,
          reason: "inactive — broker returned active=false; new pending_decision rows are not created for inactive accounts",
        });
      }
    }
  }

  // Query pending_decision accounts specifically so it's easy to see what
  // would surface in the "New broker account detected" panel.
  const pendingRows = await prisma.connectedAccount.findMany({
    where: {
      userId: currentUser.id,
      platform: "tradovate",
      protectionStatus: "pending_decision",
    },
    select: {
      id: true,
      label: true,
      externalAccountId: true,
      brokerConnectionId: true,
      lastSeenInBrokerAt: true,
      isActive: true,
    },
    orderBy: { label: "asc" },
  });

  return NextResponse.json({
    ok: true,
    connectionId,
    env,
    connectionStatus: connection.connectionStatus,
    connectionCreatedAt: connection.createdAt,
    brokerApiBaseUrl: baseUrl,

    // /account/list result
    accountListFetchOk: discovered != null,
    accountListCount: discovered?.length ?? 0,
    accountList: discovered?.map((d) => ({
      externalAccountId: d.externalAccountId,
      name: d.name,
      accountType: d.accountType,
      active: d.active,
    })) ?? null,

    // Local DB accounts (all Tradovate accounts for this user)
    localAccountCount: localRows.length,
    localAccounts: localRows.map((r) => ({
      id: r.id,
      label: r.label,
      externalAccountId: r.externalAccountId,
      brokerConnectionId: r.brokerConnectionId,
      onThisConnection: r.brokerConnectionId === connectionId,
      protectionStatus: r.protectionStatus,
      missingFromBrokerSince: r.missingFromBrokerSince?.toISOString() ?? null,
      lastSeenInBrokerAt: r.lastSeenInBrokerAt?.toISOString() ?? null,
      isActive: r.isActive,
    })),

    // Dry-run reconciliation decision
    reconciliation: decision
      ? {
          matchedCount: decision.matched.length,
          matched: decision.matched,
          wouldCreateCount: decision.newAccounts.length,
          wouldCreate: decision.newAccounts.map((d) => ({
            externalAccountId: d.externalAccountId,
            name: d.name,
            accountType: d.accountType,
          })),
          missingCount: decision.missing.length,
          missing: decision.missing,
        }
      : null,

    // Accounts skipped (already exist or inactive)
    skippedCount: skipped.length,
    skipped,

    // Current pending_decision rows (shown in "New broker account detected")
    pendingDecisionCount: pendingRows.length,
    pendingDecisionRows: pendingRows.map((r) => ({
      id: r.id,
      label: r.label,
      externalAccountId: r.externalAccountId,
      brokerConnectionId: r.brokerConnectionId,
      onThisConnection: r.brokerConnectionId === connectionId,
      lastSeenInBrokerAt: r.lastSeenInBrokerAt?.toISOString() ?? null,
    })),

    // Diagnosis summary
    diagnosis: buildDiagnosis({
      accountListFetchOk: discovered != null,
      discovered: discovered ?? [],
      wouldCreate: decision?.newAccounts ?? [],
      pendingRows,
      localRows,
      connectionId,
    }),
  });
}

function buildDiagnosis(input: {
  accountListFetchOk: boolean;
  discovered: DiscoveredAccount[];
  wouldCreate: DiscoveredAccount[];
  pendingRows: Array<{ id: string; label: string; brokerConnectionId: string | null }>;
  localRows: Array<{ externalAccountId: string | null; protectionStatus: string; brokerConnectionId: string | null }>;
  connectionId: string;
}): string {
  const { accountListFetchOk, discovered, wouldCreate, pendingRows, localRows, connectionId } = input;

  if (!accountListFetchOk) {
    return "PROBLEM: /account/list call failed. Check server logs for the HTTP status. The new account cannot be discovered until Tradovate returns a successful response.";
  }
  if (discovered.length === 0) {
    return "PROBLEM: /account/list returned an empty array. Tradovate returned no accounts for this connection. This is likely a session/token issue or the account was not issued yet.";
  }

  const inactiveCount = discovered.filter((d) => !d.active).length;
  if (inactiveCount === discovered.length) {
    return `PROBLEM: All ${discovered.length} account(s) returned by /account/list have active=false. These are treated as missing/reset by the reconciler and will not appear as new pending_decision rows.`;
  }

  if (wouldCreate.length > 0) {
    return `WOULD CREATE: ${wouldCreate.length} new account(s) would be created as pending_decision on the next real sync. The dry-run ran successfully — trigger a real sync via "Refresh all accounts" or the per-connection sync button to persist the rows.`;
  }

  // All accounts exist. See if any are on a different connection.
  const norm = (s: string) => s.trim().toLowerCase();
  const activeDiscovered = discovered.filter((d) => d.active);
  const wrongConnection = activeDiscovered.filter((d) => {
    const local = localRows.find(
      (r) => r.externalAccountId != null && norm(r.externalAccountId) === norm(d.externalAccountId),
    );
    return local && local.brokerConnectionId !== connectionId;
  });
  if (wrongConnection.length > 0) {
    return `INFO: ${wrongConnection.length} active account(s) from /account/list already exist in the DB but are linked to a different BrokerConnection. The reconciler will re-link them to this connection on the next sync via the "matched" path. They are NOT shown as new.`;
  }

  if (pendingRows.length > 0) {
    const onThisConn = pendingRows.filter((r) => r.brokerConnectionId === connectionId);
    if (onThisConn.length > 0) {
      return `OK: ${onThisConn.length} pending_decision row(s) already exist on this connection and should be visible in the "New broker account detected" panel. If the panel is not showing, check loadCommandCenterData / NewAccountsPanel rendering.`;
    }
    return `INFO: ${pendingRows.length} pending_decision row(s) exist but on different connections. No new rows needed for this connection's accounts.`;
  }

  return "OK: All accounts from /account/list already exist in the DB and are not pending_decision. No new panel row is expected. If you believe a new account is missing, check whether the account appears in accountList above with active=true.";
}
