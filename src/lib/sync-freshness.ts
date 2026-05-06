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

// ── Dashboard interval auto-refresh ──────────────────────────────────────────

/** Absolute floor for the auto-refresh interval. Prevents accidental
 *  aggressive polling that could hit broker API rate limits. */
export const DASHBOARD_AUTO_REFRESH_MIN_MS = 15_000; // 15 seconds

/**
 * Clamps a configured refresh interval to the allowed minimum.
 * Returns `minMs` when `ms` is not a positive finite number.
 */
export function clampRefreshInterval(
  ms: number,
  minMs: number = DASHBOARD_AUTO_REFRESH_MIN_MS,
): number {
  if (!Number.isFinite(ms) || ms <= 0) return minMs;
  return Math.max(minMs, ms);
}

/**
 * How often (ms) the Dashboard auto-refreshes while the tab is open.
 * Override via the NEXT_PUBLIC_DASHBOARD_AUTO_REFRESH_MS environment variable
 * (must be set at build time; values below the minimum are silently clamped).
 */
export const DASHBOARD_AUTO_REFRESH_MS = clampRefreshInterval(
  Number(process.env.NEXT_PUBLIC_DASHBOARD_AUTO_REFRESH_MS) || 30_000,
);

/**
 * Pure guard used by the auto-refresh tick function.
 * Returns true when the tick should be skipped — either because the tab is
 * hidden (user switched away) or a request is already in flight (no overlap).
 */
export function shouldSkipRefresh(isHidden: boolean, inFlight: boolean): boolean {
  return isHidden || inFlight;
}

// ── needsSync ─────────────────────────────────────────────────────────────────

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
