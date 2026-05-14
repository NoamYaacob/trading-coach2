/**
 * Pure helpers for the Tradovate listener worker.
 *
 * Extracted so unit tests can verify connection filtering and status mapping
 * without booting Prisma, ws, or the actual TradovateListenerManager.
 *
 * Phase 1: observe-only. These helpers describe WHICH connections deserve a
 * listener and HOW to translate the in-memory ListenerState into the DB
 * listenerStatus string. They do not perform any enforcement action.
 */

import type { ListenerState } from "./tradovate-user-sync-listener.ts";

// ── Connection filter ────────────────────────────────────────────────────────

/** Shape of a BrokerConnection row the worker reads from DB. */
export type BrokerConnectionRow = {
  id: string;
  userId: string;
  platform: string;
  env: string;
  brokerUserId: string | null;
  connectionStatus: string;
  permissionLevel: string | null;
  tokenExpiresAt: Date | null;
  lastRenewError: string | null;
  /**
   * Persisted listener status from a previous reconcile. When set to "error"
   * the listener gave up after repeated auth failures. Combined with
   * listenerNextRetryAt, the worker can either:
   *   - skip with "listener_retry_cooldown" if nextRetryAt is in the future
   *   - clear and retry once nextRetryAt has passed
   *   - skip with "listener_error" if nextRetryAt is null (legacy / hard error)
   */
  listenerStatus: string | null;
  /** Soft-retry: scheduled time at which the worker may attempt this listener again. */
  listenerNextRetryAt: Date | null;
  /** Operator switch: when non-null the worker skips this connection entirely. */
  listenerDisabledAt: Date | null;
};

/** Per-connection startup plan the worker will hand to the listener manager. */
export type ListenerStartupPlan = {
  connectionId: string;
  userId: string;
  /**
   * Raw `BrokerConnection.brokerUserId` value when the row has one, else null.
   * Resolution to a numeric Tradovate user id (used by `user/syncrequest`) is
   * the worker's responsibility — if absent or unparseable, the worker will
   * back-fill from `/account/list` and persist before starting the listener.
   */
  brokerUserIdHint: string | null;
  env: "live" | "demo";
  permissionLevel: "full_access" | "read_only" | null;
};

/** Reasons a row was skipped — used for logs and tests. */
export type SkipReason =
  | "wrong_platform"
  | "unhealthy_status"
  | "renew_error"
  | "expired_token"
  | "unsupported_env"
  | "listener_error"
  | "listener_retry_cooldown"
  | "listener_disabled"
  | "listener_globally_disabled"
  | "single_connection_filter"
  | "live_disabled";

/** Safe (non-secret) snapshot attached to each skipped entry for diagnostics. */
export type SkipDiagnostic = {
  connectionId: string;
  reason: SkipReason;
  env: string;
  connectionStatus: string;
  permissionLevel: string | null;
  tokenExpiresAtExists: boolean;
  tokenExpired: boolean;
};

export type FilterResult = {
  start: ListenerStartupPlan[];
  skipped: SkipDiagnostic[];
};

export type PlanListenerStartupsOptions = {
  /** Override "now" for deterministic testing of expired-token gating. */
  now?: Date;
  /**
   * Allow `env: "live"` connections through. Default false — live listeners
   * are temporarily disabled until demo handshake is verified. Set via the
   * TRADOVATE_LISTENER_ENABLE_LIVE env var in the worker.
   */
  enableLive?: boolean;
  /**
   * When true, the worker is globally disabled: every row is skipped with
   * reason "listener_globally_disabled". Set via TRADOVATE_LISTENER_DISABLED.
   */
  globallyDisabled?: boolean;
  /**
   * When set (non-null and non-empty), only the row with this connectionId is
   * considered; every other row is skipped with reason
   * "single_connection_filter". Set via TRADOVATE_LISTENER_CONNECTION_ID to
   * scope debugging to one connection. Accepts null for "no filter".
   */
  singleConnectionId?: string | null;
};

/**
 * Healthy statuses that warrant a listener. Mirrors the cron filter
 * (see src/app/api/cron/tradovate-sync/route.ts) — anything outside this
 * set is expired, errored, or not yet connected.
 */
export const HEALTHY_CONNECTION_STATUSES: ReadonlySet<string> = new Set([
  "connected_readonly",
  "connected_live",
]);

/**
 * Pick connections that should have a listener started. Pure function — no I/O.
 *
 * Phase 1 is observe-only, so we accept both `connected_readonly` and
 * `connected_live`. A read-only connection cannot enforce, but listening to
 * its position feed still gives us a freshness signal in the dashboard.
 */
