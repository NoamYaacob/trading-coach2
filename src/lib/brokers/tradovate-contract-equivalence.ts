/**
 * Mini-equivalent contract equivalence helpers for CME equity index futures.
 *
 * Tradovate's UserAccountPositionLimit (totalBy="Overall") enforces a single
 * raw contract count across ALL positions simultaneously. It cannot express
 * the equivalence between mini and micro contracts. This module provides the
 * conversion layer so the rest of Guardrail can reason in mini-equivalents
 * while communicating accurately about what the broker actually enforces.
 *
 * Mini-equivalent multipliers (how many minis one contract of each root equals):
 *   1   — full-size mini (NQ, ES, YM, RTY)
 *   0.1 — micro (MNQ, MES, MYM, M2K)
 *
 * Example: maxMiniEquivalent=1 → NQ raw limit = 1, MNQ raw limit = 10
 *
 * No I/O. No broker calls. No DB. Pure and deterministic.
 */

// Tenths of a mini per contract (integer arithmetic avoids IEEE-754 drift).
//   1 mini  = 10 tenths
//   1 micro = 1  tenth
const TENTHS_PER_CONTRACT: Record<string, number> = {
  NQ:  10,
  MNQ:  1,
  ES:  10,
  MES:  1,
  YM:  10,
  MYM:  1,
  RTY: 10,
  M2K:  1,
};

/**
 * Returns the mini-equivalent value of one contract with the given symbol root.
 * - NQ, ES, YM, RTY → 1.0
 * - MNQ, MES, MYM, M2K → 0.1
 * - Unknown roots → 1.0 (safe fallback: never understates exposure)
 */
export function getMiniEquivalentMultiplier(symbolRoot: string): number {
  const tenths = TENTHS_PER_CONTRACT[symbolRoot.toUpperCase()];
  return tenths !== undefined ? tenths / 10 : 1;
}

/**
 * Returns the raw integer contract count that corresponds to maxMiniEquivalent
 * for the given symbol root.
 *
 * toRawContractLimit(1, "MNQ") → 10   (1 mini / 0.1 = 10 MNQ contracts)
 * toRawContractLimit(2, "MNQ") → 20
 * toRawContractLimit(1, "NQ")  → 1    (1 mini / 1.0 = 1 NQ contract)
 * toRawContractLimit(1, "???") → 1    (unknown root: 1:1 fallback)
 *
 * Arithmetic is performed in integer tenths to avoid floating-point error
 * at the boundary (e.g. 11 * 0.1 === 1.1000000000000001 in IEEE-754).
 */
export function toRawContractLimit(maxMiniEquivalent: number, symbolRoot: string): number {
  const tenths = TENTHS_PER_CONTRACT[symbolRoot.toUpperCase()];
  if (tenths === undefined) return Math.ceil(maxMiniEquivalent);
  // maxMiniEquivalent × 10 = total tenths; divide by tenths_per_contract.
  return Math.ceil((maxMiniEquivalent * 10) / tenths);
}

/**
 * Returns true when the symbol root is in the known mini/micro equivalence table.
 * Unknown roots should never be over-claimed as mini-equivalent enforced.
 */
export function isSupportedSymbolRoot(symbolRoot: string): boolean {
  return symbolRoot.toUpperCase() in TENTHS_PER_CONTRACT;
}

/**
 * Returns all supported symbol roots (used for display and debug endpoints).
 */
export function getSupportedSymbolRoots(): string[] {
  return Object.keys(TENTHS_PER_CONTRACT);
}

/**
 * Builds an example map showing raw contract limits for all supported roots
 * given a maxMiniEquivalent value. Useful for debug endpoints and UI hints.
 *
 * effectiveRawLimits(1) → { NQ: 1, MNQ: 10, ES: 1, MES: 10, YM: 1, MYM: 10, RTY: 1, M2K: 10 }
 */
export function effectiveRawLimits(maxMiniEquivalent: number): Record<string, number> {
  return Object.fromEntries(
    Object.keys(TENTHS_PER_CONTRACT).map((root) => [root, toRawContractLimit(maxMiniEquivalent, root)]),
  );
}
