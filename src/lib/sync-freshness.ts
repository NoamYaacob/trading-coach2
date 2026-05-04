/**
 * Sync freshness utilities.
 *
 * A single source of truth for "when does an account need re-syncing?"
 * Used by the dashboard auto-sync component, the cron endpoint, and tests.
 */

/** Auto-sync on page load when data is older than this. */
export const PAGE_SYNC_FRESHNESS_MS = 60_000; // 1 minute

/** Cron sync skips accounts synced more recently than this. */
export const CRON_SYNC_FRESHNESS_MS = 5 * 60_000; // 5 minutes

/**
 * Returns true when the account should be synced.
 * @param lastSyncAt - timestamp of last successful sync, or null if never synced
 * @param freshnessMs - how old (ms) is still considered fresh; defaults to PAGE_SYNC_FRESHNESS_MS
 */
export function needsSync(
  lastSyncAt: Date | null,
  freshnessMs: number = PAGE_SYNC_FRESHNESS_MS,
): boolean {
  if (lastSyncAt === null) return true;
  return Date.now() - lastSyncAt.getTime() > freshnessMs;
}
