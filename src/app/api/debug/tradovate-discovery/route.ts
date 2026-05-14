import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseAndDecrypt } from "@/lib/security/token-crypto";
import { encryptAndSerialize } from "@/lib/security/token-crypto";
import {
  fetchTradovateAccountListWithDiagnostics,
  tryRefreshToken,
} from "@/lib/brokers/tradovate-discovery-diagnostic";
import {
  decideReconciliation,
  type DiscoveredAccount,
  type LocalAccountForReconciliation,
} from "@/lib/brokers/tradovate-discovery";
import { getTradovateConfig } from "@/lib/brokers/tradovate-env";
import { shouldRenewToken, REFRESH_BUFFER_MS } from "@/lib/brokers/tradovate-client-helpers";

/**
 * Diagnostic endpoint: why isn't a newly-purchased broker account appearing
 * in the "New broker account detected" dashboard panel?
 *
 * Usage:
 *   GET /api/debug/tradovate-discovery?connectionId=<brokerConnectionId>
 *
 * Returns a full trace without writing to the DB (other than saving a
 * refreshed token if the stored one was expired — that's a safe side-effect
 * and mirrors what the real sync does).
 *
 * Authentication: requires a valid session; connectionId must belong to the
 * current user.
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
      refreshTokenEncrypted: true,
      tokenExpiresAt: true,
      createdAt: true,
    },
  });

  if (!connection) {
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
  const tokenUrl = cfg.config.tokenUrl[env];

  // Derive renewAccessToken URL from the token URL (same auth-server, different path).
  let renewUrl: string;
  try {
    renewUrl = new URL(tokenUrl).origin + "/auth/renewAccessToken";
  } catch {
    renewUrl = tokenUrl.replace(/\/[^/]+$/, "/renewAccessToken");
  }

  // ── Decrypt stored tokens ────────────────────────────────────────────────
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
        connectionStatus: connection.connectionStatus,
        tokenExpiresAt: connection.tokenExpiresAt?.toISOString() ?? null,
      },
      { status: 500 },
    );
  }

  let refreshToken: string | null = null;
  if (connection.refreshTokenEncrypted) {
    try {
      refreshToken = parseAndDecrypt(connection.refreshTokenEncrypted);
    } catch {
      // Not fatal — we'll try without it.
    }
  }

  // ── Token renewal decision ───────────────────────────────────────────────
  const renewalDecision = shouldRenewToken({
    expiresAt: connection.tokenExpiresAt,
    now: new Date(),
    bufferMs: REFRESH_BUFFER_MS,
  });

  const tokenStatus = {
    expiresAt: connection.tokenExpiresAt?.toISOString() ?? null,
    renewalDecision: renewalDecision.reason,
    msUntilExpiry: renewalDecision.msUntilExpiry,
    hasRefreshToken: refreshToken != null,
  };

  // Attempt refresh when the token is expired or within the buffer window.
  let tokenRefresh: Awaited<ReturnType<typeof tryRefreshToken>> = {
    attempted: false,
    reason: "not_needed",
  };

  if (renewalDecision.shouldRenew) {
    tokenRefresh = await tryRefreshToken({
      accessToken,
      refreshToken,
      renewUrl,
      tokenUrl,
      clientId: cfg.config.clientId,
      clientSecret: cfg.config.clientSecret,
    });

    // Persist the new token so subsequent syncs don't also fail.
    if (tokenRefresh.attempted && tokenRefresh.succeeded && tokenRefresh.newToken) {
      try {
        await prisma.brokerConnection.update({
          where: { id: connectionId },
          data: {
            accessTokenEncrypted: encryptAndSerialize(tokenRefresh.newToken),
            ...(tokenRefresh.newExpiresAt ? { tokenExpiresAt: tokenRefresh.newExpiresAt } : {}),
            connectionStatus: "connected_readonly",
            errorMessage: null,
          },
        });
        // Use the refreshed token for the account list call.
        accessToken = tokenRefresh.newToken;
      } catch {
        // Persist failure is non-fatal for the debug trace — still use the
        // new token in-memory for this call.
        accessToken = tokenRefresh.newToken;
      }
    }
  }

  // ── Call /account/list with diagnostic capture ────────────────────────────
  const listResult = await fetchTradovateAccountListWithDiagnostics(baseUrl, accessToken);

  // Build the safe token refresh summary (no token values).
  const tokenRefreshSummary = buildTokenRefreshSummary(tokenRefresh);

  // ── Local DB accounts ─────────────────────────────────────────────────────
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

  // ── Dry-run reconciliation (no DB writes) ─────────────────────────────────
  const discovered = listResult.accounts;
  const decision =
    discovered != null
      ? decideReconciliation({
          brokerConnectionId: connectionId,
          discovered,
          localAccounts: localForReconciliation,
        })
      : null;

  // Accounts skipped: in /account/list but won't create a new pending_decision.
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
        (r) =>
          r.externalAccountId != null &&
          norm(r.externalAccountId) === norm(d.externalAccountId),
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
          reason:
            "inactive — broker returned active=false; new pending_decision rows are not created for inactive accounts",
        });
      }
    }
  }

  // Current pending_decision rows (what surfaces in the dashboard panel).
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

    // Token state (no secret values)
    tokenStatus,
    tokenRefresh: tokenRefreshSummary,

    // /account/list result
    accountListFetchOk: listResult.accounts != null,
    accountListHttpStatus: listResult.httpStatus,
    accountListBodyPreview: listResult.bodyPreview,
    accountListErrorMessage: listResult.errorMessage,
    accountListCount: listResult.accounts?.length ?? 0,
    accountList: listResult.accounts?.map((d) => ({
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

    // Dry-run reconciliation
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

    // Skipped accounts with reasons
    skippedCount: skipped.length,
    skipped,

    // Current pending_decision rows
    pendingDecisionCount: pendingRows.length,
    pendingDecisionRows: pendingRows.map((r) => ({
      id: r.id,
      label: r.label,
      externalAccountId: r.externalAccountId,
      brokerConnectionId: r.brokerConnectionId,
      onThisConnection: r.brokerConnectionId === connectionId,
      lastSeenInBrokerAt: r.lastSeenInBrokerAt?.toISOString() ?? null,
    })),

    // Plain-English diagnosis
    diagnosis: buildDiagnosis({
      accountListFetchOk: listResult.accounts != null,
      accountListHttpStatus: listResult.httpStatus,
      accountListErrorMessage: listResult.errorMessage,
      tokenRefreshSummary,
      discovered: discovered ?? [],
      wouldCreate: decision?.newAccounts ?? [],
      pendingRows,
      localRows,
      connectionId,
    }),
  });
}

/** Strip `newToken` (plaintext secret) before serialising to JSON. */
function buildTokenRefreshSummary(
  r: Awaited<ReturnType<typeof tryRefreshToken>>,
): Record<string, unknown> {
  if (!r.attempted) return { attempted: false, reason: r.reason };
  return {
    attempted: true,
    strategy: r.strategy,
    succeeded: r.succeeded,
    httpStatus: r.httpStatus,
    errorMessage: r.errorMessage,
    newExpiresAt: r.newExpiresAt?.toISOString() ?? null,
    // newToken is intentionally omitted — never expose raw token values.
  };
}

