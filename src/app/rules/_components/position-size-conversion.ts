/**
 * Pure helper for the Max position size conversion table.
 *
 * Converts a Guardrail max standard-equivalent value into the per-product raw
 * contract limits that Guardrail will enforce app-side (detection-response).
 *
 * Apex model: 10 micro = 1 standard. For max=2:
 *   NQ ≤ 2  · MNQ ≤ 20
 *   ES ≤ 2  · MES ≤ 20
 *   YM ≤ 2  · MYM ≤ 20
 *   RTY ≤ 2 · M2K ≤ 20
 *
 * No I/O. Used by the React conversion-table component and unit tests alike.
 */

import { effectiveSupportedRawLimits, getContractMetadata } from "../../../lib/futures/contracts.ts";

export type ConversionRow = {
  /** Standard parent root (e.g. "NQ"). */
  parentRoot: string;
  /** Raw contract limit for the standard contract. */
  parentLimit: number;
  /** Micro root (e.g. "MNQ"). */
  microRoot: string;
  /** Raw contract limit for the micro contract. */
  microLimit: number;
};

const PARENT_ORDER = ["NQ", "ES", "YM", "RTY"] as const;

/**
 * Returns one row per supported standard/micro pair (NQ/MNQ, ES/MES, YM/MYM, RTY/M2K).
 *
 * Returns [] when maxContracts is not a positive finite number.
 */
export function buildConversionRows(maxContracts: number): ConversionRow[] {
  if (!Number.isFinite(maxContracts) || maxContracts <= 0) return [];

  const limits = effectiveSupportedRawLimits(maxContracts);
  const entries = Object.entries(limits);

  // Group entries by parent root: for each standard, find its matching micro.
  const rows: ConversionRow[] = [];
  for (const [root, raw] of entries) {
    const meta = getContractMetadata(root);
    if (!meta || meta.sizeClass !== "standard") continue;
    const microEntry = entries.find(([r]) => {
      const m = getContractMetadata(r);
      return m?.parentRoot === root && m?.sizeClass === "micro";
    });
    if (!microEntry) continue;
    rows.push({
      parentRoot: root,
      parentLimit: raw,
      microRoot: microEntry[0],
      microLimit: microEntry[1],
    });
  }

  // Canonical display order matches the user's mental model: NQ, ES, YM, RTY.
  rows.sort(
    (a, b) =>
      PARENT_ORDER.indexOf(a.parentRoot as (typeof PARENT_ORDER)[number]) -
      PARENT_ORDER.indexOf(b.parentRoot as (typeof PARENT_ORDER)[number]),
  );
  return rows;
}
