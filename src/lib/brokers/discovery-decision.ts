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
  matched: {
    id: string;
    clearMissing: boolean;
    /**
     * The brokerConnectionId the account currently holds in the DB.
     * Used by the persistence layer to decide whether to overwrite the FK:
     * only overwrite when null or already pointing at the same connection.
     */
    currentBrokerConnectionId: string | null;
  }[];
  /** Broker entries with no matching local row — must be created as pending. */
  newAccounts: DiscoveredAccount[];
  /** Local rows tied to this connection that the broker no longer returns. */
  missing: { id: string; alreadyMissing: boolean }[];
};

/**
 * Pure reconciliation: given a freshly-fetched broker list and the user's
 * existing local accounts, compute what to create / mark missing / mark seen.
 *
 *  - Match by `externalAccountId` (string-equal, case-insensitive trim).
 *    Tradovate returns numeric ids; the broker fetcher converts them with
 *    `String(a.id)` so the matcher can treat both sides as strings.
 *  - An account that is in /account/list but has `active: false` is treated
 *    as MISSING. Many prop firms keep reset/blown accounts in the OAuth roster
 *    with active=false instead of deleting them — those rows must NOT show
 *    "Allowed" in the dashboard.
 *  - Local rows with the same brokerConnectionId that aren't in the broker
 *    list (or are in it with active=false) become "missing" — but `archived`
 *    rows are skipped (we keep them for history without re-flagging every sync).
 *  - Broker entries with no local match become new pending_decision accounts,
 *    but only if they're active — we don't auto-create rows for already-dead
 *    accounts the broker is keeping around for historical reasons.
 */
export function decideReconciliation(input: {
  brokerConnectionId: string;
  discovered: DiscoveredAccount[];
  localAccounts: LocalAccountForReconciliation[];
}): ReconcileDecision {
  const { brokerConnectionId, discovered, localAccounts } = input;

  // Normalize keys so a DB string "49392735" matches a broker numeric 49392735
  // after `String(a.id)`. Trim and lowercase to defend against whitespace/case
  // drift in any legacy migration paths.
  const norm = (s: string): string => s.trim().toLowerCase();

  const localByExternalId = new Map<string, LocalAccountForReconciliation>();
  for (const a of localAccounts) {
    if (a.externalAccountId) {
      localByExternalId.set(norm(a.externalAccountId), a);
    }
  }
  const discoveredById = new Map<string, DiscoveredAccount>();
  for (const d of discovered) {
    discoveredById.set(norm(d.externalAccountId), d);
  }

  const matched: ReconcileDecision["matched"] = [];
  const newAccounts: DiscoveredAccount[] = [];
  for (const d of discovered) {
    const existing = localByExternalId.get(norm(d.externalAccountId));
    if (existing) {
      // Carry through the current FK so the persistence layer can decide
      // whether to overwrite it (only safe when null or same connection).
      matched.push({
        id: existing.id,
        clearMissing: d.active && existing.missingFromBrokerSince != null,
        currentBrokerConnectionId: existing.brokerConnectionId,
      });
    } else if (d.active) {
      // Don't auto-create pending_decision rows for inactive accounts — they're
      // already dead; the user didn't ask for them.
      newAccounts.push(d);
    }
  }

  const missing: ReconcileDecision["missing"] = [];
  for (const a of localAccounts) {
    if (a.brokerConnectionId !== brokerConnectionId) continue;
    if (!a.externalAccountId) continue;
    if (a.protectionStatus === "archived") continue;

    const fromBroker = discoveredById.get(norm(a.externalAccountId));
    // Two ways to be missing: (1) broker doesn't return the row at all,
    // (2) broker returns it with active=false (reset/blown/closed).
    const isMissing = fromBroker == null || !fromBroker.active;
    if (!isMissing) continue;

    missing.push({ id: a.id, alreadyMissing: a.missingFromBrokerSince != null });
  }

  return { matched, newAccounts, missing };
}
