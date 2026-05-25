/**
 * Phase 2B extension: pure evaluator for max_position_size internal-lock
 * gating decisions. No DB. No broker calls. Safe to import from tests.
 *
 * DB persistence lives in max-position-size-internal-lock-db.ts.
 *
 * Semantics (allowance model — inclusive):
 *   maxContracts is the inclusive cap. With maxContracts=2, standard-equivalent
 *   exposure 0, 1, and 2 are within the allowance; the lock fires only when
 *   exposure > 2 (the 3rd standard-equivalent contract opens). Comparison is
 *   in integer millis to absorb IEEE-754 drift on non-0.1 ratios.
 */

export type MaxPositionSizeLockEvalInput = {
  /** Configured max contracts (standard-equivalent units). null = rule not set, skip. */
  maxContracts: number | null;
  /**
   * Observed standard-equivalent exposure (positive). null = position data
   * unavailable this cycle, skip safely.
   */
  currentMiniEquivalentExposure: number | null;
  /**
   * True when at least one open position is in a symbol Guardrail cannot
   * classify into the standard-equivalent registry. Safer policy: lock when
   * verification is impossible, matching the sync path's existing behavior.
   */
  hasUnsupportedPositions: boolean;
};

export type MaxPositionSizeLockEvalResult = {
  shouldLock: boolean;
  /** When shouldLock=false, the human-readable reason. */
  skipReason: string | null;
};

const MILLIS_PER_UNIT = 1000;

export function evaluateMaxPositionSizeForLock(
  input: MaxPositionSizeLockEvalInput,
): MaxPositionSizeLockEvalResult {
  if (input.maxContracts === null) {
    return { shouldLock: false, skipReason: "maxContracts not configured" };
  }
  if (input.maxContracts < 0) {
    return { shouldLock: false, skipReason: `maxContracts=${input.maxContracts} is invalid` };
  }
  if (input.hasUnsupportedPositions) {
    // Safer policy: cannot verify exposure → lock. Matches the sync path's
    // existing max_position_size enforcement cascade in tradovate-sync.ts.
    return { shouldLock: true, skipReason: null };
  }
  if (input.currentMiniEquivalentExposure === null) {
    return { shouldLock: false, skipReason: "position data unavailable" };
  }
  // Strict > comparison: the configured cap is the allowance; the lock fires
  // when exposure exceeds it. Comparison in integer millis to neutralize
  // IEEE-754 drift for non-0.1 ratios (e.g. FDXS=0.04, QG=0.25).
  const exposureMillis = Math.round(input.currentMiniEquivalentExposure * MILLIS_PER_UNIT);
  const limitMillis = Math.round(input.maxContracts * MILLIS_PER_UNIT);
  if (exposureMillis > limitMillis) {
    return { shouldLock: true, skipReason: null };
  }
  return {
    shouldLock: false,
    skipReason: `exposure ${input.currentMiniEquivalentExposure} within limit ${input.maxContracts}`,
  };
}
