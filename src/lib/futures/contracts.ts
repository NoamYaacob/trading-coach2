/**
 * Central futures contract metadata registry.
 *
 * Guardrail uses this module as the single source of truth for:
 *   - Standard-equivalent exposure calculations (Apex / prop-firm model)
 *   - Position-size limit enforcement (app-side and broker-side)
 *   - UI copy and debug endpoints
 *   - Future broker-side per-product enforcement decisions
 *
 * IMPORTANT — Tradovate broker enforcement note:
 *   Tradovate's UserAccountPositionLimit (totalBy="Overall") enforces a single
 *   raw contract count across ALL open positions simultaneously. It cannot express
 *   standard-equivalent weighting (e.g., 10 MNQ = 1 NQ-equivalent). Broker-side
 *   product-specific limits (totalBy="PerContract" or "PerProduct") exist in the
 *   Tradovate type definition but have NOT been verified against a live account.
 *   Until verified, exact standard-equivalent enforcement is Guardrail-side (app-level) only.
 *   The global raw hard limit is NOT applied automatically because setting it to
 *   maxContracts=1 would incorrectly block 2 MNQ (0.2 NQ-equivalent, within limit).
 *
 * IMPORTANT — Apex position-sizing model:
 *   Per Apex Trader Funding's published rules: ten (10) micro contracts equal one
 *   (1) standard contract. Guardrail implements this as exposureRatioToParent=0.1
 *   for supported micro equity index pairs (MES/MNQ/MYM/M2K).
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
  | "volatility"
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
   * Root of the parent contract in the standard/mini/micro hierarchy.
   * Self-referential for the "standard" member of the group (e.g. NQ → "NQ").
   * Points to the parent for micros/minis (e.g. MNQ → "NQ").
   */
  parentRoot: string;
  /**
   * How much one contract of this root counts toward the parent-equivalent limit.
   *   NQ:   1.0   (it IS the parent)
   *   MNQ:  0.1   (1/10 of an NQ — Apex: 10 micro = 1 standard)
   *   FDXM: 0.2   (Mini-DAX = 1/5 of FDAX by point value)
   *   FDXS: 0.04  (Micro-DAX = 1/25 of FDAX by point value)
   *   QM:   0.5   (Mini Crude Oil = 1/2 of CL by notional)
   *   QG:   0.25  (E-mini Nat Gas = 1/4 of NG by notional)
   */
  exposureRatioToParent: number;
  /** Notional value per point move in the contract's native currency. */
  pointValueUsd?: number;
  /** Minimum price increment. */
  tickSize?: number;
  /** Dollar (or native currency) value of one tick move. */
  tickValueUsd?: number;
  /** Alternative root spellings Tradovate may return for this contract. */
  aliases?: string[];
  /**
   * True when this root is part of a verified standard-equivalent pair that
   * Guardrail reliably enforces using the Apex "10 micro = 1 standard" model.
   * Currently true only for the CME equity-index pairs ES/MES, NQ/MNQ,
   * YM/MYM, RTY/M2K where the 1:10 ratio is explicitly published by Apex.
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
    sizeClass: "standard",
    parentRoot: "ES",
    exposureRatioToParent: 1,
    pointValueUsd: 50,
    tickSize: 0.25,
    tickValueUsd: 12.5,
    supportedForMiniEquivalent: true,
  },
  {
    symbolRoot: "MES",
    displayName: "Micro E-Mini S&P 500",
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
    displayName: "E-mini NASDAQ 100",
    exchange: "CME",
    assetClass: "equity_index",
    sizeClass: "standard",
    parentRoot: "NQ",
    exposureRatioToParent: 1,
    pointValueUsd: 20,
    tickSize: 0.25,
    tickValueUsd: 5,
    supportedForMiniEquivalent: true,
  },
  {
    symbolRoot: "MNQ",
    displayName: "Micro E-Mini Nasdaq-100",
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
    displayName: "Mini-DOW",
    exchange: "CBOT",
    assetClass: "equity_index",
    sizeClass: "standard",
    parentRoot: "YM",
    exposureRatioToParent: 1,
    pointValueUsd: 5,
    tickSize: 1,
    tickValueUsd: 5,
    supportedForMiniEquivalent: true,
  },
  {
    symbolRoot: "MYM",
    displayName: "Micro E-Mini Dow Jones",
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
    displayName: "Russell 2000",
    exchange: "CME",
    assetClass: "equity_index",
    sizeClass: "standard",
    parentRoot: "RTY",
    exposureRatioToParent: 1,
    pointValueUsd: 50,
    tickSize: 0.1,
    tickValueUsd: 5,
    supportedForMiniEquivalent: true,
  },
  {
    symbolRoot: "M2K",
    displayName: "Micro E-Mini Russell 2000",
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
  {
    symbolRoot: "NKD",
    displayName: "Nikkei NKD",
    exchange: "CME",
    assetClass: "equity_index",
    sizeClass: "standard",
    parentRoot: "NKD",
    exposureRatioToParent: 1,
    pointValueUsd: 5,
    tickSize: 5,
    tickValueUsd: 25,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "EMD",
    displayName: "E-mini Midcap 400",
    exchange: "CME",
    assetClass: "equity_index",
    sizeClass: "standard",
    parentRoot: "EMD",
    exposureRatioToParent: 1,
    pointValueUsd: 100,
    tickSize: 0.1,
    tickValueUsd: 10,
    supportedForMiniEquivalent: false,
  },

  // ── CME FX ─────────────────────────────────────────────────────────────────
  {
    symbolRoot: "6A",
    displayName: "Australian Dollar",
    exchange: "CME",
    assetClass: "fx",
    sizeClass: "standard",
    parentRoot: "6A",
    exposureRatioToParent: 1,
    pointValueUsd: 100000,
    tickSize: 0.00005,
    tickValueUsd: 5,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "6B",
    displayName: "British Pound",
    exchange: "CME",
    assetClass: "fx",
    sizeClass: "standard",
    parentRoot: "6B",
    exposureRatioToParent: 1,
    pointValueUsd: 62500,
    tickSize: 0.0001,
    tickValueUsd: 6.25,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "6C",
    displayName: "Canadian Dollar",
    exchange: "CME",
    assetClass: "fx",
    sizeClass: "standard",
    parentRoot: "6C",
    exposureRatioToParent: 1,
    pointValueUsd: 100000,
    tickSize: 0.00005,
    tickValueUsd: 5,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "6E",
    displayName: "Euro FX",
    exchange: "CME",
    assetClass: "fx",
    sizeClass: "standard",
    parentRoot: "6E",
    exposureRatioToParent: 1,
    pointValueUsd: 125000,
    tickSize: 0.00005,
    tickValueUsd: 6.25,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "6J",
    displayName: "Japanese Yen",
    exchange: "CME",
    assetClass: "fx",
    sizeClass: "standard",
    parentRoot: "6J",
    exposureRatioToParent: 1,
    pointValueUsd: 12500000,
    tickSize: 0.0000005,
    tickValueUsd: 6.25,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "6S",
    displayName: "Swiss Franc",
    exchange: "CME",
    assetClass: "fx",
    sizeClass: "standard",
    parentRoot: "6S",
    exposureRatioToParent: 1,
    pointValueUsd: 125000,
    tickSize: 0.0001,
    tickValueUsd: 12.5,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "6N",
    displayName: "New Zealand Dollar",
    exchange: "CME",
    assetClass: "fx",
    sizeClass: "standard",
    parentRoot: "6N",
    exposureRatioToParent: 1,
    pointValueUsd: 100000,
    tickSize: 0.00005,
    tickValueUsd: 5,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "M6A",
    displayName: "E-Micro AUD/USD",
    exchange: "CME",
    assetClass: "fx",
    sizeClass: "micro",
    parentRoot: "6A",
    exposureRatioToParent: 0.1,
    pointValueUsd: 10000,
    tickSize: 0.0001,
    tickValueUsd: 1,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "M6E",
    displayName: "E-Micro EUR/USD",
    exchange: "CME",
    assetClass: "fx",
    sizeClass: "micro",
    parentRoot: "6E",
    exposureRatioToParent: 0.1,
    pointValueUsd: 12500,
    tickSize: 0.0001,
    tickValueUsd: 1.25,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "M6B",
    displayName: "Micro GBP/USD",
    exchange: "CME",
    assetClass: "fx",
    sizeClass: "micro",
    parentRoot: "6B",
    // M6B = 6,250 GBP; 6B = 62,500 GBP → ratio 0.1
    exposureRatioToParent: 0.1,
    pointValueUsd: 6250,
    tickSize: 0.0001,
    tickValueUsd: 0.625,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "M6J",
    displayName: "Micro JPY/USD",
    exchange: "CME",
    assetClass: "fx",
    sizeClass: "micro",
    parentRoot: "6J",
    // M6J = 1,250,000 JPY; 6J = 12,500,000 JPY → ratio 0.1
    exposureRatioToParent: 0.1,
    pointValueUsd: 1250000,
    tickSize: 0.000001,
    tickValueUsd: 1.25,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "M6C",
    displayName: "Micro CAD/USD",
    exchange: "CME",
    assetClass: "fx",
    sizeClass: "micro",
    parentRoot: "6C",
    // M6C = 10,000 CAD; 6C = 100,000 CAD → ratio 0.1
    exposureRatioToParent: 0.1,
    pointValueUsd: 10000,
    tickSize: 0.0001,
    tickValueUsd: 1,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "M6S",
    displayName: "Micro CHF/USD",
    exchange: "CME",
    assetClass: "fx",
    sizeClass: "micro",
    parentRoot: "6S",
    // M6S = 12,500 CHF; 6S = 125,000 CHF → ratio 0.1
    exposureRatioToParent: 0.1,
    pointValueUsd: 12500,
    tickSize: 0.0001,
    tickValueUsd: 1.25,
    supportedForMiniEquivalent: false,
  },

  // ── CME Agriculture ────────────────────────────────────────────────────────
  {
    symbolRoot: "HE",
    displayName: "Lean Hogs",
    exchange: "CME",
    assetClass: "agriculture",
    sizeClass: "standard",
    parentRoot: "HE",
    exposureRatioToParent: 1,
    pointValueUsd: 400,
    tickSize: 0.025,
    tickValueUsd: 10,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "LE",
    displayName: "Live Cattle",
    exchange: "CME",
    assetClass: "agriculture",
    sizeClass: "standard",
    parentRoot: "LE",
    exposureRatioToParent: 1,
    pointValueUsd: 400,
    tickSize: 0.025,
    tickValueUsd: 10,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "GF",
    displayName: "Feeder Cattle",
    exchange: "CME",
    assetClass: "agriculture",
    sizeClass: "standard",
    parentRoot: "GF",
    exposureRatioToParent: 1,
    pointValueUsd: 500,
    tickSize: 0.025,
    tickValueUsd: 12.5,
    supportedForMiniEquivalent: false,
  },

  // ── CBOT Agriculture ───────────────────────────────────────────────────────
  {
    symbolRoot: "ZC",
    displayName: "Corn",
    exchange: "CBOT",
    assetClass: "agriculture",
    sizeClass: "standard",
    parentRoot: "ZC",
    exposureRatioToParent: 1,
    pointValueUsd: 50,
    tickSize: 0.25,
    tickValueUsd: 12.5,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "ZW",
    displayName: "Wheat",
    exchange: "CBOT",
    assetClass: "agriculture",
    sizeClass: "standard",
    parentRoot: "ZW",
    exposureRatioToParent: 1,
    pointValueUsd: 50,
    tickSize: 0.25,
    tickValueUsd: 12.5,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "ZS",
    displayName: "Soybeans",
    exchange: "CBOT",
    assetClass: "agriculture",
    sizeClass: "standard",
    parentRoot: "ZS",
    exposureRatioToParent: 1,
    pointValueUsd: 50,
    tickSize: 0.25,
    tickValueUsd: 12.5,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "ZM",
    displayName: "Soybean Meal",
    exchange: "CBOT",
    assetClass: "agriculture",
    sizeClass: "standard",
    parentRoot: "ZM",
    exposureRatioToParent: 1,
    pointValueUsd: 100,
    tickSize: 0.1,
    tickValueUsd: 10,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "ZL",
    displayName: "Soybean Oil",
    exchange: "CBOT",
    assetClass: "agriculture",
    sizeClass: "standard",
    parentRoot: "ZL",
    exposureRatioToParent: 1,
    pointValueUsd: 600,
    tickSize: 0.01,
    tickValueUsd: 6,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "KE",
    displayName: "KC Hard Red Winter Wheat",
    exchange: "CBOT",
    assetClass: "agriculture",
    sizeClass: "standard",
    parentRoot: "KE",
    // KE = 5,000 bushels, 1/4-cent tick = $12.50 — mirrors ZW (Chicago Wheat).
    exposureRatioToParent: 1,
    pointValueUsd: 50,
    tickSize: 0.25,
    tickValueUsd: 12.5,
    supportedForMiniEquivalent: false,
  },

  // ── CBOT Rates (U.S. Treasuries) ───────────────────────────────────────────
  // Each is its own standalone product (exposureRatioToParent = 1; no
  // micro/standard pairing). tickSize/tickValueUsd are intentionally omitted —
  // U.S. Treasury futures trade in fractional 1/32-based increments; those
  // fields are display-only and are not used by symbol-limit resolution.
  {
    symbolRoot: "ZB",
    displayName: "U.S. Treasury Bond (30-Year)",
    exchange: "CBOT",
    assetClass: "rates",
    sizeClass: "standard",
    parentRoot: "ZB",
    exposureRatioToParent: 1,
    pointValueUsd: 1000,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "UB",
    displayName: "Ultra U.S. Treasury Bond",
    exchange: "CBOT",
    assetClass: "rates",
    sizeClass: "standard",
    parentRoot: "UB",
    exposureRatioToParent: 1,
    pointValueUsd: 1000,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "ZN",
    displayName: "U.S. Treasury Note (10-Year)",
    exchange: "CBOT",
    assetClass: "rates",
    sizeClass: "standard",
    parentRoot: "ZN",
    exposureRatioToParent: 1,
    pointValueUsd: 1000,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "ZF",
    displayName: "U.S. Treasury Note (5-Year)",
    exchange: "CBOT",
    assetClass: "rates",
    sizeClass: "standard",
    parentRoot: "ZF",
    exposureRatioToParent: 1,
    pointValueUsd: 1000,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "ZT",
    displayName: "U.S. Treasury Note (2-Year)",
    exchange: "CBOT",
    assetClass: "rates",
    sizeClass: "standard",
    parentRoot: "ZT",
    exposureRatioToParent: 1,
    pointValueUsd: 2000,
    supportedForMiniEquivalent: false,
  },

  // ── NYMEX Energy ───────────────────────────────────────────────────────────
  {
    symbolRoot: "CL",
    displayName: "Crude Oil (WTI)",
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
    symbolRoot: "QM",
    displayName: "Mini Crude Oil",
    exchange: "NYMEX",
    assetClass: "energy",
    sizeClass: "mini",
    parentRoot: "CL",
    // QM = 500 bbl; CL = 1000 bbl → ratio 0.5
    exposureRatioToParent: 0.5,
    pointValueUsd: 500,
    tickSize: 0.025,
    tickValueUsd: 12.5,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "MCL",
    displayName: "Micro WTI Crude Oil",
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
  {
    symbolRoot: "NG",
    displayName: "Natural Gas",
    exchange: "NYMEX",
    assetClass: "energy",
    sizeClass: "standard",
    parentRoot: "NG",
    exposureRatioToParent: 1,
    pointValueUsd: 10000,
    tickSize: 0.001,
    tickValueUsd: 10,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "QG",
    displayName: "E-mini Natural Gas",
    exchange: "NYMEX",
    assetClass: "energy",
    sizeClass: "mini",
    parentRoot: "NG",
    // QG = 2500 mmBtu; NG = 10000 mmBtu → ratio 0.25
    exposureRatioToParent: 0.25,
    pointValueUsd: 2500,
    tickSize: 0.005,
    tickValueUsd: 12.5,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "HO",
    displayName: "Heating Oil",
    exchange: "NYMEX",
    assetClass: "energy",
    sizeClass: "standard",
    parentRoot: "HO",
    exposureRatioToParent: 1,
    pointValueUsd: 42000,
    tickSize: 0.0001,
    tickValueUsd: 4.2,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "RB",
    displayName: "New York Harbor RBOB Gasoline",
    exchange: "NYMEX",
    assetClass: "energy",
    sizeClass: "standard",
    parentRoot: "RB",
    exposureRatioToParent: 1,
    pointValueUsd: 42000,
    tickSize: 0.0001,
    tickValueUsd: 4.2,
    supportedForMiniEquivalent: false,
  },

  // ── COMEX Metals ───────────────────────────────────────────────────────────
  {
    symbolRoot: "GC",
    displayName: "Gold",
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
    displayName: "E-Micro Gold",
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
    displayName: "Silver",
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
    displayName: "E-Micro Silver",
    exchange: "COMEX",
    assetClass: "metals",
    sizeClass: "micro",
    parentRoot: "SI",
    // Apex instruments list: pointValue=5, SI pointValue=5000 → ratio 0.001
    exposureRatioToParent: 0.001,
    pointValueUsd: 5,
    tickSize: 0.005,
    tickValueUsd: 0.025,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "HG",
    displayName: "Copper",
    exchange: "COMEX",
    assetClass: "metals",
    sizeClass: "standard",
    parentRoot: "HG",
    exposureRatioToParent: 1,
    pointValueUsd: 25000,
    tickSize: 0.0005,
    tickValueUsd: 12.5,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "PL",
    displayName: "Platinum",
    exchange: "COMEX",
    assetClass: "metals",
    sizeClass: "standard",
    parentRoot: "PL",
    exposureRatioToParent: 1,
    pointValueUsd: 50,
    tickSize: 0.1,
    tickValueUsd: 5,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "PA",
    displayName: "Palladium",
    exchange: "COMEX",
    assetClass: "metals",
    sizeClass: "standard",
    parentRoot: "PA",
    exposureRatioToParent: 1,
    pointValueUsd: 100,
    tickSize: 0.5,
    tickValueUsd: 50,
    supportedForMiniEquivalent: false,
  },

  // ── EUREX Equity Index ─────────────────────────────────────────────────────
  // Point values are in EUR (native currency for EUREX contracts).
  {
    symbolRoot: "FDAX",
    displayName: "DAX Index",
    exchange: "EUREX",
    assetClass: "equity_index",
    sizeClass: "standard",
    parentRoot: "FDAX",
    exposureRatioToParent: 1,
    pointValueUsd: 25,
    tickSize: 1,
    tickValueUsd: 25,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "FDXM",
    displayName: "Mini-DAX",
    exchange: "EUREX",
    assetClass: "equity_index",
    sizeClass: "mini",
    parentRoot: "FDAX",
    // FDXM €5/pt vs FDAX €25/pt → ratio 0.2
    exposureRatioToParent: 0.2,
    pointValueUsd: 5,
    tickSize: 1,
    tickValueUsd: 5,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "FDXS",
    displayName: "Micro DAX Index",
    exchange: "EUREX",
    assetClass: "equity_index",
    sizeClass: "micro",
    parentRoot: "FDAX",
    // FDXS €1/pt vs FDAX €25/pt → ratio 0.04
    exposureRatioToParent: 0.04,
    pointValueUsd: 1,
    tickSize: 1,
    tickValueUsd: 1,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "FESX",
    displayName: "Euro Stoxx 50",
    exchange: "EUREX",
    assetClass: "equity_index",
    sizeClass: "standard",
    parentRoot: "FESX",
    exposureRatioToParent: 1,
    pointValueUsd: 10,
    tickSize: 1,
    tickValueUsd: 10,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "FSXE",
    displayName: "Micro Euro Stoxx 50",
    exchange: "EUREX",
    assetClass: "equity_index",
    sizeClass: "micro",
    parentRoot: "FESX",
    // FSXE €1/pt vs FESX €10/pt → ratio 0.1
    exposureRatioToParent: 0.1,
    pointValueUsd: 1,
    tickSize: 0.5,
    tickValueUsd: 0.5,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "FVS",
    displayName: "VSTOXX",
    exchange: "EUREX",
    assetClass: "volatility",
    sizeClass: "standard",
    parentRoot: "FVS",
    exposureRatioToParent: 1,
    pointValueUsd: 100,
    tickSize: 0.05,
    tickValueUsd: 5,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "FXXP",
    displayName: "STOXX Europe 600",
    exchange: "EUREX",
    assetClass: "equity_index",
    sizeClass: "standard",
    parentRoot: "FXXP",
    exposureRatioToParent: 1,
    pointValueUsd: 50,
    tickSize: 0.1,
    tickValueUsd: 5,
    supportedForMiniEquivalent: false,
  },

  // ── EUREX Rates ────────────────────────────────────────────────────────────
  {
    symbolRoot: "FGBX",
    displayName: "Euro-Buxl",
    exchange: "EUREX",
    assetClass: "rates",
    sizeClass: "standard",
    parentRoot: "FGBX",
    exposureRatioToParent: 1,
    pointValueUsd: 1000,
    tickSize: 0.02,
    tickValueUsd: 20,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "FGBS",
    displayName: "Euro-Schatz",
    exchange: "EUREX",
    assetClass: "rates",
    sizeClass: "standard",
    parentRoot: "FGBS",
    exposureRatioToParent: 1,
    pointValueUsd: 1000,
    tickSize: 0.005,
    tickValueUsd: 5,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "FGBM",
    displayName: "Euro-Bobl",
    exchange: "EUREX",
    assetClass: "rates",
    sizeClass: "standard",
    parentRoot: "FGBM",
    exposureRatioToParent: 1,
    pointValueUsd: 1000,
    tickSize: 0.01,
    tickValueUsd: 10,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "FGBL",
    displayName: "Euro-Bund",
    exchange: "EUREX",
    assetClass: "rates",
    sizeClass: "standard",
    parentRoot: "FGBL",
    exposureRatioToParent: 1,
    pointValueUsd: 1000,
    tickSize: 0.01,
    tickValueUsd: 10,
    supportedForMiniEquivalent: false,
  },

  // ── CME Cryptocurrency ─────────────────────────────────────────────────────
  // Apex supports MBT and MET only; full-size BTC and ETH futures are not
  // available on Apex/Tradovate. MBT and MET are treated as standalone
  // products (no standard parent in the Apex instrument list).
  {
    symbolRoot: "MBT",
    displayName: "Micro Bitcoin",
    exchange: "CME",
    assetClass: "crypto",
    sizeClass: "micro",
    parentRoot: "MBT",
    exposureRatioToParent: 1,
    pointValueUsd: 0.1,
    tickSize: 5,
    supportedForMiniEquivalent: false,
  },
  {
    symbolRoot: "MET",
    displayName: "Micro Ethereum",
    exchange: "CME",
    assetClass: "crypto",
    sizeClass: "micro",
    parentRoot: "MET",
    exposureRatioToParent: 1,
    pointValueUsd: 0.1,
    tickSize: 0.5,
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

// Standard CME/exchange month codes.
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
 *   FDAXH6 → FDAX   (EUREX DAX)
 *   6AH26  → 6A     (AUD/USD FX)
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
 * For a standard (e.g. NQ), returns its own metadata.
 * For a micro (e.g. MNQ), returns the parent's metadata (NQ).
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
 *   MNQ → 0.1   (1/10 of an NQ-equivalent; Apex: 10 micro = 1 standard)
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
 *
 * Uses integer-thousandths arithmetic to avoid IEEE-754 drift for ratios
 * that are multiples of 0.001 (covers 0.001, 0.04, 0.1, 0.2, 0.25, 0.5, 1.0).
 */
export function toParentEquivalentContracts(rawContracts: number, symbolOrRoot: string): number {
  const ratio = getExposureRatioToParent(symbolOrRoot);
  const ratioMillis = Math.round(ratio * 1000);
  return (Math.abs(rawContracts) * ratioMillis) / 1000;
}

/**
 * Returns the maximum raw integer contract count for the given symbol that
 * corresponds to `maxParentEquivalent` parent-equivalent contracts.
 *
 *   toRawContractLimit(1, "NQ")  → 1
 *   toRawContractLimit(1, "MNQ") → 10   (Apex: 10 micro = 1 standard)
 *   toRawContractLimit(1, "SIL") → 1000
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
  const ratioMillis = Math.round(meta.exposureRatioToParent * 1000);
  const limitMillis = Math.round(maxParentEquivalent * 1000);
  const raw = Math.floor(limitMillis / ratioMillis);
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
 * Only includes roots where supportedForMiniEquivalent is true (the 8 CME
 * equity index roots: ES/MES, NQ/MNQ, YM/MYM, RTY/M2K).
 *
 * effectiveSupportedRawLimits(1) →
 *   { ES: 1, MES: 10, NQ: 1, MNQ: 10, YM: 1, MYM: 10, RTY: 1, M2K: 10 }
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
