"use client";

import { useMemo, useState } from "react";

import {
  SUPPORTED_PICKER_SYMBOLS,
  MAX_SYMBOL_CONTRACTS,
  describeSymbolEquivalent,
} from "@/lib/futures/symbol-limits";
import { getContractMetadata } from "@/lib/futures/contracts";
import { SYMBOL_LIMITS_COPY } from "./position-size-copy";

/**
 * One configured contract limit. maxContracts is a string here (matching the
 * rest of the rules form) and is parsed/serialized by the parent form.
 * `symbol` is always the plain registry root (e.g. "NQ") — never the slash
 * display form.
 */
export type SymbolLimitRow = { symbol: string; maxContracts: string };

// Asset-class → market group label. volatility/other collapse into "Other".
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

// Market groups are a secondary organizing aid — not the primary mental model.
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

/** TopstepX-style display form. The stored value stays the plain root. */
function displaySymbol(symbol: string): string {
  return `/${symbol}`;
}

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
  // Symbols already configured — excluded from the Add-limit dropdown.
  const usedSymbols = useMemo(
    () => new Set(value.map((r) => r.symbol.trim().toUpperCase()).filter((s) => s !== "")),
    [value],
  );

  // Local "draft" state for the Add-limit composer row.
  const [draftSymbol, setDraftSymbol] = useState("");
  const [draftLimit, setDraftLimit] = useState("");

  const draftLimitNum = parseInt(draftLimit, 10);
  const draftLimitValid =
    Number.isInteger(draftLimitNum) &&
    draftLimitNum >= 1 &&
    draftLimitNum <= MAX_SYMBOL_CONTRACTS;
  const canAdd = !disabled && draftSymbol !== "" && draftLimitValid;

  const availableGroups = useMemo(
    () =>
      GROUPED_SYMBOLS.map((g) => ({
        group: g.group,
        options: g.options.filter((o) => !usedSymbols.has(o.symbol)),
      })).filter((g) => g.options.length > 0),
    [usedSymbols],
  );

  function addLimit() {
    if (!canAdd) return;
    onChange([...value, { symbol: draftSymbol, maxContracts: String(draftLimitNum) }]);
    setDraftSymbol("");
    setDraftLimit("");
  }

  function removeLimit(index: number) {
    if (disabled) return;
    onChange(value.filter((_, i) => i !== index));
  }

  return (
    <div className="grid gap-3" data-testid="symbol-limits-table">
      {/* ── Add-limit composer row (Symbol · Limit · Add limit) ─────────────── */}
      <div className="grid gap-1">
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-[180px] flex-1 gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-stone-400">
              Symbol
            </span>
            <select
              value={draftSymbol}
              disabled={disabled}
              aria-label="Symbol"
              onChange={(e) => setDraftSymbol(e.target.value)}
              className={SELECT_CLS}
            >
              <option value="">Select a symbol…</option>
              {availableGroups.map(({ group, options }) => (
                <optgroup key={group} label={group}>
                  {options.map((o) => (
                    <option key={o.symbol} value={o.symbol}>
                      {displaySymbol(o.symbol)} — {o.displayName}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="grid w-20 gap-1">
            <span className="text-[10px] font-medium uppercase tracking-wide text-stone-400">
              Limit
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_SYMBOL_CONTRACTS}
              step={1}
              value={draftLimit}
              disabled={disabled}
              placeholder="1"
              aria-label="Contract limit"
              onChange={(e) => setDraftLimit(e.target.value)}
              className={INPUT_CLS}
            />
          </label>
          <button
            type="button"
            disabled={!canAdd}
            onClick={addLimit}
            className="rounded-full bg-stone-950 px-4 py-1.5 text-xs font-medium text-stone-50 transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add limit
          </button>
        </div>
        {draftLimit.trim() !== "" && !draftLimitValid && (
          <span className="text-xs text-red-600">
            Enter a whole number from 1 to {MAX_SYMBOL_CONTRACTS}.
          </span>
        )}
      </div>

      {/* ── Current contract limits list ───────────────────────────────────── */}
      <div className="grid gap-1.5">
        <p className="text-[10px] font-medium uppercase tracking-wide text-stone-400">
          {SYMBOL_LIMITS_COPY.currentHeading}
        </p>
        {value.length === 0 ? (
          <p className="text-xs text-stone-400">{SYMBOL_LIMITS_COPY.emptyState}</p>
        ) : (
          <ul className="grid gap-1.5">
            {value.map((row, index) => {
              const n = parseInt(row.maxContracts, 10);
              const equivalent = describeSymbolEquivalent(row.symbol, n);
              const countLabel = `Max ${row.maxContracts} contract${n === 1 ? "" : "s"}`;
              return (
                <li
                  key={index}
                  className="flex items-center justify-between gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2"
                >
                  <span className="min-w-0 truncate text-sm">
                    <span className="font-medium text-stone-900">
                      {displaySymbol(row.symbol)}
                    </span>
                    <span className="text-stone-500"> · {countLabel}</span>
                    {equivalent !== "" && (
                      <span className="text-[11px] text-stone-400"> · {equivalent}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => removeLimit(index)}
                    aria-label={`Remove ${row.symbol} limit`}
                    className="shrink-0 rounded-lg border border-stone-200 px-2 py-1 text-xs font-medium text-stone-500 transition hover:border-stone-400 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