export function planListenerStartups(
  rows: BrokerConnectionRow[],
  options: PlanListenerStartupsOptions = {},
): FilterResult {
  const now = options.now ?? new Date();
  const enableLive = options.enableLive ?? false;
  const globallyDisabled = options.globallyDisabled ?? false;
  const singleConnectionId = options.singleConnectionId ?? null;
  const start: ListenerStartupPlan[] = [];
  const skipped: SkipDiagnostic[] = [];

  for (const row of rows) {
    const tokenExpired = row.tokenExpiresAt !== null && row.tokenExpiresAt < now;
    const meta: Omit<SkipDiagnostic, "reason"> = {
      connectionId: row.id,
      env: row.env,
      connectionStatus: row.connectionStatus,
      permissionLevel: row.permissionLevel,
      tokenExpiresAtExists: row.tokenExpiresAt !== null,
      tokenExpired,
    };

    if (row.platform !== "tradovate") {
      skipped.push({ ...meta, reason: "wrong_platform" });
      continue;
    }
    // Global kill-switch wins over all per-row filters so an operator can stop
    // every listener with a single env var without touching DB state.
    if (globallyDisabled) {
      skipped.push({ ...meta, reason: "listener_globally_disabled" });
      continue;
    }
    // Single-connection debugging filter: when set, only the named row is
    // considered. Useful when investigating one broken connection without
    // restarting other healthy listeners.
    if (singleConnectionId !== null && row.id !== singleConnectionId) {
      skipped.push({ ...meta, reason: "single_connection_filter" });
      continue;
    }
    // Operator-set per-connection disable. Cleared via repair endpoint.
    if (row.listenerDisabledAt !== null) {
      skipped.push({ ...meta, reason: "listener_disabled" });
      continue;
    }
    if (!HEALTHY_CONNECTION_STATUSES.has(row.connectionStatus)) {
      skipped.push({ ...meta, reason: "unhealthy_status" });
      continue;
    }
    // An active renewal error means the broker rejected recent renewal attempts.
    // Skip rather than hammer the API — the cron renewer will clear this on success.
    if (row.lastRenewError !== null) {
      skipped.push({ ...meta, reason: "renew_error" });
      continue;
    }
    // A definitively expired token with no recent renew attempt is a hard skip.
    // ensureTradovateAccessToken will attempt renewal; if tokenExpiresAt is in
    // the past but lastRenewError is null, we still attempt (covered above).
    if (tokenExpired) {
      skipped.push({ ...meta, reason: "expired_token" });
      continue;
    }
    if (row.env !== "live" && row.env !== "demo") {
      skipped.push({ ...meta, reason: "unsupported_env" });
      continue;
    }
    // A previous reconcile gave up on this listener after repeated auth
    // failures. Two shapes:
    //   - listenerNextRetryAt > now → still in cooldown, skip softly
    //   - listenerNextRetryAt == null OR <= now → eligible for retry; the
    //     worker is responsible for clearing the error before the next loop
    if (row.listenerStatus === "error") {
      if (row.listenerNextRetryAt !== null && row.listenerNextRetryAt > now) {
        skipped.push({ ...meta, reason: "listener_retry_cooldown" });
        continue;
      }
      // nextRetryAt is null (legacy/hard error) — keep historical behavior.
      if (row.listenerNextRetryAt === null) {
        skipped.push({ ...meta, reason: "listener_error" });
        continue;
      }
      // nextRetryAt <= now: cooldown expired, fall through and try again.
    }
    // Live is temporarily gated behind TRADOVATE_LISTENER_ENABLE_LIVE so demo
    // can be validated first. Demo is always allowed.
    if (row.env === "live" && !enableLive) {
      skipped.push({ ...meta, reason: "live_disabled" });
      continue;
    }
    const permissionLevel =
      row.permissionLevel === "full_access" || row.permissionLevel === "read_only"
        ? row.permissionLevel
        : null;

    // brokerUserId is NOT a hard eligibility gate. It is required only when we
    // send `user/syncrequest`, and the worker can back-fill it from
    // `/account/list` (each TvAccount carries the Tradovate userId) before
    // starting the listener. Pass through the raw value as a hint.
    start.push({
      connectionId: row.id,
      userId: row.userId,
      brokerUserIdHint: row.brokerUserId,
      env: row.env,
      permissionLevel,
    });
  }

  return { start, skipped };
}

// ── State → DB status mapping ────────────────────────────────────────────────

/**
 * Map the in-memory listener state to the DB `BrokerConnection.listenerStatus`
 * column. The dashboard component (broker-listener-status-logic.ts) treats
 * "connected" as "Live" and "connecting"|"reconnecting" as recovering.
 */
export function listenerStateToDbStatus(state: ListenerState): string {
  switch (state) {
    case "ready":
    case "syncing":
      return "connected";
    case "connecting":
    case "authorizing":
      return "connecting";
    case "reconnecting":
      return "reconnecting";
    case "closed":
      return "closed";
    case "idle":
    default:
      return "connecting";
  }
}

/** True for the terminal "we are receiving events" state. */
export function isReadyDbStatus(dbStatus: string): boolean {
  return dbStatus === "connected";
}

// ── Retry backoff ────────────────────────────────────────────────────────────

/**
 * Compute the next-retry delay (in milliseconds) given the current retry count.
 *
 * Backoff schedule: 5m, 15m, 1h, 6h, 24h (capped). This gives a fast first
 * retry so transient broker outages recover quickly, then widens to avoid
 * hammering an endpoint that's persistently rejecting auth.
 *
 * `retryCount` is the count BEFORE this failure (i.e. 0 on the first failure).
 */
export function computeRetryDelayMs(retryCount: number): number {
  const schedule = [
    5 * 60_000,        // 5m
    15 * 60_000,       // 15m
    60 * 60_000,       // 1h
    6 * 60 * 60_000,   // 6h
    24 * 60 * 60_000,  // 24h
  ];
  if (retryCount < 0) return schedule[0]!;
  if (retryCount >= schedule.length) return schedule[schedule.length - 1]!;
  return schedule[retryCount]!;
}
