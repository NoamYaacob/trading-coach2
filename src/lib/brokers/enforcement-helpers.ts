/**
 * Pure (no I/O) helpers for broker-side enforcement.
 *
 * Kept in a plain .ts file so they can be unit-tested without mocking the
 * database, network, or TradovateClient.
 *
 * Callers: enforcement.ts (orchestration), enforcement.test.ts (tests).
 */

export type EnforcementTrigger =
  | "daily_loss_limit"
  | "trade_limit"
  | "consecutive_losses"
  | "profit_target"
  | "trading_day_disabled"
  | "session_end"
  | "max_position_size"
  | "manual";

/**
 * Values for GuardianIntervention.flattenStatus — outcome of the position-exit
 * step that precedes broker-side day lockout.
 *
 *   not_needed           — GET /position/deps returned no open positions; no
 *                          liquidate call was made.
 *   attempted            — POST /order/liquidatepositions was accepted but the
 *                          read-back still shows open positions (order may still
 *                          be working in the market).
 *   flattened            — read-back via GET /position/deps confirmed all
 *                          positions are flat (netPos === 0 for every record).
 *   unavailable_read_only — connection is connected_readonly; flatten skipped to
 *                           avoid a spurious 403 that could confuse audit logs.
 *   unavailable_permission — POST /order/liquidatepositions returned HTTP 403
 *                            (Orders: Full Access permission missing).
 *   failed               — liquidate request or read-back failed unexpectedly.
 *   dry_run              — ENFORCEMENT_DRY_RUN=true; flatten was simulated, no
 *                          Tradovate write endpoint was called.
 */
export type FlattenStatus =
  | "not_needed"
  | "attempted"
  | "flattened"
  | "unavailable_read_only"
  | "unavailable_permission"
  | "failed"
  | "dry_run";

export type BrokerFlattenResult = {
  flattenStatus: FlattenStatus;
  flattenMessage: string;
  flattenPayload: Record<string, unknown> | null;
  flattenResponse: unknown;
};

/**
 * Values stored in GuardianIntervention.brokerLockStatus.
 *
 *   not_requested        — no enforcement was triggered for this account/trigger
 *   unavailable_read_only — connection is connected_readonly; write skipped to
 *                           avoid a spurious 403 that could confuse audit logs
 *   unavailable_permission — write reached Tradovate and got HTTP 403
 *                            (missing "Account Risk Settings: Full Access")
 *   pending              — enforcement triggered; broker confirmation not yet
 *                          received (reserved for future async flows)
 *   broker_locked        — Tradovate accepted the risk setting update
 *   monitoring_only      — no applicable broker API for this trigger or platform
 *   broker_lock_failed   — broker API was called but returned a non-permission error
 *   dry_run              — ENFORCEMENT_DRY_RUN=true; broker write was simulated,
 *                          no Tradovate endpoint was called; intended payload is
 *                          persisted to GuardianIntervention for review
 */
export type BrokerLockStatus =
  | "not_requested"
  | "unavailable_read_only"
  | "unavailable_permission"
  | "pending"
  | "broker_locked"
  | "monitoring_only"
  | "broker_lock_failed"
  | "dry_run";

// ── Dry-run mode ──────────────────────────────────────────────────────────────

/**
 * Returns true when ENFORCEMENT_DRY_RUN=true is set in the environment.
 *
 * In dry-run mode, applyBrokerDayLockout skips all Tradovate write endpoints
 * (userAccountAutoLiq/create, userAccountAutoLiq/update) and instead persists
 * the intended payload to GuardianIntervention with status=dry_run.
 *
 * Only the exact string "true" enables dry-run — any other value (including
 * "1", "yes", "TRUE") leaves enforcement in normal mode.
 */
export function isEnforcementDryRun(): boolean {
  return process.env.ENFORCEMENT_DRY_RUN === "true";
}

// ── Payload builders ──────────────────────────────────────────────────────────

