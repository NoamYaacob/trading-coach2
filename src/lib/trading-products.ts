// Backend product catalog — extracted structural knowledge from Topstep's
// allowed-products article. Spec values come from publicly known CME/CBOT/
// NYMEX/COMEX contracts; products without confirmed specs are marked as
// `allowed_unknown_specs` rather than guessed.

export type ProductCategory = "futures" | "forex_spot" | "stock" | "crypto" | "unknown";

export type Exchange = "CME" | "CBOT" | "NYMEX" | "COMEX";

export type ProductGroup =
  | "cme-equity"
  | "cme-fx"
  | "cme-ag-livestock"
  | "nymex-energy-metals"
  | "cbot-ag"
  | "cbot-equity"
  | "cbot-rates"
  | "comex-metals";

export type FuturesContractSpec = {
  pointValue: number;
  tickSize: number;
  tickValue: number;
};

export type TimeOfDayCT = { hour: number; minute: number };

export type ProductMetadata = {
  symbol: string;
  name: string;
  category: ProductCategory;
  group: ProductGroup;
  exchange: Exchange;
  specStatus: "known" | "allowed_unknown_specs";
  spec?: FuturesContractSpec;
  /** Daytime close, in Chicago time, when earlier than the program cutoff. */
  earlyCloseCT?: TimeOfDayCT;
  /** Sunday session open, when later than the program-wide Sunday open. */
  sundayOpenCT?: TimeOfDayCT;
  /** Daytime open used by short-session products (no overnight). */
  daytimeOpenCT?: TimeOfDayCT;
};

// ── Spec helpers ────────────────────────────────────────────────────────────

const KNOWN_SPECS: Record<string, FuturesContractSpec> = {
  ES:  { pointValue: 50,   tickSize: 0.25, tickValue: 12.50 },
  MES: { pointValue: 5,    tickSize: 0.25, tickValue: 1.25  },
  NQ:  { pointValue: 20,   tickSize: 0.25, tickValue: 5.00  },
  MNQ: { pointValue: 2,    tickSize: 0.25, tickValue: 0.50  },
  RTY: { pointValue: 50,   tickSize: 0.10, tickValue: 5.00  },
  M2K: { pointValue: 5,    tickSize: 0.10, tickValue: 0.50  },
  YM:  { pointValue: 5,    tickSize: 1,    tickValue: 5.00  },
  MYM: { pointValue: 0.5,  tickSize: 1,    tickValue: 0.50  },
  CL:  { pointValue: 1000, tickSize: 0.01, tickValue: 10.00 },
  MCL: { pointValue: 100,  tickSize: 0.01, tickValue: 1.00  },
  GC:  { pointValue: 100,  tickSize: 0.10, tickValue: 10.00 },
  MGC: { pointValue: 10,   tickSize: 0.10, tickValue: 1.00  },
};

function spec(symbol: string): FuturesContractSpec | undefined {
  return KNOWN_SPECS[symbol];
}

function known(symbol: string): "known" | "allowed_unknown_specs" {
  return KNOWN_SPECS[symbol] ? "known" : "allowed_unknown_specs";
}

// CBOT grains run Sun 7:00 PM CT → Mon 7:45 AM, then Mon-Fri 8:30 AM-1:20 PM.
const CBOT_AG_CLOSE: TimeOfDayCT = { hour: 13, minute: 20 };
const CBOT_AG_SUNDAY_OPEN: TimeOfDayCT = { hour: 19, minute: 0 };

// CME livestock runs Mon-Fri 8:30 AM-1:05 PM CT (no overnight).
const CME_LIVESTOCK_CLOSE: TimeOfDayCT = { hour: 13, minute: 5 };
const CME_LIVESTOCK_OPEN: TimeOfDayCT = { hour: 8, minute: 30 };

// ── Catalog ─────────────────────────────────────────────────────────────────

function product(
  symbol: string,
  name: string,
  group: ProductGroup,
  exchange: Exchange,
  extras: Partial<ProductMetadata> = {},
): ProductMetadata {
  return {
    symbol,
    name,
    category: "futures",
    group,
    exchange,
    specStatus: known(symbol),
    spec: spec(symbol),
    ...extras,
  };
}

