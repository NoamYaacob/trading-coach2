/**
 * Tradovate account discovery — server-only.
 *
 * Used in two places:
 *  1. OAuth callback / retry-account-sync: fetches the broker's account list
 *     to populate PendingBrokerSetup.discoveredAccountsJson.
 *  2. Periodic sync: detects newly-purchased / freshly-issued accounts and
 *     creates them as `pending_decision`; flags accounts the broker no longer
 *     returns as `missingFromBrokerSince`.
 *
 * Critical: discovery NEVER deletes an account. Burned / closed prop firm
 * accounts are kept for history with a missing-from-broker marker.
 */

import { prisma } from "@/lib/db";
import { parseAndDecrypt } from "@/lib/security/token-crypto";

import {
  decideReconciliation,
  type DiscoveredAccount,
} from "./discovery-decision";
import { getTradovateConfig } from "./tradovate-env";

export {
  fetchTradovateAccountListWithDiagnostics,
  tryRefreshToken,
  type AccountListDiagnostic,
  type TokenRefreshResult,
} from "./tradovate-discovery-diagnostic";

export type { DiscoveredAccount, LocalAccountForReconciliation, ReconcileDecision } from "./discovery-decision";
export { decideReconciliation } from "./discovery-decision";

type TvAccount = {
  id: number;
  name: string;
  accountType: string;
  active: boolean;
  nickname?: string;
};

/** Fetch the broker's current account list. Caller provides the API base URL
 *  for the right env (live/demo) and a raw access token.
 *
 *  Detailed logging is intentional — silent discovery failures used to hide
 *  the case where /account/list returned 5xx/401 and the dashboard kept
 *  showing stale "Allowed" rows for accounts the prop firm had already reset.
 */