function buildDiagnosis(input: {
  accountListFetchOk: boolean;
  accountListHttpStatus: number | null;
  accountListErrorMessage: string | null;
  tokenRefreshSummary: Record<string, unknown>;
  discovered: DiscoveredAccount[];
  wouldCreate: DiscoveredAccount[];
  pendingRows: Array<{ id: string; label: string; brokerConnectionId: string | null }>;
  localRows: Array<{
    externalAccountId: string | null;
    protectionStatus: string;
    brokerConnectionId: string | null;
  }>;
  connectionId: string;
}): string {
  const {
    accountListFetchOk,
    accountListHttpStatus,
    accountListErrorMessage,
    tokenRefreshSummary,
    discovered,
    wouldCreate,
    pendingRows,
    localRows,
    connectionId,
  } = input;

  if (!accountListFetchOk) {
    const status = accountListHttpStatus;
    const refreshAttempted = tokenRefreshSummary["attempted"] === true;
    const refreshSucceeded = tokenRefreshSummary["succeeded"] === true;

    if (status === 401 || status === 403) {
      if (refreshAttempted && !refreshSucceeded) {
        return (
          `PROBLEM: Tradovate rejected /account/list with HTTP ${status} and token refresh also failed ` +
          `(strategy=${tokenRefreshSummary["strategy"] ?? "unknown"}, ` +
          `error=${tokenRefreshSummary["errorMessage"] ?? "see tokenRefresh"}). ` +
          "Reconnect this broker connection — the OAuth grant is no longer valid."
        );
      }
      return (
        `PROBLEM: Tradovate rejected /account/list with HTTP ${status}. ` +
        "The access token is invalid or expired. Reconnect this broker connection or wait for " +
        'the next automatic sync (which refreshes the token via TradovateClient before syncing accounts).'
      );
    }

    if (status != null && status >= 500) {
      return (
        `TRANSIENT: Tradovate returned HTTP ${status} on /account/list. ` +
        "This is a server-side error on Tradovate's side. Retry in a few minutes."
      );
    }

    if (accountListErrorMessage?.startsWith("Network error")) {
      return (
        `PROBLEM: Network error reaching Tradovate /account/list: ${accountListErrorMessage}. ` +
        "Check DNS, proxy settings, or Tradovate status at status.tradovate.com."
      );
    }

    return (
      `PROBLEM: /account/list call failed (HTTP ${status ?? "unknown"}: ${accountListErrorMessage ?? "see accountListBodyPreview"}). ` +
      "Check accountListBodyPreview above for the raw Tradovate error response."
    );
  }

  if (discovered.length === 0) {
    return (
      "PROBLEM: /account/list returned an empty array. Tradovate returned no accounts for this " +
      "connection. Either the account hasn't been issued by the prop firm yet, or this OAuth " +
      "token doesn't grant access to any accounts."
    );
  }

  const inactiveAll = discovered.every((d) => !d.active);
  if (inactiveAll) {
    return (
      `PROBLEM: All ${discovered.length} account(s) returned by /account/list have active=false. ` +
      "These are treated as missing/reset by the reconciler — pending_decision rows are not " +
      "created for inactive accounts. The new account may not have been activated by the prop firm yet."
    );
  }

  if (wouldCreate.length > 0) {
    return (
      `WOULD CREATE: ${wouldCreate.length} new account(s) would be created as pending_decision on the ` +
      'next real sync. Trigger a sync via "Refresh all accounts" or the per-connection sync button.'
    );
  }

  const norm = (s: string) => s.trim().toLowerCase();
  const activeDiscovered = discovered.filter((d) => d.active);
  const wrongConnection = activeDiscovered.filter((d) => {
    const local = localRows.find(
      (r) =>
        r.externalAccountId != null &&
        norm(r.externalAccountId) === norm(d.externalAccountId),
    );
    return local && local.brokerConnectionId !== connectionId;
  });
  if (wrongConnection.length > 0) {
    return (
      `INFO: ${wrongConnection.length} active account(s) from /account/list already exist in the DB ` +
      "but are linked to a different BrokerConnection. They will be re-linked to this connection on the " +
      "next sync. They are not shown as new because they are already known."
    );
  }

  if (pendingRows.length > 0) {
    const onThisConn = pendingRows.filter((r) => r.brokerConnectionId === connectionId);
    if (onThisConn.length > 0) {
      return (
        `OK: ${onThisConn.length} pending_decision row(s) already exist on this connection and should ` +
        "be visible in the \"New broker account detected\" panel. If the panel is not showing, " +
        "check loadCommandCenterData → pendingAccounts and NewAccountsPanel rendering."
      );
    }
    return (
      `INFO: ${pendingRows.length} pending_decision row(s) exist but on other connections. ` +
      "No new rows are expected for this connection's accounts."
    );
  }

  return (
    "OK: All active accounts from /account/list already exist in the DB and are not pending_decision. " +
    "No new panel row is expected. If you believe a new account is missing, check accountList above — " +
    "confirm the account appears with active=true."
  );
}
