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
   * the listener gave up after repeated auth failures and must not be retried
   * until an operator clears the value (e.g. by re-running OAuth).
   */
  listenerStatus: string | null;
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
  | "listener_error";

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
export function planListenerStartups(rows: BrokerConnectionRow[], now = new Date()): FilterResult {
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
    // A previous reconcile already gave up on this listener after repeated
    // auth failures. Refuse to retry until an operator clears the state.
    if (row.listenerStatus === "error") {
      skipped.push({ ...meta, reason: "listener_error" });
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
