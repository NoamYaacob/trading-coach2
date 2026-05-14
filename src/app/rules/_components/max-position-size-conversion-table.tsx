/**
 * Renders the per-product raw-contract conversion for the user's Max
 * standard-equivalent contracts value.
 *
 * For maxContracts="2", shows:
 *   NQ ≤ 2  · MNQ ≤ 20
 *   ES ≤ 2  · MES ≤ 20
 *   YM ≤ 2  · MYM ≤ 20
 *   RTY ≤ 2 · M2K ≤ 20
 *
 * Hidden when the input is empty or not a positive integer.
 */

import { buildConversionRows } from "./position-size-conversion";

export function MaxPositionSizeConversionTable({
  maxContracts,
}: {
  maxContracts: string;
}) {
  const n = parseInt(maxContracts, 10);
  const rows = Number.isFinite(n) ? buildConversionRows(n) : [];
  if (rows.length === 0) return null;

  return (
    <div
      className="mt-1 grid gap-0.5 rounded-md border border-stone-200 bg-stone-50 px-2 py-1.5 text-xs text-stone-600"
      data-testid="max-position-size-conversion-table"
    >
      <span className="text-[11px] font-medium uppercase tracking-wide text-stone-500">
        Enforced raw limits per product (Guardrail detection-response)
      </span>
      {rows.map((row) => (
        <span key={row.parentRoot} className="font-mono">
          {row.parentRoot} ≤ {row.parentLimit} · {row.microRoot} ≤ {row.microLimit}
        </span>
      ))}
    </div>
  );
}
