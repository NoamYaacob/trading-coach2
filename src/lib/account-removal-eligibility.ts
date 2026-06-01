/**
 * Pure removal-eligibility decision for Guardrail account archiving / removal.
 *
 * Holds NO database or clock dependency (and imports no prisma) so the full
 * branch matrix — bypasses, session lock, internal lock, and the CME-session /
 * CT-calendar day-boundary divergence — is unit-testable without a database.
 *
 * The DB-reading wrapper lives in account-removal-guard.ts, mirroring the
 * pure-evaluator / -db split used elsewhere in the guardian engine.
 */

export type RemovalEligibility = {
  /** true when the account can be archived immediately. */
  canRemoveNow: boolean;
  /**
   * Machine-readable reason why removal is deferred. null when canRemoveNow.
   * Format: "session_stopped" | "cooldown_active"
   *         | "internal_lock:<ruleType>" | "account_not_found"
   */
  lockReason: string | null;
  /** YYYY-MM-DD trading day key for the next session reset (when deferred removal applies). */
  nextTradingDay: string;
};

/** Pre-fetched DB state passed to the pure removal-eligibility decision. */
export type RemovalDecisionInput = {
  /** False when no ConnectedAccount matched the (accountId, userId) pair. */
  accountFound: boolean;
  /** ConnectedAccount.missingFromBrokerSince — bypass when set. */
  missingFromBrokerSince: Date | null;
  /** ConnectedAccount.protectionStatus — bypass for "ignored" / "archived". */
  protectionStatus: string | null;
  /** LiveSessionState.sessionDate (null when no session row). */
  sessionDate: string | null;
  /** Today's CT calendar-day key (the guard's reference "today"). */
  todayKey: string;
  /** LiveSessionState.riskState (null when no session row). */
  riskState: string | null;
  /** LiveSessionState.cooldownActive. */
  cooldownActive: boolean;
  /**
   * The active InternalLockEvent (clearedAt IS NULL) for this account, if any.
   * NOT restricted by tradingDay — clearedAt being null is the authoritative
   * "still locked" signal across the CME-session / CT-calendar day boundary.
   */
  activeInternalLock: { ruleType: string } | null;
  /** YYYY-MM-DD key for the next session reset (deferred-removal message). */
  nextTradingDay: string;
};

/**
 * Pure removal-eligibility decision. See RemovalDecisionInput for the
 * pre-fetched state the DB wrapper supplies.
 *
 * Evaluation order (first match wins):
 *   0. account not found                         → defer "account_not_found"
 *   1. missingFromBrokerSince set                → allow (bypass)
 *   2. protectionStatus ignored / archived       → allow (bypass)
 *   3. today's session STOPPED                   → defer "session_stopped"
 *   4. today's session cooldownActive            → defer "cooldown_active"
 *   5. any active InternalLockEvent (clearedAt=null) → defer "internal_lock:<ruleType>"
 *   else                                          → allow
 */
export function decideRemovalEligibility(input: RemovalDecisionInput): RemovalEligibility {
  const { nextTradingDay } = input;

  if (!input.accountFound) {
    return { canRemoveNow: false, lockReason: "account_not_found", nextTradingDay };
  }

  // Unavailable from broker — no active trades or enforcement happening.
  if (input.missingFromBrokerSince != null) {
    return { canRemoveNow: true, lockReason: null, nextTradingDay };
  }

  // Already in an inactive protection state — removal is safe.
  if (input.protectionStatus === "ignored" || input.protectionStatus === "archived") {
    return { canRemoveNow: true, lockReason: null, nextTradingDay };
  }

  // ── 1 & 2. LiveSessionState — session risk stopped or cooldown ───────────
  // We only treat the session row as "current" when sessionDate matches today's
  // CT calendar day key. A stale row from a prior day poses no session lock.
  if (input.sessionDate === input.todayKey) {
    if (input.riskState === "STOPPED") {
      return { canRemoveNow: false, lockReason: "session_stopped", nextTradingDay };
    }
    if (input.cooldownActive === true) {
      return { canRemoveNow: false, lockReason: "cooldown_active", nextTradingDay };
    }
  }

  // ── 3. InternalLockEvent — any active internal lock (clearedAt IS NULL) ───
  // Not gated by tradingDay: an uncleared lock is still active even after the
  // CT calendar day rolls past the lock's CME session day.
  if (input.activeInternalLock) {
    return {
      canRemoveNow: false,
      lockReason: `internal_lock:${input.activeInternalLock.ruleType}`,
      nextTradingDay,
    };
  }

  return { canRemoveNow: true, lockReason: null, nextTradingDay };
}
