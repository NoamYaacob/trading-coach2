/**
 * Pure helpers for symbol-specific max-contract limits (Phase 4 foundation).
 *
 * Per-symbol limits are stored on AccountRiskRules.maxContractsBySymbolJson
 * (and RiskRules.maxContractsBySymbolJson) as a JSON string array:
 *   [{ "symbol": "NQ", "maxContracts": 2 }, { "symbol": "MNQ", "maxContracts": 10 }]
 *
 * No I/O. No broker calls. No DB. Pure and deterministic.
 *
 * Phase A scope: parsing, validation, and the resolve function only.
 * UI rendering and guardian-evaluator integration are intentionally NOT wired
 * here — those are later phases.
 */

import {
  getContractMetadata,
  normalizeSymbolRoot,
  toParentEquivalentContracts,
} from "./contracts.ts";

export type SymbolLimit = {
  /** Canonical uppercase symbol root, e.g. "NQ", "MNQ". */
  symbol: string;
  /** Raw contract limit for this symbol. Positive integer. */
  maxContracts: number;
};

/** Upper bound for a single symbol limit. Mirrors the global maxContracts cap. */
export const MAX_SYMBOL_CONTRACTS = 1000;

/**
 * v1 allowlist of symbols selectable in the symbol picker.
 *
 * Free-text symbol entry is intentionally disabled for v1 — every symbol here
 * must exist in the futures registry (contracts.ts). Symbols outside this set
 * are rejected by validation. A unit test asserts every entry resolves to a
 * registry contract.
 *
 * SIL (E-Micro Silver) is deliberately excluded: its registry
 * exposureRatioToParent (0.001) is pending verification against the CME spec.
 * EUREX products are deferred to a later phase.
 */
export const SUPPORTED_PICKER_SYMBOLS: readonly string[] = [
  // Equity index
  "ES", "MES", "NQ", "MNQ", "YM", "MYM", "RTY", "M2K", "NKD", "EMD",
  // Energy
  "CL", "MCL", "QM", "NG", "QG", "HO", "RB",
  // Metals (SIL excluded in v1 — exposureRatioToParent pending verification)
  "GC", "MGC", "SI", "HG", "PL", "PA",
  // FX
  "6E", "M6E", "6B", "M6B", "6J", "M6J", "6A", "M6A", "6C", "M6C", "6S", "M6S", "6N",
  // Crypto
  "MBT", "MET",
  // Agriculture
  "ZC", "ZW", "KE", "ZS", "ZM", "ZL", "LE", "HE", "GF",
  // Rates (U.S. Treasuries)
  "ZB", "UB", "ZN", "ZF", "ZT",
] as const;

const SUPPORTED_SET: ReadonlySet<string> = new Set(SUPPORTED_PICKER_SYMBOLS);

/** True when `symbol` is in the v1 picker allowlist (case-insensitive). */
export function isSupportedPickerSymbol(symbol: string): boolean {
  return SUPPORTED_SET.has(symbol.trim().toUpperCase());
}

export type SymbolLimitsValidationError = { message: string };

/**
 * Strict validation for the maxContractsBySymbolJson string submitted by the
 * API. Returns null when acceptable, or the first problem found.
 *
 * Accepts: null, undefined, "" (no symbol limits configured).
 * Rejects: malformed JSON, non-array, bad entry shape, empty/non-uppercase
 *          symbol, unsupported symbol, duplicate symbol, and a maxContracts
 *          that is not a positive integer ≤ MAX_SYMBOL_CONTRACTS.
 */