export const PRODUCTS: Record<string, ProductMetadata> = {
  // CME Equity Futures
  ES:  product("ES",  "E-mini S&P 500",            "cme-equity", "CME"),
  MES: product("MES", "Micro E-mini S&P 500",      "cme-equity", "CME"),
  NQ:  product("NQ",  "E-mini Nasdaq-100",         "cme-equity", "CME"),
  MNQ: product("MNQ", "Micro E-mini Nasdaq-100",   "cme-equity", "CME"),
  RTY: product("RTY", "E-mini Russell 2000",       "cme-equity", "CME"),
  M2K: product("M2K", "Micro E-mini Russell 2000", "cme-equity", "CME"),
  NKD: product("NKD", "Nikkei 225 (USD)",          "cme-equity", "CME"),
  MBT: product("MBT", "Micro Bitcoin",             "cme-equity", "CME"),
  MET: product("MET", "Micro Ether",               "cme-equity", "CME"),

  // CME FX Futures
  "6A": product("6A", "Australian Dollar",  "cme-fx", "CME"),
  "6B": product("6B", "British Pound",      "cme-fx", "CME"),
  "6C": product("6C", "Canadian Dollar",    "cme-fx", "CME"),
  "6E": product("6E", "Euro FX",            "cme-fx", "CME"),
  "6J": product("6J", "Japanese Yen",       "cme-fx", "CME"),
  "6S": product("6S", "Swiss Franc",        "cme-fx", "CME"),
  E7:   product("E7", "E-mini Euro FX",     "cme-fx", "CME"),
  M6E:  product("M6E", "Micro Euro FX",     "cme-fx", "CME"),
  M6A:  product("M6A", "Micro AUD/USD",     "cme-fx", "CME"),
  "6M": product("6M", "Mexican Peso",       "cme-fx", "CME"),
  "6N": product("6N", "New Zealand Dollar", "cme-fx", "CME"),
  M6B:  product("M6B", "Micro GBP/USD",     "cme-fx", "CME"),

  // CME Agriculture (livestock — short daytime session)
  HE: product("HE", "Lean Hogs",   "cme-ag-livestock", "CME", {
    earlyCloseCT: CME_LIVESTOCK_CLOSE,
    daytimeOpenCT: CME_LIVESTOCK_OPEN,
  }),
  LE: product("LE", "Live Cattle", "cme-ag-livestock", "CME", {
    earlyCloseCT: CME_LIVESTOCK_CLOSE,
    daytimeOpenCT: CME_LIVESTOCK_OPEN,
  }),

  // NYMEX Energy / Metals
  CL:  product("CL",  "Crude Oil",            "nymex-energy-metals", "NYMEX"),
  QM:  product("QM",  "E-mini Crude Oil",     "nymex-energy-metals", "NYMEX"),
  NG:  product("NG",  "Natural Gas",          "nymex-energy-metals", "NYMEX"),
  QG:  product("QG",  "E-mini Natural Gas",   "nymex-energy-metals", "NYMEX"),
  MCL: product("MCL", "Micro Crude Oil",      "nymex-energy-metals", "NYMEX"),
  RB:  product("RB",  "RBOB Gasoline",        "nymex-energy-metals", "NYMEX"),
  HO:  product("HO",  "Heating Oil",          "nymex-energy-metals", "NYMEX"),
  PL:  product("PL",  "Platinum",             "nymex-energy-metals", "NYMEX"),
  MNG: product("MNG", "Micro Natural Gas",    "nymex-energy-metals", "NYMEX"),

  // CBOT Agriculture (grains — overnight + daytime, daytime closes 1:20 PM CT)
  ZC: product("ZC", "Corn",     "cbot-ag", "CBOT", { earlyCloseCT: CBOT_AG_CLOSE, sundayOpenCT: CBOT_AG_SUNDAY_OPEN }),
  ZW: product("ZW", "Wheat",    "cbot-ag", "CBOT", { earlyCloseCT: CBOT_AG_CLOSE, sundayOpenCT: CBOT_AG_SUNDAY_OPEN }),
  ZS: product("ZS", "Soybeans", "cbot-ag", "CBOT", { earlyCloseCT: CBOT_AG_CLOSE, sundayOpenCT: CBOT_AG_SUNDAY_OPEN }),
  ZM: product("ZM", "Soybean Meal", "cbot-ag", "CBOT", { earlyCloseCT: CBOT_AG_CLOSE, sundayOpenCT: CBOT_AG_SUNDAY_OPEN }),
  ZL: product("ZL", "Soybean Oil",  "cbot-ag", "CBOT", { earlyCloseCT: CBOT_AG_CLOSE, sundayOpenCT: CBOT_AG_SUNDAY_OPEN }),

  // CBOT Equity
  YM:  product("YM",  "E-mini Dow",         "cbot-equity", "CBOT"),
  MYM: product("MYM", "Micro E-mini Dow",   "cbot-equity", "CBOT"),

  // CBOT Rates
  ZT: product("ZT", "2-Year T-Note",   "cbot-rates", "CBOT"),
  ZF: product("ZF", "5-Year T-Note",   "cbot-rates", "CBOT"),
  ZN: product("ZN", "10-Year T-Note",  "cbot-rates", "CBOT"),
  TN: product("TN", "Ultra 10-Year",   "cbot-rates", "CBOT"),
  ZB: product("ZB", "30-Year T-Bond",  "cbot-rates", "CBOT"),
  UB: product("UB", "Ultra T-Bond",    "cbot-rates", "CBOT"),

  // COMEX Metals
  GC:  product("GC",  "Gold",        "comex-metals", "COMEX"),
  SI:  product("SI",  "Silver",      "comex-metals", "COMEX"),
  HG:  product("HG",  "Copper",      "comex-metals", "COMEX"),
  MGC: product("MGC", "Micro Gold",  "comex-metals", "COMEX"),
  SIL: product("SIL", "Micro Silver","comex-metals", "COMEX"),
  MHG: product("MHG", "Micro Copper","comex-metals", "COMEX"),
};

