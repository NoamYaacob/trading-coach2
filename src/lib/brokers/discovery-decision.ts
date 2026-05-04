/**
 * Pure (DB-free) reconciliation logic for broker account discovery.
 *
 * Kept in its own module so unit tests can import it without pulling in
 * Prisma or runtime config. The DB-touching wrapper lives in
 * `tradovate-discovery.ts`.
 */

export type DiscoveredAccount = {
  externalAccountId: string;
  name: string;
  accountType: string;
  active: boolean;
};

export type LocalAccountForReconciliation = {
  id: string;
  externalAccountId: string | null;
  brokerConnectionId: string | null;
  protectionStatus: string;
  missingFromBrokerSince: Date | null;
};

export type ReconcileDecision = {
  /** Existing rows whose broker presence was confirmed; clear missing if set. */
  matched: { id: string; clearMissing: boolean }[];
  /** Broker entries with no matching local row — must be created as pending. */
  newAccounts: DiscoveredAccount[];
  /** Local rows tied to this connection that the broker no longer returns. */
  missing: { id: string; alreadyMissing: boolean }[];
};

/**
 * Pure reconciliation: given a freshly-fetched broker list and the user's
 * existing local accounts, compute what to create / mark missing / mark seen.
 *
 *  - Match by `externalAccountId` (string-equal).
 *  - Local rows with the same brokerConnectionId that aren't in the broker
 *    list become "missing" — but `archived` rows are skipped (we keep them
 *    for history without re-flagging every sync).
 *  - Broker entries with no local match become new pending_decision accounts.
 */
export function decideReconciliation(input: {
  brokerConnectionId: string;
  discovered: DiscoveredAccount[];
  localAccounts: LocalAccountForReconciliation[];
}): ReconcileDecision {
  const { brokerConnectionId, discovered, localAccounts } = input;

  const localByExternalId = new Map<string, LocalAccountForReconciliation>();
  for (const a of localAccounts) {
    if (a.externalAccountId) {
      localByExternalId.set(a.externalAccountId, a);
    }
  }
  const discoveredIds = new Set(discovered.map((d) => d.externalAccountId));

  const matched: ReconcileDecision["matched"] = [];
  const newAccounts: DiscoveredAccount[] = [];
  for (const d of discovered) {
    const existing = localByExternalId.get(d.externalAccountId);
    if (existing) {
      matched.push({
        id: existing.id,
        clearMissing: existing.missingFromBrokerSince != null,
      });
    } else {
      newAccounts.push(d);
    }
  }

  const missing: ReconcileDecision["missing"] = [];
  for (const a of localAccounts) {
    if (a.brokerConnectionId !== brokerConnectionId) continue;
    if (!a.externalAccountId) continue;
    if (discoveredIds.has(a.externalAccountId)) continue;
    if (a.protectionStatus === "archived") continue;
    missing.push({ id: a.id, alreadyMissing: a.missingFromBrokerSince != null });
  }

  return { matched, newAccounts, missing };
}