/**
 * Build the POST body for userAccountAutoLiq/update (daily loss lock).
 *
 * doNotUnlock is intentionally omitted — it would prevent Tradovate from
 * auto-unlocking the account at the next session open, trapping it permanently.
 */
export function buildAutoLiqUpdatePayload(opts: {
  existingId: number;
  dailyLossAutoLiq: number;
  changesLocked?: boolean;
}): Record<string, unknown> {
  return {
    id: opts.existingId,
    dailyLossAutoLiq: opts.dailyLossAutoLiq,
    changesLocked: opts.changesLocked ?? true,
  };
}

/**
 * Build the POST body for userAccountAutoLiq/create (daily loss lock).
 *
 * doNotUnlock is intentionally omitted — see buildAutoLiqUpdatePayload.
 */
export function buildAutoLiqCreatePayload(opts: {
  tvAccountId: number;
  dailyLossAutoLiq: number;
  changesLocked?: boolean;
}): Record<string, unknown> {
  return {
    accountId: opts.tvAccountId,
    dailyLossAutoLiq: opts.dailyLossAutoLiq,
    changesLocked: opts.changesLocked ?? true,
  };
}

/**
 * Build the POST body for userAccountAutoLiq/update (profit target lock).
 *
 * doNotUnlock is intentionally omitted — see buildAutoLiqUpdatePayload.
 */
export function buildAutoLiqProfitUpdatePayload(opts: {
  existingId: number;
  dailyProfitAutoLiq: number;
  changesLocked?: boolean;
}): Record<string, unknown> {
  return {
    id: opts.existingId,
    dailyProfitAutoLiq: opts.dailyProfitAutoLiq,
    changesLocked: opts.changesLocked ?? true,
  };
}

/**
 * Build the POST body for userAccountAutoLiq/create (profit target lock).
 *
 * doNotUnlock is intentionally omitted — see buildAutoLiqUpdatePayload.
 */
export function buildAutoLiqProfitCreatePayload(opts: {
  tvAccountId: number;
  dailyProfitAutoLiq: number;
  changesLocked?: boolean;
}): Record<string, unknown> {
  return {
    accountId: opts.tvAccountId,
    dailyProfitAutoLiq: opts.dailyProfitAutoLiq,
    changesLocked: opts.changesLocked ?? true,
  };
}

// ── Amount computation ────────────────────────────────────────────────────────

/**
 * Compute the dailyLossAutoLiq threshold to send to Tradovate.
 *
 * currentDailyLoss may be passed as either a raw daily P&L (negative on a
 * losing day) or as the absolute loss amount (positive). Math.abs normalises
 * both conventions.
 *
 * When the threshold is at or below the account's current realized loss,
 * Tradovate's risk engine immediately places the account in liquidation-only
 * mode and blocks new opening orders for the rest of the session.
 */
export function computeLossAmountToSet(
  currentDailyLoss: number | null | undefined,
): number {
  if (currentDailyLoss == null || !Number.isFinite(currentDailyLoss)) return 0;
  return Math.max(0, Math.abs(currentDailyLoss));
}

/**
 * Effective daily P&L for enforcement = realized P&L + open/unrealized P&L.
 *
 * openPnl is account-scoped: it comes from getCashBalanceSnapshot's `openPl`
 * field (per-account POST with accountId) or from position/deps unrealizedPnL
 * (per-account GET with masterid). Both sources are safe to include.
 *
 * Returns null only when both inputs are null — no P&L data at all.
 */
export function computeEffectiveDailyPnl(
  resolvedDailyPnl: number | null,
  openPnl: number | null,
): number | null {
  if (resolvedDailyPnl === null && openPnl === null) return null;
  return (resolvedDailyPnl ?? 0) + (openPnl ?? 0);
}

