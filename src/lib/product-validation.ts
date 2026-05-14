// Combines symbol classification, program profile, and trade timing into a
// single validation surface for the journal form and trade history cards.

import {
  classifySymbol,
  type AssetClass,
  type ProductMetadata,
} from "./trading-products.ts";
import {
  type ProgramProfile,
  formatTimeOfDayCT,
  getEffectiveCutoffCT,
  getEffectiveSundayOpenCT,
  isSymbolAllowed,
  minutesFromMidnight,
  toChicagoTime,
} from "./program-rules.ts";

export type ValidationLevel = "error" | "warning" | "hint";

export type ProductValidation = {
  level: ValidationLevel;
  code: string;
  message: string;
};

export type MarketState = "open" | "closed" | "paused" | "pre-open" | "unknown";

export type SymbolStatus =
  | { kind: "recognized_with_specs"; product: ProductMetadata }
  | { kind: "recognized_no_specs"; product: ProductMetadata }
  | { kind: "forex" }
  | { kind: "stock" }
  | { kind: "crypto" }
  | { kind: "empty" }
  | { kind: "unknown" };

export type TradeValidationResult = {
  normalizedSymbol: string;
  instrument: ProductMetadata | null;
  assetClass: AssetClass;
  errors: ProductValidation[];
  warnings: ProductValidation[];
  hints: ProductValidation[];
};

export function getSymbolStatus(rawSymbol: string): SymbolStatus {
  if (!rawSymbol.trim()) return { kind: "empty" };
  const { assetClass, product } = classifySymbol(rawSymbol);
  if (product) {
    return product.specStatus === "known"
      ? { kind: "recognized_with_specs", product }
      : { kind: "recognized_no_specs", product };
  }
  if (assetClass === "forex") return { kind: "forex" };
  if (assetClass === "stock") return { kind: "stock" };
  if (assetClass === "crypto") return { kind: "crypto" };
  return { kind: "unknown" };
}

export function validateSymbolForProgram(
  rawSymbol: string,
  profile: ProgramProfile,
): ProductValidation[] {
  const status = getSymbolStatus(rawSymbol);
  const out: ProductValidation[] = [];

  switch (status.kind) {
    case "empty":
      return out;

    case "recognized_with_specs":
    case "recognized_no_specs": {
      const symbol = status.product.symbol;
      if (!isSymbolAllowed(profile, symbol)) {
        out.push({
          level: profile.blockingMode === "strict" ? "error" : "warning",
          code: "symbol_not_in_program",
          message: `${symbol} is not allowed under the ${profile.displayName} profile.`,
        });
      }
      if (status.kind === "recognized_no_specs") {
        out.push({
          level: "hint",
          code: "specs_not_added",
          message: "Recognized futures product. Contract specs not added yet, so P&L is manual.",
        });
      }
      return out;
    }

    case "forex": {
      const blocked = profile.blockedCategories.has("forex");
      out.push({
        level: blocked ? (profile.blockingMode === "strict" ? "error" : "warning") : "hint",
        code: "forex_spot_not_supported",
        message: blocked
          ? `Spot forex is not supported in the ${profile.displayName} profile. Use futures symbol 6E/M6E if relevant.`
          : "Spot forex is recognized as non-futures. P&L is manual.",
      });
      return out;
    }

    case "stock": {
      const blocked = profile.blockedCategories.has("stock");
      out.push({
        level: blocked ? (profile.blockingMode === "strict" ? "error" : "warning") : "hint",
        code: "stocks_not_supported",
        message: blocked
          ? `Stocks are not supported in the ${profile.displayName} profile.`
          : "Stocks recognized as non-futures. P&L is manual.",
      });
      return out;
    }

    case "crypto": {
      const blocked = profile.blockedCategories.has("crypto");
      out.push({
        level: blocked ? (profile.blockingMode === "strict" ? "error" : "warning") : "hint",
        code: "crypto_not_supported",
        message: blocked
          ? `Crypto is not supported in the ${profile.displayName} profile. Use micro futures MBT/MET if relevant.`
          : "Crypto recognized as non-futures. P&L is manual.",
      });
      return out;
    }

    case "unknown":
      out.push({
        level: "warning",
        code: "unknown_product",
        message: "Unknown product. P&L, risk, and R are manual unless specs are added.",
      });
      return out;
  }
}

