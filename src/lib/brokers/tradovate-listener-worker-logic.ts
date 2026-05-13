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
};

/** Per-connection startup plan the worker will hand to the listener manager. */
export type ListenerStartupPlan = {
  connectionId: string;
  userId: string;
  tradovateUserId: number;
  env: "live" | "demo";
  permissionLevel: "full_access" | "read_only" | null;
};

/** Reasons a row was skipped — used for logs and tests. */
export type SkipReason =
  | "wrong_platform"
  | "unhealthy_status"
  | "missing_broker_user_id"
  | "invalid_broker_user_id"
  | "unsupported_env";

export type FilterResult = {
  start: ListenerStartupPlan[];
  skipped: Array<{ connectionId: string; reason: SkipReason }>;
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
export function planListenerStartups(rows: BrokerConnectionRow[]): FilterResult {
  const start: ListenerStartupPlan[] = [];
  const skipped: FilterResult["skipped"] = [];

  for (const row of rows) {
    if (row.platform !== "tradovate") {
      skipped.push({ connectionId: row.id, reason: "wrong_platform" });
      continue;
    }
    if (!HEALTHY_CONNECTION_STATUSES.has(row.connectionStatus)) {
      skipped.push({ connectionId: row.id, reason: "unhealthy_status" });
      continue;
    }
    if (!row.brokerUserId) {
      skipped.push({ connectionId: row.id, reason: "missing_broker_user_id" });
      continue;
    }
    const tradovateUserId = Number(row.brokerUserId);
    if (!Number.isFinite(tradovateUserId) || tradovateUserId <= 0) {
      skipped.push({ connectionId: row.id, reason: "invalid_broker_user_id" });
      continue;
    }
    if (row.env !== "live" && row.env !== "demo") {
      skipped.push({ connectionId: row.id, reason: "unsupported_env" });
      continue;
    }
    const permissionLevel =
      row.permissionLevel === "full_access" || row.permissionLevel === "read_only"
        ? row.permissionLevel
        : null;

    start.push({
      connectionId: row.id,
      userId: row.userId,
      tradovateUserId,
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