/**
 * Compute the dailyProfitAutoLiq threshold to send to Tradovate.
 *
 * currentDailyPnl is the raw daily P&L (positive on a profitable day).
 * Setting dailyProfitAutoLiq at or below the current profit immediately
 * places the account in liquidation-only mode for the rest of the session.
 */
export function computeProfitAmountToSet(
  currentDailyPnl: number | null | undefined,
): number {
  if (currentDailyPnl == null || !Number.isFinite(currentDailyPnl)) return 0;
  return Math.max(0, currentDailyPnl);
}

// ── Skip-enforcement gate ─────────────────────────────────────────────────────

/**
 * Decide whether broker-side enforcement should be skipped for this account.
 *
 * Returns `{ skip: true, lockStatus, reason }` when the API call must be
 * bypassed — caller records lockStatus to GuardianIntervention and returns.
 * Returns `{ skip: false }` when a broker call should proceed.
 *
 * IMPORTANT: When skip=true the broker API is never called, so no 401 from
 * the risk endpoint can inadvertently expire the OAuth connection.
 */
export function shouldSkipBrokerEnforcement(opts: {
  platform: string;
  trigger: EnforcementTrigger;
  connectionStatus: string;
  /**
   * Probed permission level from `BrokerConnection.permissionLevel`. When
   * present, this is the source of truth for capability — preferred over
   * `connectionStatus`, which historically conflated webhook-arrival with
   * permission. `null` means the probe has not yet run; in that case we
   * fall back to the legacy `connectionStatus` check.
   */
  permissionLevel?: string | null;
}):
  | { skip: true; lockStatus: BrokerLockStatus; reason: string }
  | { skip: false } {
  if (opts.platform !== "tradovate") {
    return {
      skip: true,
      lockStatus: "monitoring_only",
      reason: `Platform '${opts.platform}' does not support broker-side enforcement.`,
    };
  }
  if (opts.trigger !== "daily_loss_limit" && opts.trigger !== "profit_target") {
    return {
      skip: true,
      lockStatus: "monitoring_only",
      reason: `Trigger '${opts.trigger}' has no applicable Tradovate broker API.`,
    };
  }

  // Prefer the probed permission level when available. The probe calls
  // userAccountAutoLiq/deps; success means the user granted Account Risk
  // Settings, so writes will also be permitted.
  if (opts.permissionLevel === "read_only") {
    return {
      skip: true,
      lockStatus: "unavailable_read_only",
      reason:
        "Broker-side enforcement skipped: probed permission level is read_only. " +
        "Account Risk Settings: Full Access is required for userAccountAutoLiq writes. " +
        "Guardrail is monitoring and alerting only for this account.",
    };
  }
  if (opts.permissionLevel === "full_access") {
    return { skip: false };
  }

  // Legacy fallback when the probe has not yet run (permissionLevel === null
  // or "unknown"). Treat the legacy connectionStatus as a hint, but proceed
  // optimistically when the connection is live — the broker call's 403
  // handler will record the permission gap.
  if (opts.connectionStatus === "connected_readonly") {
    return {
      skip: true,
      lockStatus: "unavailable_read_only",
      reason:
        "Broker-side enforcement skipped: connection status is read-only and permission probe has not yet confirmed otherwise. " +
        "Guardrail is monitoring and alerting only for this account until the probe runs.",
    };
  }
  return { skip: false };
}

// ── Response confirmation ─────────────────────────────────────────────────────

/**
 * Decide whether a Tradovate response (or read-back) confirms that the
 * dailyLossAutoLiq was stored at the value we sent.
 *
 * The comparison uses an epsilon of 0.01 (1 cent) to tolerate floating-point
 * round-trips through the API. When responseValue is null/undefined the result
 * is false — the caller must fall back to a read-back GET.
 */
export function isAutoLiqConfirmed(opts: {
  expectedValue: number;
  responseValue: number | null | undefined;
  epsilon?: number;
}): boolean {
  const { expectedValue, responseValue, epsilon = 0.01 } = opts;
  if (responseValue == null || !Number.isFinite(responseValue)) return false;
  return Math.abs(responseValue - expectedValue) <= epsilon;
}

