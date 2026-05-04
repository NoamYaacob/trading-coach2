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

import {
  decideReconciliation,
  type DiscoveredAccount,
} from "./discovery-decision";

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
 *  for the right env (live/demo) and a raw access token. */
export async function fetchTradovateAccountList(
  baseUrl: string,
  accessToken: string,
): Promise<DiscoveredAccount[] | null> {
  try {
    const res = await fetch(`${baseUrl}/account/list`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as TvAccount[];
    if (!Array.isArray(data)) return null;
    return data.map((a): DiscoveredAccount => ({
      externalAccountId: String(a.id),
      name: a.nickname ?? a.name ?? String(a.id),
      accountType: a.accountType ?? "unknown",
      active: Boolean(a.active),
    }));
  } catch {
    return null;
  }
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

  const decision = decideReconciliation({
    brokerConnectionId,
    discovered,
    localAccounts,
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
