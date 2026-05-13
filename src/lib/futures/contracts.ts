/**
 * Central futures contract metadata registry.
 *
 * Guardrail uses this module as the single source of truth for:
 *   - Mini-equivalent exposure calculations
 *   - Position-size limit enforcement (app-side and broker-side)
 *   - UI copy and debug endpoints
 *   - Future broker-side per-product enforcement decisions
 *
 * IMPORTANT — Tradovate broker enforcement note:
 *   Tradovate's UserAccountPositionLimit (totalBy="Overall") enforces a single
 *   raw contract count across ALL open positions simultaneously. It cannot express
 *   mini-equivalent weighting (e.g., 10 MNQ = 1 NQ-equivalent). Broker-side
 *   product-specific limits (totalBy="PerContract" or "PerProduct") exist in the
 *   Tradovate type definition but have NOT been verified against a live account.
 *   Until verified, exact mini-equivalent enforcement is Guardrail-side (app-level) only.
 *   The global raw hard limit is NOT applied automatically because setting it to
 *   maxContracts=1 would incorrectly block 2 MNQ (0.2 NQ-equivalent, within limit).
 *
 * No I/O. No broker calls. No DB. Pure and deterministic.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type ContractSizeClass = "micro" | "mini" | "standard" | "other";

export type ContractExchange =
  | "CME"
  | "CBOT"
  | "NYMEX"
  | "COMEX"
  | "ICE"
  | "EUREX"
  | "OTHER";

export type ContractAssetClass =
  | "equity_index"
  | "metals"
  | "energy"
  | "rates"
  | "fx"
  | "crypto"
  | "agriculture"
  | "other";

export type FuturesContractMetadata = {
  /** Canonical symbol root (uppercase, no month/year suffix). */
  symbolRoot: string;
  /** Human-readable product name. */
  displayName: string;
  exchange: ContractExchange;
  assetClass: ContractAssetClass;
  sizeClass: ContractSizeClass;
  /**
   * Root of the parent contract in the mini/micro pair.
   * Self-referential for the "full" member of the pair (e.g. NQ → "NQ").
   * Points to the parent for micros (e.g. MNQ → "NQ").
   */
  parentRoot: string;
  /**
   * How much one contract of this root counts toward the parent-equivalent limit.
   *   NQ: 1.0   (it IS the parent)
   *   MNQ: 0.1  (1/10 of an NQ)
   *   BTC: 1.0  (5 BTC per contract, parent)
   *   MBT: 0.02 (0.1 BTC per contract / 5 BTC per BTC = 0.02)
   */
  exposureRatioToParent: number;
  /** Notional dollar value per point move. Null when not yet verified. */
  pointValueUsd?: number;
  /** Minimum price increment. */
  tickSize?: number;
  /** Dollar value of one tick move. */
  tickValueUsd?: number;
  /** Alternative root spellings Tradovate may return for this contract. */
  aliases?: string[];
  /**
   * True when this root is part of a verified mini/micro equivalence pair that
   * Guardrail can reliably enforce using the parent-equivalent exposure model.
   * Set to false for products where the contract spec has not been cross-checked
   * against the official exchange source (CME Group, NYMEX, COMEX, etc.).
   */
  supportedForMiniEquivalent: boolean;
};

// ── Registry ──────────────────────────────────────────────────────────────────

