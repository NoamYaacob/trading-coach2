/**
 * Pure aggregator for the sync-all endpoint.
 *
 * Takes the raw per-connection sync outcomes and produces the response body
 * the Dashboard's SyncAllButton consumes. Kept separate from the route so it
 * can be unit-tested without Prisma or Next.js.
 */

export type SyncAllSyncResult = {
  connectionId: string;
  /** Per-account sync results from syncTradovateConnection — present on success. */
  syncResults?: Array<{ ok: boolean }>;
  /** Set when the connection-level sync threw before producing per-account results. */
  errorCode?: string;
};

export type SyncAllResponse = {
  ok: boolean;
  syncedConnections: number;
  failedConnections: number;
  syncedAccounts: number;
  failedAccounts: number;
  results: Array<{
    connectionId: string;
    ok: boolean;
    accountCount: number;
    errorCode?: string;
  }>;
};

export function aggregateSyncAll(input: SyncAllSyncResult[]): SyncAllResponse {
  let syncedConnections = 0;
  let failedConnections = 0;
  let syncedAccounts = 0;
  let failedAccounts = 0;
  const results: SyncAllResponse["results"] = [];

  for (const entry of input) {
    if (entry.errorCode != null || entry.syncResults == null) {
      failedConnections += 1;
      results.push({
        connectionId: entry.connectionId,
        ok: false,
        accountCount: 0,
        errorCode: entry.errorCode ?? "UNKNOWN",
      });
      continue;
    }
    const ok = entry.syncResults.filter((r) => r.ok).length;
    const bad = entry.syncResults.length - ok;
    syncedAccounts += ok;
    failedAccounts += bad;
    const allOk = bad === 0;
    if (allOk) syncedConnections += 1;
    else failedConnections += 1;
    results.push({
      connectionId: entry.connectionId,
      ok: allOk,
      accountCount: entry.syncResults.length,
    });
  }

  return {
    ok: failedConnections === 0,
    syncedConnections,
    failedConnections,
    syncedAccounts,
    failedAccounts,
    results,
  };
}
