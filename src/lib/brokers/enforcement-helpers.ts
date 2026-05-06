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
  | "manual";

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
 */
export type BrokerLockStatus =
  | "not_requested"
  | "unavailable_read_only"
  | "unavailable_permission"
  | "pending"
  | "broker_locked"
  | "monitoring_only"
  | "broker_lock_failed";

// ── Payload builders ──────────────────────────────────────────────────────────

/**
 * Build the POST body for userAccountAutoLiq/update.
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
 * Build the POST body for userAccountAutoLiq/create.
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

// ── Loss amount computation ───────────────────────────────────────────────────

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
  if (opts.trigger !== "daily_loss_limit") {
    return {
      skip: true,
      lockStatus: "monitoring_only",
      reason: `Trigger '${opts.trigger}' has no applicable Tradovate broker API with current permissions.`,
    };
  }
  if (opts.connectionStatus === "connected_readonly") {
    return {
      skip: true,
      lockStatus: "unavailable_read_only",
      reason:
        "Broker-side enforcement skipped: connection is read-only (connected_readonly). " +
        "Account Risk Settings: Full Access is required for userAccountAutoLiq writes. " +
        "Guardrail is monitoring and alerting only for this account.",
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
