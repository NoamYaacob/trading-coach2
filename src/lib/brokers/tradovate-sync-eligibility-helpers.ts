/**
 * Pure helpers for the /api/debug/tradovate-sync/eligibility diagnostic endpoint.
 *
 * No Prisma, no Next.js — safe to import from tests and the route alike.
 * Mirrors the exact conditions that /api/cron/tradovate-sync uses to decide
 * which connections and accounts to sync.
 */

// ── Constants (mirror cron/tradovate-sync + tradovate-sync.ts) ───────────────

/** Connection statuses the cron query accepts. */
export const CRON_ELIGIBLE_CONNECTION_STATUSES = ["connected_readonly", "connected_live"] as const;

/** Protection statuses the cron query accepts. */
export const CRON_ELIGIBLE_PROTECTION_STATUSES = ["protected", "monitor_only"] as const;

/** Accounts synced more recently than this are skipped as "fresh". 5 minutes. */
export const CRON_FRESHNESS_THRESHOLD_MS = 5 * 60 * 1_000;

/**
 * If lastSyncAt is newer than sessionUpdatedAt by more than this margin, a
 * partial sync failure is suspected (lastSyncAt was written at line ~205 of
 * syncTradovateAccount before LiveSessionState could be updated at line ~711).
 */
export const PARTIAL_SYNC_SUSPECT_MARGIN_MS = 30_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export type AccountSkipReason =
  | "last_sync_too_recent"
  | "never_synced"
  | "inactive_account"
  | "unprotected_account"
  | "connection_status_excluded"
  | "missing_from_broker"
  | "unknown";

export type AccountEligibilityInput = {
  accountId: string;
  label: string | null;
  externalAccountId: string | null;
  isActive: boolean;
  protectionStatus: string;
  errorMessage: string | null;
  lastSyncAt: Date | null;
  missingFromBrokerSince: Date | null;
  sessionUpdatedAt: Date | null;
  /** Whether the parent connection's connectionStatus passes the cron filter. */
  connectionStatusEligible: boolean;
  now: Date;
  freshnessThresholdMs: number;
};

export type AccountEligibilityResult = {
  wouldSync: boolean;
  skipReason: AccountSkipReason | null;
  lastSyncAgeMs: number | null;
  /**
   * True when lastSyncAt is present but LiveSessionState looks out of sync
   * with it. Fingerprint of a partial sync failure: lastSyncAt is written
   * early in syncTradovateAccount (line ~205) before LiveSessionState is
   * updated (line ~711). If an exception fires between those two writes,
   * the account looks "recently synced" to the cron staleness check but
   * its session data is actually stale.
   *
   * Triggers when:
   *   - errorMessage is set (catch block ran after lastSyncAt was committed), OR
   *   - lastSyncAt is more than PARTIAL_SYNC_SUSPECT_MARGIN_MS newer than
   *     sessionUpdatedAt (sync committed account row but not session row).
   */
  partialSyncSuspected: boolean;
};

/** Subset of AccountEligibilityResult needed for connection-level aggregation. */
export type AccountEligibilitySummary = {
  wouldSync: boolean;
  skipReason: AccountSkipReason | null;
};

export type ConnectionEligibilityInput = {
  connectionStatus: string;
  accountResults: AccountEligibilitySummary[];
};

export type ConnectionEligibilityResult = {
  /** True when the connection passes the cron's WHERE clause. */
  matchesCronFilter: boolean;
  connectionSkipReason: "connection_status_excluded" | "no_eligible_accounts" | null;
  eligibleAccountCount: number;
  staleAccountCount: number;
  /** True when this connection would actually trigger a sync (stale accounts exist). */
  wouldSync: boolean;
};

// ── Account eligibility ───────────────────────────────────────────────────────

export function deriveAccountEligibility(input: AccountEligibilityInput): AccountEligibilityResult {
  const {
    isActive,
    missingFromBrokerSince,
    protectionStatus,
    connectionStatusEligible,
    lastSyncAt,
    sessionUpdatedAt,
    errorMessage,
    now,
    freshnessThresholdMs,
  } = input;

  const lastSyncAgeMs = lastSyncAt != null ? now.getTime() - lastSyncAt.getTime() : null;

  const partialSyncSuspected =
    lastSyncAt != null &&
    (errorMessage != null ||
      (sessionUpdatedAt != null &&
        lastSyncAt.getTime() - sessionUpdatedAt.getTime() > PARTIAL_SYNC_SUSPECT_MARGIN_MS));

  if (!connectionStatusEligible) {
    return {
      wouldSync: false,
      skipReason: "connection_status_excluded",
      lastSyncAgeMs,
      partialSyncSuspected,
    };
  }
  if (!isActive) {
    return { wouldSync: false, skipReason: "inactive_account", lastSyncAgeMs, partialSyncSuspected };
  }
  if (missingFromBrokerSince != null) {
    return {
      wouldSync: false,
      skipReason: "missing_from_broker",
      lastSyncAgeMs,
      partialSyncSuspected,
    };
  }
  if (!(CRON_ELIGIBLE_PROTECTION_STATUSES as readonly string[]).includes(protectionStatus)) {
    return {
      wouldSync: false,
      skipReason: "unprotected_account",
      lastSyncAgeMs,
      partialSyncSuspected,
    };
  }
  if (lastSyncAt === null) {
    // Never synced → stale by definition → would sync.
    return { wouldSync: true, skipReason: "never_synced", lastSyncAgeMs, partialSyncSuspected };
  }
  if (lastSyncAgeMs !== null && lastSyncAgeMs <= freshnessThresholdMs) {
    return {
      wouldSync: false,
      skipReason: "last_sync_too_recent",
      lastSyncAgeMs,
      partialSyncSuspected,
    };
  }
  return { wouldSync: true, skipReason: null, lastSyncAgeMs, partialSyncSuspected };
}

// ── Connection eligibility ────────────────────────────────────────────────────

export function deriveConnectionEligibility(
  input: ConnectionEligibilityInput,
): ConnectionEligibilityResult {
  const { connectionStatus, accountResults } = input;

  const connectionStatusEligible = (
    CRON_ELIGIBLE_CONNECTION_STATUSES as readonly string[]
  ).includes(connectionStatus);

  if (!connectionStatusEligible) {
    return {
      matchesCronFilter: false,
      connectionSkipReason: "connection_status_excluded",
      eligibleAccountCount: 0,
      staleAccountCount: 0,
      wouldSync: false,
    };
  }

  // "Eligible" = would pass the cron DB WHERE clause (active + protected/monitor_only).
  const eligibleAccountCount = accountResults.filter(
    (r) => r.skipReason !== "connection_status_excluded" &&
           r.skipReason !== "inactive_account" &&
           r.skipReason !== "missing_from_broker" &&
           r.skipReason !== "unprotected_account",
  ).length;

  if (eligibleAccountCount === 0) {
    return {
      matchesCronFilter: false,
      connectionSkipReason: "no_eligible_accounts",
      eligibleAccountCount: 0,
      staleAccountCount: 0,
      wouldSync: false,
    };
  }

  const staleAccountCount = accountResults.filter((r) => r.wouldSync).length;

  return {
    matchesCronFilter: true,
    connectionSkipReason: null,
    eligibleAccountCount,
    staleAccountCount,
    wouldSync: staleAccountCount > 0,
  };
}