// ── Flatten helpers ───────────────────────────────────────────────────────────

/**
 * Build the POST body for order/liquidatepositions.
 *
 * `positions` is an array of Tradovate position IDs (not contract IDs).
 * `admin=false` — this is an automated client action, not an admin override.
 */
export function buildLiquidatePositionsPayload(positionIds: number[]): Record<string, unknown> {
  return { positions: positionIds, admin: false };
}

/**
 * Returns true when a read-back of positions confirms all are flat
 * (netPos === 0 or null for every record in the array).
 *
 * An empty array also returns true — no open positions means already flat.
 */
export function isFlattenConfirmed(positions: Array<{ netPos: number | null }>): boolean {
  return positions.every((p) => p.netPos === null || p.netPos === 0);
}

/**
 * Classify a flatten API error into a BrokerFlattenResult.
 *
 * 403 → unavailable_permission: Orders: Full Access is missing from the OAuth
 *   scope. Same as the lockout convention: a capability limit, not global auth
 *   failure. The connection must NOT be marked expired.
 *
 * All other errors → failed.
 */
export function classifyFlattenError(err: unknown): BrokerFlattenResult {
  const obj =
    err != null && typeof err === "object" ? (err as Record<string, unknown>) : null;
  const statusCode =
    typeof obj?.statusCode === "number" ? obj.statusCode : null;
  const message = err instanceof Error ? err.message : "Unknown error";

  if (statusCode === 403) {
    return {
      flattenStatus: "unavailable_permission",
      flattenMessage:
        "Position exit unavailable: missing permission (HTTP 403). " +
        "Verify the OAuth token was issued with 'Orders: Full Access'.",
      flattenPayload: null,
      flattenResponse: null,
    };
  }
  return {
    flattenStatus: "failed",
    flattenMessage: `Position exit failed: ${message}`,
    flattenPayload: null,
    flattenResponse: null,
  };
}

// ── Session-end helpers ───────────────────────────────────────────────────────

/**
 * What should happen at session end for accounts that still have open positions.
 *
 *   flatten_at_session_end   — Guardrail exits all open positions automatically,
 *                              then locks the account.
 *   wait_for_exit_then_lock  — New opening orders are blocked immediately, but
 *                              Guardrail does not touch the active position. The
 *                              account locks as soon as it goes flat.
 *
 * null in the DB is treated as "wait_for_exit_then_lock" (safe default).
 */
export type SessionEndBehavior =
  | "flatten_at_session_end"
  | "wait_for_exit_then_lock";

/**
 * What the sync should do upon detecting session end for a given account.
 *
 *   none             — session not ended, already stopped, or pending with positions still open
 *   lock_immediately — session ended, no open positions — lock now
 *   flatten_then_lock — session ended, open positions, behavior=flatten_at_session_end
 *   await_flat       — session ended, open positions, behavior=wait_for_exit_then_lock
 *                      → set pendingSessionEndLock=true; lock fires next sync when flat
 *   lock_pending     — pendingSessionEndLock was true, now positions are flat — lock now
 */
export type SessionEndAction =
  | "none"
  | "lock_immediately"
  | "flatten_then_lock"
  | "await_flat"
  | "lock_pending";

/**
 * Returns the current hour (0–23) in America/Chicago time.
 *
 * Midnight in Chicago is returned as 0, not 24.
 */
export function getCmeHour(now: Date): number {
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    hour12: false,
  }).format(now);
  const h = parseInt(s, 10);
  return h === 24 ? 0 : h;
}