// ── Non-futures hints (used to classify common typed symbols) ───────────────
// These are recognition hints only — not full instrument coverage.

const FOREX_SPOT_HINTS = new Set([
  "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "NZDUSD", "USDCAD",
  "EURGBP", "EURJPY", "EURCHF", "GBPJPY", "AUDJPY", "CADJPY", "CHFJPY",
  "USDCNH", "USDHKD", "USDSGD", "USDZAR", "USDMXN",
]);

const STOCK_HINTS = new Set([
  "AAPL", "MSFT", "GOOGL", "GOOG", "TSLA", "AMZN", "NVDA", "META",
  "NFLX", "AMD", "INTC", "GME", "AMC", "SPY", "QQQ", "IWM", "DIA",
]);

const CRYPTO_HINTS = new Set([
  "BTC", "ETH", "XRP", "SOL", "ADA", "DOT", "DOGE",
  "BTCUSD", "ETHUSD", "BTCUSDT", "ETHUSDT",
]);

// ── Public API ──────────────────────────────────────────────────────────────

export function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase();
}

export function getProduct(rawSymbol: string): ProductMetadata | null {
  const key = normalizeSymbol(rawSymbol);
  return PRODUCTS[key] ?? null;
}

export function classifySymbol(rawSymbol: string): {
  category: ProductCategory;
  product: ProductMetadata | null;
} {
  const key = normalizeSymbol(rawSymbol);
  if (key === "") return { category: "unknown", product: null };

  const product = PRODUCTS[key];
  if (product) return { category: product.category, product };

  if (FOREX_SPOT_HINTS.has(key)) return { category: "forex_spot", product: null };
  if (STOCK_HINTS.has(key)) return { category: "stock", product: null };
  if (CRYPTO_HINTS.has(key)) return { category: "crypto", product: null };

  return { category: "unknown", product: null };
}

export function listAllowedSymbols(): string[] {
  return Object.keys(PRODUCTS);
}

export function listSymbolsByGroup(group: ProductGroup): string[] {
  return Object.values(PRODUCTS)
    .filter((p) => p.group === group)
    .map((p) => p.symbol);
}
