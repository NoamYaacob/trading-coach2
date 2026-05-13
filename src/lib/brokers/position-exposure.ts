/**
 * Pure helper for computing standard-equivalent position exposure.
 *
 * Guardrail enforces a single "max position size" rule expressed in
 * standard-equivalent units (Apex model: 10 micro = 1 standard).
 * This helper classifies each open position using the central futures
 * contract registry and accumulates exposure across all known roots.
 *
 * No I/O. No broker calls. No DB. Pure and deterministic.
 *
 * Internally, exposure is tracked in integer millis (×1000) to avoid
 * IEEE-754 drift for non-0.1 ratios such as FDXS=0.04 or QG=0.25:
 *   1 NQ    = 1000 millis (ratio 1.0)
 *   1 MNQ   =  100 millis (ratio 0.1)
 *   1 FDXM  =  200 millis (ratio 0.2)
 *   1 FDXS  =   40 millis (ratio 0.04)
 * Public values are divided by 1000 only for display.
 */

import { getContractMetadata } from "../futures/contracts.ts";

export type PositionExposureInput = {
  symbol: string;
  netPos: number;
};

export type ExposureResult = {
  totalMiniEquivalent: number;
  byRoot: Array<{
    root: string;
    positions: Array<{
      symbol: string;
      netPos: number;
      miniEquivalent: number;
    }>;
    totalMiniEquivalent: number;
  }>;
  unsupported: Array<{
    symbol: string;
    netPos: number;
    reason: string;
  }>;
};

const MILLIS_PER_UNIT = 1000;

export function computeMiniEquivalentExposure(
  positions: PositionExposureInput[],
): ExposureResult {
  const groupBuckets = new Map<
    string,
    {
      root: string;
      positions: Array<{ symbol: string; netPos: number; miniEquivalent: number }>;
      totalMillis: number;
    }
  >();
  const unsupported: ExposureResult["unsupported"] = [];
  let totalMillis = 0;

  for (const pos of positions) {
    if (pos.netPos === 0) continue;

    const meta = getContractMetadata(pos.symbol);
    if (meta === null) {
      unsupported.push({
        symbol: pos.symbol,
        netPos: pos.netPos,
        reason: "Symbol not in the Guardrail futures contract registry",
      });
      continue;
    }

    const ratioMillis = Math.round(meta.exposureRatioToParent * MILLIS_PER_UNIT);
    const exposureMillis = Math.abs(pos.netPos) * ratioMillis;
    totalMillis += exposureMillis;

    const group = meta.parentRoot;
    let bucket = groupBuckets.get(group);
    if (!bucket) {
      bucket = { root: group, positions: [], totalMillis: 0 };
      groupBuckets.set(group, bucket);
    }
    bucket.positions.push({
      symbol: pos.symbol,
      netPos: pos.netPos,
      miniEquivalent: exposureMillis / MILLIS_PER_UNIT,
    });
    bucket.totalMillis += exposureMillis;
  }

  return {
    totalMiniEquivalent: totalMillis / MILLIS_PER_UNIT,
    byRoot: Array.from(groupBuckets.values()).map((b) => ({
      root: b.root,
      positions: b.positions,
      totalMiniEquivalent: b.totalMillis / MILLIS_PER_UNIT,
    })),
    unsupported,
  };
}

/**
 * Decision result for the max-position-size enforcement check, combining
 * exposure computation, breach detection, and unsupported-symbol policy.
 */
export type MaxPositionSizeDecision = {
  /** Whether the sync should fire the max_position_size enforcement trigger. */
  shouldTrigger: boolean;
  /** Standard-equivalent exposure summed across known pairs (informational; 0 when no positions). */
  totalMiniEquivalent: number;
  /** True when at least one open position is in a symbol Guardrail can't classify. */
  hasUnsupportedPositions: boolean;
  /** List of unsupported symbols, populated only when hasUnsupportedPositions is true. */
  unsupportedSymbols: string[];
  /**
   * Discriminator for the breach kind:
   *   "exposure"     — standard-equivalent total exceeds the limit
   *   "unsupported"  — at least one position is in a symbol we can't verify
   *   null           — no breach (no trigger)
   */
  reasonKind: "exposure" | "unsupported" | null;
  /** Human-readable reason string for GuardianIntervention.message; null when no breach. */
  reason: string | null;
};

/**
 * Decide whether the max_position_size enforcement trigger should fire.
 *
 * Pure function. No I/O. No broker calls. No DB.
 *
 * Policy:
 *   - maxContracts null / ≤ 0 → no rule configured → never triggers.
 *   - Any unsupported open position when a rule IS configured → trigger
 *     ("unsupported"). Rationale: if Guardrail can't verify the exposure,
 *     it cannot honestly enforce a max — and silently passing the breach
 *     is the unsafe direction. This is the documented safer behavior.
 *   - Otherwise compare totalMiniEquivalent > maxContracts (strict >).
 */
export function deriveMaxPositionSizeBreach(opts: {
  positions: PositionExposureInput[];
  maxContracts: number | null;
}): MaxPositionSizeDecision {
  const { positions, maxContracts } = opts;

  if (maxContracts === null || maxContracts <= 0) {
    return {
      shouldTrigger: false,
      totalMiniEquivalent: 0,
      hasUnsupportedPositions: false,
      unsupportedSymbols: [],
      reasonKind: null,
      reason: null,
    };
  }

  const exposure = computeMiniEquivalentExposure(positions);
  const unsupportedSymbols = exposure.unsupported.map((u) => u.symbol);

  if (unsupportedSymbols.length > 0) {
    return {
      shouldTrigger: true,
      totalMiniEquivalent: exposure.totalMiniEquivalent,
      hasUnsupportedPositions: true,
      unsupportedSymbols,
      reasonKind: "unsupported",
      reason:
        `Position uses an unsupported symbol, so Guardrail cannot verify max position size safely ` +
        `(${unsupportedSymbols.join(", ")}).`,
    };
  }

  if (isMaxPositionSizeBreached(exposure.totalMiniEquivalent, maxContracts)) {
    return {
      shouldTrigger: true,
      totalMiniEquivalent: exposure.totalMiniEquivalent,
      hasUnsupportedPositions: false,
      unsupportedSymbols: [],
      reasonKind: "exposure",
      reason:
        `Max position size exceeded: ${exposure.totalMiniEquivalent} standard-equivalent ` +
        `contracts open (limit: ${maxContracts}).`,
    };
  }

  return {
    shouldTrigger: false,
    totalMiniEquivalent: exposure.totalMiniEquivalent,
    hasUnsupportedPositions: false,
    unsupportedSymbols: [],
    reasonKind: null,
    reason: null,
  };
}

/**
 * Returns true if total standard-equivalent exposure strictly exceeds the
 * configured limit. Equality is allowed.
 *
 * - maxPositionSize === null → no rule configured, never breaches.
 * - maxPositionSize === 0    → any non-zero exposure breaches.
 * - maxPositionSize  <  0    → invalid, treated as no rule (never breaches).
 *
 * Comparison is performed in integer millis (×1000) to neutralize
 * IEEE-754 drift at the boundary (e.g. 11 * 0.1 === 1.1000000000000001).
 */
export function isMaxPositionSizeBreached(
  totalMiniEquivalent: number,
  maxPositionSize: number | null,
): boolean {
  if (maxPositionSize === null) return false;
  if (maxPositionSize < 0) return false;
  const totalMillis = Math.round(totalMiniEquivalent * MILLIS_PER_UNIT);
  const limitMillis = Math.round(maxPositionSize * MILLIS_PER_UNIT);
  return totalMillis > limitMillis;
}