export function validateTradeTime(
  tradedAt: Date,
  product: ProductMetadata | null,
  profile: ProgramProfile,
): ProductValidation[] {
  const out: ProductValidation[] = [];
  const ct = toChicagoTime(tradedAt);
  const tradeMin = ct.hour * 60 + ct.minute;
  const cutoff = getEffectiveCutoffCT(profile, product);
  const resume = profile.resumeCT;
  const sundayOpen = getEffectiveSundayOpenCT(profile, product);

  // Saturday — closed all day under any cutoff-having profile.
  if (cutoff && ct.weekday === 6) {
    out.push({
      level: "warning",
      code: "outside_program_hours",
      message: `Saturday trade — market closed under ${profile.displayName}.`,
    });
    return out;
  }

  // Sunday — only allowed at/after the Sunday open.
  if (sundayOpen && ct.weekday === 0) {
    if (tradeMin < minutesFromMidnight(sundayOpen)) {
      out.push({
        level: "warning",
        code: "before_sunday_open",
        message: `Sunday trade before ${formatTimeOfDayCT(sundayOpen)} — market not open yet under ${profile.displayName}.`,
      });
    }
    return out;
  }

  // Weekday — between the daily cutoff and the resume time the market is closed.
  if (cutoff && ct.weekday >= 1 && ct.weekday <= 5) {
    const cutoffMin = minutesFromMidnight(cutoff);
    if (tradeMin >= cutoffMin) {
      // Trade is after today's cutoff. If we're past the resume time, we're back into the next-day session.
      if (resume && tradeMin >= minutesFromMidnight(resume)) {
        // Inside the post-resume overnight window — treat as next-day session, no warning.
        // Friday post-resume is still the weekend on most futures; warn.
        if (ct.weekday === 5) {
          out.push({
            level: "warning",
            code: "after_friday_close",
            message: `Friday close has passed — trades after ${formatTimeOfDayCT(cutoff)} count toward the next session under ${profile.displayName}.`,
          });
        }
      } else {
        out.push({
          level: "warning",
          code: "after_program_cutoff",
          message: `Outside ${profile.displayName} trading hours. Positions must be flat before ${formatTimeOfDayCT(cutoff)}.`,
        });
      }
    }
  }

  return out;
}

/**
 * Unified trade validation — returns a structured result partitioned into
 * errors, warnings, and hints.  The journal form and history cards should
 * prefer this over calling validateSymbolForProgram / validateTradeTime
 * separately.
 */
export function validateTrade(
  rawSymbol: string,
  tradedAt: Date | null,
  profile: ProgramProfile,
): TradeValidationResult {
  const normalizedSymbol = rawSymbol.trim().toUpperCase();
  const { assetClass, product } = classifySymbol(normalizedSymbol);

  const allValidations: ProductValidation[] = [
    ...validateSymbolForProgram(rawSymbol, profile),
    ...(tradedAt ? validateTradeTime(tradedAt, product, profile) : []),
  ];

  return {
    normalizedSymbol,
    instrument: product,
    assetClass,
    errors:   allValidations.filter((v) => v.level === "error"),
    warnings: allValidations.filter((v) => v.level === "warning"),
    hints:    allValidations.filter((v) => v.level === "hint"),
  };
}

export function getMarketStateAt(
  product: ProductMetadata | null,
  profile: ProgramProfile,
  at: Date,
): MarketState {
  const cutoff = getEffectiveCutoffCT(profile, product);
  const resume = profile.resumeCT;
  const sundayOpen = getEffectiveSundayOpenCT(profile, product);

  // Profile has no schedule constraints — we can't determine state.
  if (!cutoff && !sundayOpen) return "unknown";

  const ct = toChicagoTime(at);
  const tradeMin = ct.hour * 60 + ct.minute;

  if (ct.weekday === 6) return "closed";

  if (ct.weekday === 0) {
    if (!sundayOpen) return "closed";
    return tradeMin < minutesFromMidnight(sundayOpen) ? "pre-open" : "open";
  }

  // Weekdays
  if (cutoff && tradeMin >= minutesFromMidnight(cutoff)) {
    if (resume && tradeMin >= minutesFromMidnight(resume)) {
      // Friday post-cutoff goes into the weekend — closed.
      if (ct.weekday === 5) return "closed";
      return "open";
    }
    if (resume && tradeMin < minutesFromMidnight(resume)) return "paused";
    return "closed";
  }

  // Before cutoff — open if we're past today's open time (treat as open by default).
  // For products with a daytime open (livestock), respect it.
  const dayOpen = product?.daytimeOpenCT;
  if (dayOpen && tradeMin < minutesFromMidnight(dayOpen)) return "pre-open";

  return "open";
}

export function describeMarketState(state: MarketState): string {
  switch (state) {
    case "open": return "Market open";
    case "closed": return "Market closed";
    case "paused": return "Market paused";
    case "pre-open": return "Pre-open";
    case "unknown": return "Schedule unknown";
  }
}