export async function fetchTradovateAccountList(
  baseUrl: string,
  accessToken: string,
): Promise<DiscoveredAccount[] | null> {
  const url = `${baseUrl}/account/list`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
  } catch (err) {
    console.warn("[tradovate/discovery] /account/list network error", {
      url,
      error: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }
  if (!res.ok) {
    console.warn("[tradovate/discovery] /account/list non-ok response — discovery skipped", {
      url,
      status: res.status,
      note: "Local accounts will NOT be reconciled this sync — missingFromBrokerSince is preserved.",
    });
    return null;
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    console.warn("[tradovate/discovery] /account/list parse error", {
      url,
      error: err instanceof Error ? err.message : "unknown",
    });
    return null;
  }
  if (!Array.isArray(data)) {
    console.warn("[tradovate/discovery] /account/list unexpected shape", {
      url,
      shape: data === null ? "null" : typeof data,
    });
    return null;
  }
  const rows = data as TvAccount[];
  // Log enough to diagnose mismatches without leaking PII: id (numeric),
  // name (account label which is the prop-firm-issued public id), active flag.
  console.info("[tradovate/discovery] /account/list result", {
    url,
    httpStatus: res.status,
    count: rows.length,
    entries: rows.map((a) => ({
      id: a.id,
      idType: typeof a.id,
      name: a.name,
      nickname: a.nickname,
      accountType: a.accountType,
      active: a.active,
    })),
  });
  return rows.map((a): DiscoveredAccount => ({
    externalAccountId: String(a.id),
    name: a.nickname ?? a.name ?? String(a.id),
    accountType: a.accountType ?? "unknown",
    active: Boolean(a.active),
  }));
}

export type ReconcileResult = {
  /** Accounts that were already present and matched a broker entry. */
  existingIds: string[];
  /** Local IDs of newly-created `pending_decision` accounts. */
  newlyCreatedIds: string[];
  /** Local IDs of accounts no longer returned by the broker. */
  missingIds: string[];
};


/**
 * Reconcile a freshly-fetched broker account list against the local DB.
 *
 *  - Existing account whose externalAccountId matches a broker entry: stamp
 *    `lastSeenInBrokerAt`, clear `missingFromBrokerSince`.
 *  - Broker entry with no local row: create a new ConnectedAccount with
 *    protectionStatus="pending_decision". The user must explicitly opt in.
 *  - Local row whose externalAccountId is no longer in the broker list: set
 *    `missingFromBrokerSince` (only if not already set, so the timestamp
 *    represents the first sync that lost the account). NEVER delete.
 *
 *  Pending-decision and ignored/archived rows are still reconciled — they
 *  don't disappear from history.
 */
export async function reconcileDiscoveredAccounts(input: {
  userId: string;
  brokerConnectionId: string;
  discovered: DiscoveredAccount[];
}): Promise<ReconcileResult> {
  const { userId, brokerConnectionId, discovered } = input;
  const now = new Date();

  // All Tradovate ConnectedAccount rows for this user — we reconcile against
  // every user-owned row, not just the connection's own rows, because the
  // multi-account model can re-link the same externalAccountId across
  // BrokerConnections.
  const localAccounts = await prisma.connectedAccount.findMany({
    where: { userId, platform: "tradovate" },
    select: {
      id: true,
      externalAccountId: true,
      brokerConnectionId: true,
      protectionStatus: true,
      missingFromBrokerSince: true,
    },
  });

  console.info("[tradovate/discovery] reconciliation input", {
    userId,
    brokerConnectionId,
    discoveredCount: discovered.length,
    discovered: discovered.map((d) => ({
      externalAccountId: d.externalAccountId,
      name: d.name,
      accountType: d.accountType,
      active: d.active,
    })),
    localCount: localAccounts.length,
    local: localAccounts.map((a) => ({
      id: a.id,
      externalAccountId: a.externalAccountId,
      brokerConnectionId: a.brokerConnectionId,
      protectionStatus: a.protectionStatus,
      missingFromBrokerSince: a.missingFromBrokerSince?.toISOString() ?? null,
    })),
  });

  const decision = decideReconciliation({
    brokerConnectionId,
    discovered,
    localAccounts,
  });

  console.info("[tradovate/discovery] reconciliation decision", {
    brokerConnectionId,
    matchedCount: decision.matched.length,
    matched: decision.matched,
    newCount: decision.newAccounts.length,
    newAccountIds: decision.newAccounts.map((d) => d.externalAccountId),
    missingCount: decision.missing.length,
    missing: decision.missing,
  });

  // Apply matched rows.
  for (const m of decision.matched) {
    await prisma.connectedAccount.update({
      where: { id: m.id },
      data: {
        lastSeenInBrokerAt: now,
        ...(m.clearMissing ? { missingFromBrokerSince: null } : {}),
        // Keep brokerConnectionId pointing at the most recent live connection.
        brokerConnectionId,
      },
    });
  }

  // Create new pending_decision rows.
  const newlyCreatedIds: string[] = [];
  for (const d of decision.newAccounts) {
    const created = await prisma.connectedAccount.create({
      data: {
        userId,
        platform: "tradovate",
        externalAccountId: d.externalAccountId,
        label: d.name,
        accountType: "personal", // user can change in the protection UI
        currency: "USD",
        isActive: true,
        connectionStatus: "connected_readonly",
        connectedAt: now,
        brokerConnectionId,
        protectionStatus: "pending_decision",
        lastSeenInBrokerAt: now,
      },
      select: { id: true },
    });
    newlyCreatedIds.push(created.id);
  }

  // Flag missing rows (only if not already flagged).
  const missingIds: string[] = [];
  for (const m of decision.missing) {
    missingIds.push(m.id);
    if (!m.alreadyMissing) {
      await prisma.connectedAccount.update({
        where: { id: m.id },
        data: { missingFromBrokerSince: now },
      });
    }
  }

  return {
    existingIds: decision.matched.map((m) => m.id),
    newlyCreatedIds,
    missingIds,
  };
}

/**
 * Run discovery for a single broker connection: fetch /account/list, reconcile
 * against the local DB, return what changed.
 *
 * This is the shared implementation used by:
 *  - `syncTradovateConnection` (full connection sync)
 *  - the per-account sync API route (so newly-purchased broker accounts surface
 *    in the dashboard's "New broker account detected" panel without requiring
 *    a separate "Refresh all" click).
 *
 * Discovery failures are non-fatal — callers should treat the returned `ok`
 * flag as informational and continue with whatever else they were doing.
 */
export async function runDiscoveryForConnection(
  connectionId: string,
  userId: string,
): Promise<{ ok: boolean; newlyCreatedIds: string[]; missingIds: string[] }> {
  try {
    const connection = await prisma.brokerConnection.findFirst({
      where: { id: connectionId, userId },
      select: { env: true, accessTokenEncrypted: true },
    });
    const cfg = getTradovateConfig();
    if (!connection || cfg.state !== "ready") {
      console.warn("[tradovate/discovery] preconditions not met", {
        connectionId,
        hasConnection: connection != null,
        configReady: cfg.state === "ready",
      });
      return { ok: false, newlyCreatedIds: [], missingIds: [] };
    }
    const accessToken = parseAndDecrypt(connection.accessTokenEncrypted);
    const env = connection.env as "live" | "demo";
    const discovered = await fetchTradovateAccountList(
      cfg.config.apiBaseUrl[env],
      accessToken,
    );
    if (!discovered) {
      return { ok: false, newlyCreatedIds: [], missingIds: [] };
    }
    const reconciled = await reconcileDiscoveredAccounts({
      userId,
      brokerConnectionId: connectionId,
      discovered,
    });
    return {
      ok: true,
      newlyCreatedIds: reconciled.newlyCreatedIds,
      missingIds: reconciled.missingIds,
    };
  } catch (err) {
    console.error("[tradovate/discovery] runDiscoveryForConnection failed", {
      connectionId,
      msg: err instanceof Error ? err.message : "unknown",
    });
    return { ok: false, newlyCreatedIds: [], missingIds: [] };
  }
}
