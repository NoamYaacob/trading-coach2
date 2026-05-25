"use client";

/**
 * Contract limits by symbol — collapsed advanced row.
 *
 * Replaces the previous Position & symbol controls card. Max standard-
 * equivalent contracts moved to the Core rules card; what remains here is
 * the optional per-symbol cap table.
 *
 * Default: collapsed. The user sees only the row title, the "Saved" status
 * pill, and the chevron until they expand.
 *
 * Expanded + no rows: compact empty state with a single "+ Add symbol limit"
 * trigger. No select / input / Add-limit composer rendered.
 *
 * Expanded + rows present (or after trigger click): full SymbolLimitsTable.
 *
 * Notes:
 *   - The collapsed wrapper is a <details> with aria-label="Contract limits by
 *     symbol" so source-scan tests can locate it without DOM.
 *   - Symbol blocks is intentionally NOT shown here — it lives in the
 *     collapsed PlannedRulesSection.
 *   - Evaluator wiring is not yet active. Copy must reflect that.
 */
import { useState } from "react";
import { SYMBOL_LIMITS_COPY } from "../position-size-copy";
import { SymbolLimitsTable, type SymbolLimitRow } from "../symbol-limits-table";
import { RuleStatusBadge } from "../rule-status-badge";

type Props = {
  value: SymbolLimitRow[];
  onChange: (rows: SymbolLimitRow[]) => void;
  /** Disables the SymbolLimitsTable's add/remove controls when the parent
   *  fieldset is disabled. */
  disabled: boolean;
};

export function SymbolLimitsRow({ value, onChange, disabled }: Props) {
  // Inside-the-row state: editor stays collapsed until first +Add click,
  // unless rows already exist (then editor is the only sensible default).
  const [symbolEditorOpen, setSymbolEditorOpen] = useState(false);
  const showSymbolEditor = symbolEditorOpen || value.length > 0;
  const validCount = value.filter((r) => r.symbol.trim() && r.maxContracts.trim()).length;

  return (
    <details
      className="group rounded-2xl border border-stone-200 bg-white/70 px-3 py-2.5 sm:px-4 sm:py-3"
      aria-label="Contract limits by symbol"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-stone-700">
        <span className="flex items-center gap-2">
          {SYMBOL_LIMITS_COPY.heading}
          <RuleStatusBadge variant="saved-eval-soon" compact />
          <span className="text-xs font-normal text-stone-400">
            {validCount > 0 ? `${validCount} set` : "None set"}
          </span>
        </span>
        <span aria-hidden className="text-stone-400 transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="mt-3 grid gap-2.5">
        {!showSymbolEditor ? (
          <div className="grid gap-1.5">
            <button
              type="button"
              onClick={() => setSymbolEditorOpen(true)}
              disabled={disabled}
              className="inline-flex w-fit items-center gap-1 text-xs font-medium text-stone-500 hover:text-stone-800 disabled:cursor-not-allowed"
              data-testid="add-symbol-limit-trigger"
            >
              <span aria-hidden>+</span> Add symbol limit
            </button>
            <p className="text-xs text-stone-400">
              Optional per-symbol caps. Evaluation coming soon.
            </p>
          </div>
        ) : (
          <>
            <SymbolLimitsTable value={value} onChange={onChange} disabled={disabled} />
            <details className="group/inner text-xs text-stone-400">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 hover:text-stone-600">
                <span className="text-[10px]">Learn more</span>
                <span aria-hidden className="text-[10px] transition-transform group-open/inner:rotate-45">+</span>
              </summary>
              <p className="mt-1 text-stone-500">{SYMBOL_LIMITS_COPY.description}</p>
              <p className="mt-1 text-stone-500">{SYMBOL_LIMITS_COPY.globalFallbackNote}</p>
            </details>
          </>
        )}
      </div>
    </details>
  );
}