const REGISTRY: readonly FuturesContractMetadata[] = [
  // ── CME Equity Index ───────────────────────────────────────────────────────
  {
    symbolRoot: "ES",
    displayName: "E-mini S&P 500",
    exchange: "CME",
    assetClass: "equity_index",
    sizeClass: "mini",
    parentRoot: "ES",
    exposureRatioToParent: 1,
    pointValueUsd: 50,
    tickSize: 0.25,
    tickValueUsd: 12.5,
    supportedForMiniEquivalent: true,
  },
  {
    symbolRoot: "MES",
    displayName: "Micro E-mini S&P 500",
    exchange: "CME",
    assetClass: "equity_index",
    sizeClass: "micro",
    parentRoot: "ES",
    exposureRatioToParent: 0.1,
    pointValueUsd: 5,
    tickSize: 0.25,
    tickValueUsd: 1.25,
    supportedForMiniEquivalent: true,
  },
  {
    symbolRoot: "NQ",
    displayName: "E-mini Nasdaq-100",
    exchange: "CME",
    assetClass: "equity_index",
    sizeClass: "mini",
    parentRoot: "NQ",
    exposureRatioToParent: 1,
    pointValueUsd: 20,
    tickSize: 0.25,
    tickValueUsd: 5,
    supportedForMiniEquivalent: true,
  },
  {
    symbolRoot: "MNQ",
    displayName: "Micro E-mini Nasdaq-100",
    exchange: "CME",
    assetClass: "equity_index",
    sizeClass: "micro",
    parentRoot: "NQ",
    exposureRatioToParent: 0.1,
    pointValueUsd: 2,
    tickSize: 0.25,
    tickValueUsd: 0.5,
    supportedForMiniEquivalent: true,
  },
  {
    symbolRoot: "YM",
    displayName: "E-mini Dow Jones Industrial Average",
    exchange: "CBOT",
    assetClass: "equity_index",
    sizeClass: "mini",
    parentRoot: "YM",
    exposureRatioToParent: 1,
    pointValueUsd: 5,
    tickSize: 1,
    tickValueUsd: 5,
    supportedForMiniEquivalent: true,
  },
  {
    symbolRoot: "MYM",
    displayName: "Micro E-mini Dow Jones",
    exchange: "CBOT",
    assetClass: "equity_index",
    sizeClass: "micro",
    parentRoot: "YM",
    exposureRatioToParent: 0.1,
    pointValueUsd: 0.5,
    tickSize: 1,
    tickValueUsd: 0.5,
    supportedForMiniEquivalent: true,
  },
  {
    symbolRoot: "RTY",
    displayName: "E-mini Russell 2000",
    exchange: "CME",
    assetClass: "equity_index",
    sizeClass: "mini",
    parentRoot: "RTY",
    exposureRatioToParent: 1,
    pointValueUsd: 50,
    tickSize: 0.1,
    tickValueUsd: 5,
    supportedForMiniEquivalent: true,
  },
  {
    symbolRoot: "M2K",
    displayName: "Micro E-mini Russell 2000",
    exchange: "CME",
    assetClass: "equity_index",
    sizeClass: "micro",
    parentRoot: "RTY",
    exposureRatioToParent: 0.1,
    pointValueUsd: 5,
    tickSize: 0.1,
    tickValueUsd: 0.5,
    supportedForMiniEquivalent: true,
  },

  // ── COMEX Metals ───────────────────────────────────────────────────────────
  // Included for completeness; contract specs sourced from CME Group product
  // pages but not yet confirmed against a live Tradovate symbol feed.
  {
    symbolRoot: "GC",
    displayName: "Gold Futures",
    exchange: "COMEX",
    assetClass: "metals",
    sizeClass: "standard",
    parentRoot: "GC",
    exposureRatioToParent: 1,
    pointValueUsd: 100,
    tickSize: 0.1,
    tickValueUsd: 10,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "MGC",
    displayName: "Micro Gold Futures",
    exchange: "COMEX",
    assetClass: "metals",
    sizeClass: "micro",
    parentRoot: "GC",
    exposureRatioToParent: 0.1,
    pointValueUsd: 10,
    tickSize: 0.1,
    tickValueUsd: 1,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "SI",
    displayName: "Silver Futures",
    exchange: "COMEX",
    assetClass: "metals",
    sizeClass: "standard",
    parentRoot: "SI",
    exposureRatioToParent: 1,
    pointValueUsd: 5000,
    tickSize: 0.005,
    tickValueUsd: 25,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "SIL",
    displayName: "Micro Silver Futures",
    exchange: "COMEX",
    assetClass: "metals",
    sizeClass: "micro",
    parentRoot: "SI",
    // SIL = 1,000 oz; SI = 5,000 oz → ratio 0.2
    exposureRatioToParent: 0.2,
    pointValueUsd: 1000,
    tickSize: 0.005,
    tickValueUsd: 5,
    supportedForMiniEquivalent: false,
  },

  // ── NYMEX Energy ───────────────────────────────────────────────────────────
  {
    symbolRoot: "CL",
    displayName: "Crude Oil Futures (WTI)",
    exchange: "NYMEX",
    assetClass: "energy",
    sizeClass: "standard",
    parentRoot: "CL",
    exposureRatioToParent: 1,
    pointValueUsd: 1000,
    tickSize: 0.01,
    tickValueUsd: 10,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "MCL",
    displayName: "Micro WTI Crude Oil Futures",
    exchange: "NYMEX",
    assetClass: "energy",
    sizeClass: "micro",
    parentRoot: "CL",
    exposureRatioToParent: 0.1,
    pointValueUsd: 100,
    tickSize: 0.01,
    tickValueUsd: 1,
    supportedForMiniEquivalent: false,
  },

  // ── CME Cryptocurrency ─────────────────────────────────────────────────────
  // Contract sizes: BTC = 5 BTC; MBT = 0.1 BTC → ratio = 0.1/5 = 0.02
  //                 ETH = 50 ETH; MET = 5 ETH   → ratio = 5/50 = 0.1
  {
    symbolRoot: "BTC",
    displayName: "Bitcoin Futures",
    exchange: "CME",
    assetClass: "crypto",
    sizeClass: "standard",
    parentRoot: "BTC",
    exposureRatioToParent: 1,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "MBT",
    displayName: "Micro Bitcoin Futures",
    exchange: "CME",
    assetClass: "crypto",
    sizeClass: "micro",
    parentRoot: "BTC",
    // MBT = 0.1 BTC per contract; BTC futures = 5 BTC per contract → 0.1/5 = 0.02
    exposureRatioToParent: 0.02,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "ETH",
    displayName: "Ether Futures",
    exchange: "CME",
    assetClass: "crypto",
    sizeClass: "standard",
    parentRoot: "ETH",
    exposureRatioToParent: 1,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "MET",
    displayName: "Micro Ether Futures",
    exchange: "CME",
    assetClass: "crypto",
    sizeClass: "micro",
    parentRoot: "ETH",
    // MET = 5 ETH per contract; ETH futures = 50 ETH per contract → 5/50 = 0.1
    exposureRatioToParent: 0.1,
    supportedForMiniEquivalent: false,
  },
] as const;

