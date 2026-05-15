/**
 * Phase 2B: pure gating logic for internal app lock.
 *
 * Safety contract (no side-effects):
 *   - Pure computation only; no Prisma, no DB, no broker calls
 *   - No riskState writes, no broker writes, no flatten, no cancel
 *   - DB persistence and state mutation live in internal-lock-evaluator-db.ts
 */

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
