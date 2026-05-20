"use client";

import { useMemo } from "react";

import {
  SUPPORTED_PICKER_SYMBOLS,
  MAX_SYMBOL_CONTRACTS,
  describeSymbolEquivalent,
} from "@/lib/futures/symbol-limits";
import { getContractMetadata } from "@/lib/futures/contracts";

/**
 * UI editing shape for one symbol-limit row. maxContracts is a string here
 * (matching the rest of the rules form) and is parsed/serialized by the
 * parent form on submit.
 */
export type SymbolLimitRow = { symbol: string; maxContracts: string };

// Asset-class → picker group label. volatility/other collapse into "Other".
const ASSET_CLASS_LABEL: Record<string, string> = {
  equity_index: "Equity Index",
  energy: "Energy",
  metals: "Metals",
  fx: "FX",
  crypto: "Crypto",
  rates: "Rates",
  agriculture: "Agriculture",
  volatility: "Other",
  other: "Other",
};

// Display order for the dropdown <optgroup>s.
const GROUP_ORDER = [
  "Equity Index",
  "Energy",
  "Metals",
  "FX",
  "Crypto",
  "Rates",
  "Agriculture",
  "Other",
];

type SymbolOption = { symbol: string; displayName: string };

// Grouped picker options — computed once from the static registry. Only
// symbols in SUPPORTED_PICKER_SYMBOLS appear (SIL and unsupported symbols are
// already excluded by the Phase A allowlist). No free-text entry exists.
const GROUPED_SYMBOLS: ReadonlyArray<{ group: string; options: SymbolOption[] }> = (() => {
  const byGroup = new Map<string, SymbolOption[]>();
  for (const symbol of SUPPORTED_PICKER_SYMBOLS) {
    const meta = getContractMetadata(symbol);
    if (!meta) continue;
    const group = ASSET_CLASS_LABEL[meta.assetClass] ?? "Other";
    const opt: SymbolOption = { symbol, displayName: meta.displayName };
    const list = byGroup.get(group);
    if (list) list.push(opt);
    else byGroup.set(group, [opt]);
  }
  return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({
    group: g,
    options: byGroup.get(g)!,
  }));
})();

const SELECT_CLS =
  "w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm focus:border-stone-950 focus:outline-none disabled:cursor-not-allowed disabled:bg-stone-100";
const INPUT_CLS =
  "w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm focus:border-stone-950 focus:outline-none disabled:cursor-not-allowed disabled:bg-stone-100";

export function SymbolLimitsTable({
  value,
  onChange,
  disabled = false,
}: {
  value: SymbolLimitRow[];
  onChange: (rows: SymbolLimitRow[]) => void;
  disabled?: boolean;
}) {
  const usedSymbols = useMemo(
    () => new Set(value.map((r) => r.symbol.trim().toUpperCase()).filter((s) => s !== "")),
    [value],
  );

  // First registry symbol not already in the table — the default for a new row.
  const firstAvailable = SUPPORTED_PICKER_SYMBOLS.find((s) => !usedSymbols.has(s));
  const canAdd = firstAvailable !== undefined;

  function addRow() {
    if (disabled || firstAvailable === undefined) return;
    onChange([...value, { symbol: firstAvailable, maxContracts: "1" }]);
  }

  function removeRow(index: number) {
    if (disabled) return;
    onChange(value.filter((_, i) => i !== index));
  }

  function updateRow(index: number, patch: Partial<SymbolLimitRow>) {
    if (disabled) return;
    onChange(value.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  return (
    <div className="grid gap-2" data-testid="symbol-limits-table">
      {value.length > 0 && (
        <div className="grid gap-1.5">
          <div className="grid grid-cols-[1fr_84px_1fr_auto] gap-2 px-0.5 text-[10px] font-medium uppercase tracking-wide text-stone-400">
            <span>Symbol</span>
            <span>Max contracts</span>
            <span>Equivalent</span>
            <span className="sr-only">Remove</span>
          </div>
          {value.map((row, index) => {
            const n = parseInt(row.maxContracts, 10);
            const invalid =
              !Number.isInteger(n) || n < 1 || n > MAX_SYMBOL_CONTRACTS;
            const equivalent = invalid ? "" : describeSymbolEquivalent(row.symbol, n);
            return (
              <div
                key={index}
                className="grid grid-cols-[1fr_84px_1fr_auto] items-center gap-2"
              >
                {/* Symbol — registry dropdown only; no free-text entry.
                    Options exclude symbols already used in other rows. */}
                <select
                  value={row.symbol}
                  disabled={disabled}
                  onChange={(e) => updateRow(index, { symbol: e.target.value })}
                  aria-label="Symbol"
                  className={SELECT_CLS}
                >
                  {GROUPED_SYMBOLS.map(({ group, options }) => {
                    const opts = options.filter(
                      (o) => o.symbol === row.symbol || !usedSymbols.has(o.symbol),
                    );
                    if (opts.length === 0) return null;
                    return (
                      <optgroup key={group} label={group}>
                        {opts.map((o) => (
                          <option key={o.symbol} value={o.symbol}>
                            {o.symbol} — {o.displayName}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_SYMBOL_CONTRACTS}
                  step={1}
                  value={row.maxContracts}
                  disabled={disabled}
                  aria-label={`Max contracts for ${row.symbol}`}
                  onChange={(e) => updateRow(index, { maxContracts: e.target.value })}
                  className={INPUT_CLS}
                />
                <span
                  className={`truncate text-xs ${invalid ? "text-red-600" : "text-stone-500"}`}
                >
                  {invalid ? "Enter 1–1000" : equivalent}
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removeRow(index)}
                  aria-label={`Remove ${row.symbol} limit`}
                  className="rounded-lg border border-stone-200 px-2 py-1.5 text-xs font-medium text-stone-500 transition hover:border-stone-400 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}
      <button
        type="button"
        disabled={disabled || !canAdd}
        onClick={addRow}
        className="justify-self-start rounded-full border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-600 transition hover:border-stone-400 hover:text-stone-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        + Add symbol
      </button>
    </div>
  );
}