export function validateSymbolLimits(
  json: string | null | undefined,
): SymbolLimitsValidationError | null {
  if (json == null || json.trim() === "") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { message: "maxContractsBySymbolJson must be valid JSON." };
  }
  if (!Array.isArray(parsed)) {
    return { message: "maxContractsBySymbolJson must be a JSON array." };
  }

  const seen = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return { message: "Each symbol limit must be an object." };
    }
    const e = entry as Record<string, unknown>;
    const symbol = e.symbol;
    const maxContracts = e.maxContracts;

    if (typeof symbol !== "string" || symbol.trim() === "") {
      return { message: "Each symbol limit must have a non-empty symbol." };
    }
    // Symbols must be stored uppercase — the API rejects rather than silently
    // normalizing, so stored data always matches what the client submitted.
    if (symbol !== symbol.toUpperCase()) {
      return { message: `Symbol "${symbol}" must be uppercase.` };
    }
    if (!isSupportedPickerSymbol(symbol)) {
      return { message: `Symbol "${symbol}" is not a supported symbol.` };
    }
    if (seen.has(symbol)) {
      return { message: `Duplicate symbol "${symbol}".` };
    }
    seen.add(symbol);

    if (
      typeof maxContracts !== "number" ||
      !Number.isInteger(maxContracts) ||
      maxContracts < 1
    ) {
      return {
        message: `maxContracts for "${symbol}" must be a positive integer.`,
      };
    }
    if (maxContracts > MAX_SYMBOL_CONTRACTS) {
      return {
        message: `maxContracts for "${symbol}" must not exceed ${MAX_SYMBOL_CONTRACTS}.`,
      };
    }
  }

  return null;
}

/**
 * Lenient parser for the evaluator path. Returns the valid SymbolLimit entries
 * and silently drops anything malformed — never throws.
 *
 * Symbols are normalized to uppercase. Duplicate symbols keep the first entry.
 * Use validateSymbolLimits at the API boundary to reject bad input before it
 * is ever stored; this function only guards the read path against legacy or
 * partially-corrupt rows.
 */
export function parseSymbolLimits(json: string | null | undefined): SymbolLimit[] {
  if (json == null || json.trim() === "") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: SymbolLimit[] = [];
  const seen = new Set<string>();
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      continue;
    }
    const e = entry as Record<string, unknown>;
    const rawSymbol = e.symbol;
    const maxContracts = e.maxContracts;
    if (typeof rawSymbol !== "string" || rawSymbol.trim() === "") continue;
    if (
      typeof maxContracts !== "number" ||
      !Number.isInteger(maxContracts) ||
      maxContracts < 1
    ) {
      continue;
    }
    const symbol = rawSymbol.trim().toUpperCase();
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    out.push({ symbol, maxContracts });
  }
  return out;
}

/**
 * Resolves the effective raw contract limit for a traded symbol.
 *
 *   1. A symbol-specific limit exists for the symbol's registry root → use it.
 *   2. Otherwise → fall back to the global maxContracts limit.
 *   3. Neither exists → null (no limit configured; caller treats as unlimited).
 *
 * The symbol is normalized to its registry root before matching, so a
 * Tradovate contract symbol like "MNQM6" resolves against an "MNQ" entry.
 * Unknown broker symbols never match a per-symbol rule, so they fall through
 * to the global fallback — conservative: an unrecognized symbol is never
 * treated as having a looser limit than the account's global cap.
 *
 * Pure: no I/O, no DB, no broker calls.
 */
export function resolveSymbolLimit(
  symbol: string,
  limits: SymbolLimit[] | null | undefined,
  globalFallback: number | null | undefined,
): number | null {
  if (limits && limits.length > 0) {
    const root = normalizeSymbolRoot(symbol);
    const match = limits.find((l) => l.symbol.toUpperCase() === root);
    if (match !== undefined) return match.maxContracts;
  }
  return globalFallback ?? null;
}

/**
 * Builds the human-readable "Equivalent" cell for a symbol-limit row.
 *
 * Standard contracts (exposureRatioToParent === 1) have no micro/parent
 * relationship — returns "Standalone". Micro/mini contracts return the
 * parent-equivalent value of the limit, e.g. "= 1 NQ-equivalent" for a limit
 * of 10 MNQ, "= 1 CL-equivalent" for 2 QM.
 *
 * Pure — derives the ratio from registry metadata, never hardcoded. Returns ""
 * for an unknown symbol or a non-positive / non-integer maxContracts.
 */
export function describeSymbolEquivalent(symbol: string, maxContracts: number): string {
  if (!Number.isInteger(maxContracts) || maxContracts < 1) return "";
  const meta = getContractMetadata(symbol);
  if (!meta) return "";
  if (meta.exposureRatioToParent === 1) return "Standalone";
  const equiv = toParentEquivalentContracts(maxContracts, symbol);
  const equivLabel = Number.isInteger(equiv) ? String(equiv) : equiv.toFixed(2);
  return `= ${equivLabel} ${meta.parentRoot}-equivalent`;
}
