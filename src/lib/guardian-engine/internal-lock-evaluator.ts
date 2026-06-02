/**
 * Phase 2B: pure gating logic for internal app lock.
 *
 * Safety contract (no side-effects):
 *   - Pure computation only; no Prisma, no DB, no broker calls
 *   - No riskState writes, no broker writes, no flatten, no cancel
 *   - DB persistence and state mutation live in internal-lock-evaluator-db.ts
 */

/**
 * Build the unique dedup key for an active internal lock row.
 *
 * One key per account per rule per trading day — the DB unique constraint on
 * InternalLockEvent.activeDedupKey enforces at-most-one active lock even under
 * concurrent props events. The key is set to null on clear so the slot can be
 * reused after a manual reset within the same trading day.
 */
export function buildInternalLockDedupKey(
  accountId: string,
  ruleType: string,
  tradingDay: string,
): string {
  return `${accountId}:${ruleType}:${tradingDay}:internal_lock`;
}

export type InternalLockGateInput = {
  /** BrokerConnection env — only "demo" is eligible. */
  env: string;
  /** Current LiveSessionState.riskState — "NORMAL" | "WARNING" | "STOPPED". */
  riskState: string;
  /** GUARDRAIL_INTERNAL_LOCK_ENABLED env var resolved to boolean. */
  flagEnabled: boolean;
};

/**
 * Returns true only when all three gates pass:
 *   1. Feature flag is enabled.
 *   2. Account is on the demo environment.
 *   3. Account is not already locked (idempotent guard).
 */
export function canApplyInternalLock(input: InternalLockGateInput): boolean {
  return input.flagEnabled && input.env === "demo" && input.riskState !== "STOPPED";
}

export type HoldRiskStateInput = {
  /**
   * The riskState the sync's own rule evaluator computed this cycle, BEFORE
   * applying any active-lock protection — "NORMAL" | "WARNING" | "STOPPED".
   */
  evaluatedRiskState: string;
  /**
   * True when the stored LiveSessionState.sessionDate differs from the current
   * CME trading-day key — i.e. the session rolled over. On rollover the
   * session-end cleanup clears active locks, so the hold MUST be skipped to
   * allow the account to reset to NORMAL for the new session.
   */
  isStale: boolean;
  /**
   * True when at least one active InternalLockEvent exists for the account
   * (clearedAt = null AND activeDedupKey != null). This covers manual_lock and
   * every rule-engine lock type equally — the account is locked until the lock
   * is cleared.
   */
  hasActiveInternalLock: boolean;
};

/**
 * Decide whether sync must hold riskState at STOPPED because an active
 * InternalLockEvent exists.
 *
 * This is the Priority-1 invariant: a manual (or rule-engine) lock writes an
 * active InternalLockEvent + riskState=STOPPED, but a later sync re-evaluates
 * the rules from scratch and — finding no live breach (e.g. dry-run mode, or
 * P&L back within limits) — would otherwise downgrade riskState to NORMAL,
 * re-showing the Lockout button. Holding at STOPPED prevents that downgrade.
 *
 * Pure — no DB, no broker calls. Returns true only when:
 *   - the session has NOT rolled over (so the session-end cleanup can still
 *     clear the lock and reset the account on rollover), AND
 *   - the evaluator did not already land on STOPPED (no override needed), AND
 *   - an active InternalLockEvent exists.
 *
 * When the evaluator already computed STOPPED, the account stays STOPPED via
 * the normal path and no hold is required — so this returns false to keep the
 * override scoped to genuine downgrade-prevention.
 */
export function shouldHoldRiskStateStopped(input: HoldRiskStateInput): boolean {
  if (input.isStale) return false;
  if (input.evaluatedRiskState === "STOPPED") return false;
  return input.hasActiveInternalLock;
}
