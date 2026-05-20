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
import { resolveSymbolLimit, type SymbolLimit } from "../futures/symbol-limits.ts";

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
 * Two modes:
 *   - No per-symbol limits (`symbolLimits` null/empty): legacy aggregate check
 *     — total standard-equivalent exposure across all positions vs the single
 *     global `maxContracts` limit. Behavior is unchanged.
 *   - Per-symbol limits configured: each open symbol root is evaluated against
 *     its own resolved limit — the symbol-specific raw limit when one exists,
 *     otherwise the global `maxContracts` standard-equivalent fallback. A
 *     breach on any single root triggers.
 *
 * Policy (both modes):
 *   - No applicable limit for a position → never triggers on it.
 *   - Any unsupported open position when a rule IS configured → trigger
 *     ("unsupported"). Rationale: if Guardrail can't verify the exposure,
 *     it cannot honestly enforce a max — and silently passing the breach
 *     is the unsafe direction. This is the documented safer behavior.
 *   - Otherwise compare exposure > limit (strict >, equality allowed).
 */
export function deriveMaxPositionSizeBreach(opts: {
  positions: PositionExposureInput[];
  maxContracts: number | null;
  /**
   * Per-symbol raw contract limits. When non-empty, each open symbol root is
   * evaluated against its own resolved limit instead of the aggregate total.
   * When null/undefined/empty, the legacy aggregate check is used unchanged.
   */
  symbolLimits?: SymbolLimit[] | null;
}): MaxPositionSizeDecision {
  const { positions, maxContracts } = opts;
  const symbolLimits = opts.symbolLimits ?? [];

  if (symbolLimits.length > 0) {
    return derivePerSymbolMaxPositionSizeBreach(positions, maxContracts, symbolLimits);
  }

  // ── Legacy aggregate behavior — unchanged when no per-symbol limits ───────
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
 * Per-symbol max-position-size evaluation (Phase 4C).
 *
 * Each open position's registry root is grouped, and each root is compared
 * against its own resolved limit:
 *   - Symbol-specific limit: a RAW per-symbol contract count. Converted to
 *     standard-equivalent millis with the symbol's own ratio for comparison.
 *   - No symbol-specific limit: falls back to the global `maxContracts`, which
 *     is already a standard-equivalent value.
 *   - No symbol-specific limit and no global fallback: no rule for that root.
 *
 * `resolveSymbolLimit(root, symbolLimits, null)` is called with a null fallback
 * so a non-null result is unambiguously the symbol-specific RAW limit, keeping
 * the two limit unit systems (raw per-symbol vs standard-equivalent global)
 * correctly separated.
 *
 * Pure. No I/O. No broker calls.
 */
function derivePerSymbolMaxPositionSizeBreach(
  positions: PositionExposureInput[],
  globalMaxContracts: number | null,
  symbolLimits: SymbolLimit[],
): MaxPositionSizeDecision {
  const exposure = computeMiniEquivalentExposure(positions);
  const unsupportedSymbols = exposure.unsupported.map((u) => u.symbol);

  // A max-contracts rule IS configured (symbolLimits is non-empty), so an
  // unsupported position keeps the existing conservative policy — Guardrail
  // can't verify the exposure, so it triggers rather than silently passing.
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

  // Group supported positions by their OWN registry root (NQ, MNQ, ES, ...).
  // ExposureResult.byRoot groups by PARENT root, which merges NQ + MNQ — wrong
  // for per-symbol limits, so the own-root grouping is computed here.
  const byOwnRoot = new Map<string, { exposureMillis: number; ratioMillis: number }>();
  for (const pos of positions) {
    if (pos.netPos === 0) continue;
    const meta = getContractMetadata(pos.symbol);
    if (meta === null) continue; // unsupported positions handled above
    const ratioMillis = Math.round(meta.exposureRatioToParent * MILLIS_PER_UNIT);
    const exposureMillis = Math.abs(pos.netPos) * ratioMillis;
    const bucket = byOwnRoot.get(meta.symbolRoot);
    if (bucket) {
      bucket.exposureMillis += exposureMillis;
    } else {
      byOwnRoot.set(meta.symbolRoot, { exposureMillis, ratioMillis });
    }
  }

  for (const [root, bucket] of byOwnRoot) {
    // null fallback isolates the symbol-specific limit: non-null = a raw
    // per-symbol limit; null = no specific rule for this root.
    const specificRawLimit = resolveSymbolLimit(root, symbolLimits, null);

    let limitMillis: number;
    if (specificRawLimit !== null) {
      // Symbol-specific limit is RAW contracts → convert to standard-equivalent
      // millis with the symbol's own ratio (existing metadata conversion).
      limitMillis = specificRawLimit * bucket.ratioMillis;
    } else if (globalMaxContracts !== null && globalMaxContracts > 0) {
      // Fallback: the global maxContracts is already standard-equivalent.
      limitMillis = Math.round(globalMaxContracts * MILLIS_PER_UNIT);
    } else {
      // No symbol-specific limit and no global fallback → no rule for this root.
      continue;
    }

    if (bucket.exposureMillis > limitMillis) {
      const exposureEquiv = bucket.exposureMillis / MILLIS_PER_UNIT;
      const limitEquiv = limitMillis / MILLIS_PER_UNIT;
      return {
        shouldTrigger: true,
        totalMiniEquivalent: exposure.totalMiniEquivalent,
        hasUnsupportedPositions: false,
        unsupportedSymbols: [],
        reasonKind: "exposure",
        reason:
          `Max position size exceeded for ${root}: ${exposureEquiv} standard-equivalent ` +
          `contracts open (limit: ${limitEquiv}).`,
      };
    }
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