/**
 * Returns true when the configured session end hour has been reached or passed
 * for the current CME trading session.
 *
 * CME Globex sessions start at 17:00 CT. Hours 17–23 are the *beginning* of a
 * session, so a session end of e.g. 16 (4 PM CT) can only be reached during
 * hours 0–16 of the *following* calendar day. If cmeHour is 17–23 the session
 * is just starting and can never be "at end" yet.
 *
 * sessionEndHour must be in [0, 16] to make practical sense. Values ≥ 17 would
 * fire at session *start*, not end.
 */
export function isSessionEndReached(sessionEndHour: number, cmeHour: number): boolean {
  if (cmeHour >= 17) return false; // session just started — cannot be at end
  return cmeHour >= sessionEndHour;
}

/**
 * Decide what the sync loop should do when approaching or past session end.
 *
 * Pure function — no I/O. All context is passed explicitly so the logic is
 * fully unit-testable.
 */
export function deriveSessionEndAction(opts: {
  sessionEndHour: number | null;
  behavior: SessionEndBehavior;
  cmeHour: number;
  hasOpenPositions: boolean;
  isAlreadyStopped: boolean;
  isPendingSessionEndLock: boolean;
}): SessionEndAction {
  const { sessionEndHour, behavior, cmeHour, hasOpenPositions, isAlreadyStopped, isPendingSessionEndLock } = opts;

  if (isAlreadyStopped) return "none";

  // Pending state: we already detected session end and are waiting for positions to close.
  if (isPendingSessionEndLock) {
    return hasOpenPositions ? "none" : "lock_pending";
  }

  if (sessionEndHour === null) return "none";
  if (!isSessionEndReached(sessionEndHour, cmeHour)) return "none";

  // Session has ended — decide based on position state and configured behavior.
  if (!hasOpenPositions) return "lock_immediately";
  return behavior === "flatten_at_session_end" ? "flatten_then_lock" : "await_flat";
}

// ── Error classification ──────────────────────────────────────────────────────

/**
 * Classify a broker API error into a BrokerLockStatus and human reason.
 *
 * 403 → unavailable_permission: the OAuth token lacks write access to the
 *   risk endpoint. This is a capability limit, not a global auth failure.
 *   The connection must NOT be marked expired; other endpoints remain usable.
 *
 * 401 → broker_lock_failed: token was rejected for this call even after
 *   renewal. We record the failure but do NOT expire the connection from
 *   inside this helper — the caller (triggerEnforcement) decides on expiry.
 *
 * The skipMarkExpired=true flag in TradovateClient.#request() ensures that
 * persistent 401s from the risk endpoint are also not marked expired at the
 * transport layer.
 */
export function classifyEnforcementError(err: unknown): {
  lockStatus: BrokerLockStatus;
  failureReason: string;
} {
  const obj =
    err != null && typeof err === "object" ? (err as Record<string, unknown>) : null;
  const statusCode =
    typeof obj?.statusCode === "number" ? obj.statusCode : null;
  const code = typeof obj?.code === "string" ? obj.code : null;
  const message = err instanceof Error ? err.message : "Unknown error";

  if (statusCode === 403) {
    return {
      lockStatus: "unavailable_permission",
      failureReason:
        "Account Risk Settings permission denied (HTTP 403). " +
        "Verify the OAuth token was issued with 'Account Risk Settings: Full Access'.",
    };
  }
  if (statusCode === 401) {
    return {
      lockStatus: "broker_lock_failed",
      failureReason:
        "OAuth token unauthorized (HTTP 401) — re-authorize to reconnect.",
    };
  }
  if (code === "NO_ACCOUNT_ID") {
    return {
      lockStatus: "broker_lock_failed",
      failureReason:
        "Tradovate account ID not resolved. " +
        "Ensure externalAccountId is saved (re-sync to refresh).",
    };
  }
  if (code === "NETWORK_ERROR") {
    return {
      lockStatus: "broker_lock_failed",
      failureReason: "Network error reaching Tradovate API.",
    };
  }
  return {
    lockStatus: "broker_lock_failed",
    failureReason: `${code ?? "UNKNOWN"}: ${message}`,
  };
}