// ── Internal lookup maps (built once at module load) ─────────────────────────

// Keyed by canonical symbolRoot (uppercase).
const BY_ROOT = new Map<string, FuturesContractMetadata>(
  REGISTRY.map((c) => [c.symbolRoot, c]),
);

// All known roots sorted longest-first for prefix-matching in normalizeSymbolRoot.
const ROOTS_LONGEST_FIRST: string[] = [...BY_ROOT.keys()].sort(
  (a, b) => b.length - a.length,
);

// CME standard month codes.
const MONTH_CODE_RE = /^[FGHJKMNQUVXZ]\d{1,2}$/;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Strips the CME month + year suffix from a Tradovate symbol and returns the
 * canonical product root (uppercase).
 *
 * Strategy: match the longest known root as a prefix, then verify the remainder
 * is either empty (bare root) or a valid month-code + year digits suffix. This
 * prevents month letters that overlap with root characters (e.g. the "M" in
 * "MNQM6" being misread as a month code) from producing wrong results.
 *
 * Examples:
 *   MNQM6  → MNQ    (M=June, 6=year)
 *   MNQZ26 → MNQ    (Z=Dec, 26=year)
 *   NQM6   → NQ
 *   MESM6  → MES
 *   M2KH25 → M2K
 *   NQ     → NQ     (bare root, no suffix)
 */
export function normalizeSymbolRoot(input: string): string {
  const upper = input.toUpperCase().trim();
  for (const root of ROOTS_LONGEST_FIRST) {
    if (!upper.startsWith(root)) continue;
    const suffix = upper.slice(root.length);
    if (suffix === "" || MONTH_CODE_RE.test(suffix)) return root;
  }
  // Fallback for unknown roots: strip a trailing month+year suffix if present.
  const stripped = upper.replace(/[FGHJKMNQUVXZ]\d{1,2}$/, "");
  return stripped.length > 0 ? stripped : upper;
}

/**
 * Returns metadata for a symbol or root. Input may contain a month/year suffix
 * (e.g. "MNQM6") — it is normalized before the lookup.
 * Returns null when the root is not in the registry.
 */
export function getContractMetadata(symbolOrRoot: string): FuturesContractMetadata | null {
  return BY_ROOT.get(normalizeSymbolRoot(symbolOrRoot)) ?? null;
}

/**
 * Returns the metadata for the parent contract of the given symbol or root.
 * For the mini itself (e.g. NQ), returns its own metadata.
 * For a micro (e.g. MNQ), returns the parent mini's metadata (NQ).
 * Returns null when the root is not in the registry.
 */
export function getParentContract(symbolOrRoot: string): FuturesContractMetadata | null {
  const meta = getContractMetadata(symbolOrRoot);
  if (!meta) return null;
  return BY_ROOT.get(meta.parentRoot) ?? null;
}

/**
 * Returns how much parent-equivalent exposure one contract of the given symbol
 * contributes.
 *   NQ  → 1.0   (it IS the parent)
 *   MNQ → 0.1   (1/10 of an NQ-equivalent)
 * Unknown roots → 1.0 (safe fallback: never understates exposure).
 */
export function getExposureRatioToParent(symbolOrRoot: string): number {
  return getContractMetadata(symbolOrRoot)?.exposureRatioToParent ?? 1;
}

/**
 * Converts a raw contract quantity to its parent-equivalent value.
 *   toParentEquivalentContracts(10, "MNQ") → 1.0   (10 × 0.1)
 *   toParentEquivalentContracts(2,  "MNQ") → 0.2
 *   toParentEquivalentContracts(1,  "NQ")  → 1.0
 * Unknown roots: 1:1 mapping (ratio = 1).
 */
export function toParentEquivalentContracts(rawContracts: number, symbolOrRoot: string): number {
  const ratio = getExposureRatioToParent(symbolOrRoot);
  // Use integer tenths to avoid IEEE-754 drift at the boundary.
  const ratiоTenths = Math.round(ratio * 10);
  return (Math.abs(rawContracts) * ratiоTenths) / 10;
}

/**
 * Returns the maximum raw integer contract count for the given symbol that
 * corresponds to `maxParentEquivalent` parent-equivalent contracts.
 *
 *   toRawContractLimit(1, "NQ")  → 1
 *   toRawContractLimit(1, "MNQ") → 10
 *   toRawContractLimit(2, "MNQ") → 20
 *
 * Uses floor (round down) so the raw limit never overstates allowance.
 * Returns at least 1 for supported registry symbols so a non-zero limit
 * always allows at least one contract.
 * For unknown roots returns ceil(maxParentEquivalent) with a minimum of 1.
 */
export function toRawContractLimit(maxParentEquivalent: number, symbolOrRoot: string): number {
  const meta = getContractMetadata(symbolOrRoot);
  if (!meta) {
    return Math.max(1, Math.ceil(maxParentEquivalent));
  }
  // Integer arithmetic: work in tenths to avoid floating-point drift.
  const ratioTenths = Math.round(meta.exposureRatioToParent * 10);
  const limitTenths = Math.round(maxParentEquivalent * 10);
  const raw = Math.floor(limitTenths / ratioTenths);
  return Math.max(1, raw);
}

/**
 * Determines whether a position of `positionQty` contracts of `symbolOrRoot`
 * is within the `maxParentEquivalent` limit.
 *
 * Returns:
 *   allowed              — true when parentEquivalentQty ≤ maxParentEquivalent
 *   parentEquivalentQty  — the parent-equivalent value of the position
 *   rawLimitForSymbol    — the max raw contracts allowed for this symbol
 *   reason               — human-readable explanation
 */
export function comparePositionToLimit(
  positionQty: number,
  symbolOrRoot: string,
  maxParentEquivalent: number,
): {
  allowed: boolean;
  parentEquivalentQty: number;
  rawLimitForSymbol: number;
  reason: string;
} {
  const root = normalizeSymbolRoot(symbolOrRoot);
  const meta = getContractMetadata(root);
  const parentEquivalentQty = toParentEquivalentContracts(positionQty, root);
  const rawLimitForSymbol = toRawContractLimit(maxParentEquivalent, root);
  const allowed = parentEquivalentQty <= maxParentEquivalent;

  const parentLabel = meta?.parentRoot ?? root;
  const ratio = meta?.exposureRatioToParent ?? 1;
  const ratioLabel = ratio === 1 ? "" : ` (each ${root} = ${ratio} ${parentLabel}-equivalent)`;

  const reason = allowed
    ? `${positionQty} ${root} = ${parentEquivalentQty} ${parentLabel}-equivalent` +
      `${ratioLabel}; within limit of ${maxParentEquivalent}`
    : `${positionQty} ${root} = ${parentEquivalentQty} ${parentLabel}-equivalent` +
      `${ratioLabel}; exceeds limit of ${maxParentEquivalent} ` +
      `(raw ${root} limit: ${rawLimitForSymbol})`;

  return { allowed, parentEquivalentQty, rawLimitForSymbol, reason };
}

/**
 * Returns a map of symbolRoot → raw contract limit for all supported registry
 * entries, given a maxParentEquivalent value. Useful for debug endpoints.
 *
 * Only includes roots where supportedForMiniEquivalent is true.
 *
 * effectiveSupportedRawLimits(1) →
 *   { NQ: 1, MNQ: 10, ES: 1, MES: 10, YM: 1, MYM: 10, RTY: 1, M2K: 10 }
 */
export function effectiveSupportedRawLimits(maxParentEquivalent: number): Record<string, number> {
  return Object.fromEntries(
    REGISTRY.filter((c) => c.supportedForMiniEquivalent).map((c) => [
      c.symbolRoot,
      toRawContractLimit(maxParentEquivalent, c.symbolRoot),
    ]),
  );
}

/**
 * Returns the full registry as a readonly array (for iteration/inspection).
 */
export function getAllContracts(): readonly FuturesContractMetadata[] {
  return REGISTRY;
}

/**
 * Returns all supported symbol roots (supportedForMiniEquivalent = true).
 */
export function getSupportedRoots(): string[] {
  return REGISTRY.filter((c) => c.supportedForMiniEquivalent).map((c) => c.symbolRoot);
}
