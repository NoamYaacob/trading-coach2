export type PriceFieldName = "exitPrice" | "stopPrice" | "targetPrice";

export type PriceValidationError = {
  field: PriceFieldName;
  message: string;
  severity: "error" | "warning";
};

/**
 * Direction-aware validation for stop and target prices relative to entry.
 * Returns errors when stop/target are on the wrong side of entry for the
 * given direction. Apply only when entryPrice is known.
 *
 * Exit price is intentionally not checked here — an exit below entry on a Long
 * is a loss, which is valid and common.
 */
export function validateDirectionPrices({
  direction,
  entryPrice,
  stopPrice,
  targetPrice,
}: {
  direction: "LONG" | "SHORT";
  entryPrice: number | null;
  stopPrice: number | null;
  targetPrice: number | null;
}): PriceValidationError[] {
  if (entryPrice === null) return [];
  const errors: PriceValidationError[] = [];

  if (stopPrice !== null) {
    if (direction === "LONG" && stopPrice >= entryPrice) {
      errors.push({
        field: "stopPrice",
        message: "Long stop must be below entry price.",
        severity: "error",
      });
    } else if (direction === "SHORT" && stopPrice <= entryPrice) {
      errors.push({
        field: "stopPrice",
        message: "Short stop must be above entry price.",
        severity: "error",
      });
    }
  }

  if (targetPrice !== null) {
    if (direction === "LONG" && targetPrice <= entryPrice) {
      errors.push({
        field: "targetPrice",
        message: "Long target must be above entry price.",
        severity: "error",
      });
    } else if (direction === "SHORT" && targetPrice >= entryPrice) {
      errors.push({
        field: "targetPrice",
        message: "Short target must be below entry price.",
        severity: "error",
      });
    }
  }

  return errors;
}

/**
 * Detects obviously unrealistic prices by checking whether any candidate
 * price is more than `thresholdFraction` (default 0.20 = 20%) away from
 * entryPrice. Intended only for known futures where the expected price range
 * is well-defined. A ratio > 0.20 almost always means a missing zero.
 */
export function validateUnrealisticPrices({
  entryPrice,
  prices,
  thresholdFraction = 0.20,
}: {
  entryPrice: number;
  prices: Array<{ field: PriceFieldName; value: number | null; label: string }>;
  thresholdFraction?: number;
}): PriceValidationError[] {
  if (entryPrice <= 0) return [];
  const errors: PriceValidationError[] = [];
  const pct = Math.round(thresholdFraction * 100);

  for (const { field, value, label } of prices) {
    if (value === null) continue;
    const distance = Math.abs(value - entryPrice) / entryPrice;
    if (distance > thresholdFraction) {
      errors.push({
        field,
        message: `${label} is more than ${pct}% away from entry price. Check for a typo.`,
        severity: "error",
      });
    }
  }

  return errors;
}

/**
 * Formats a gross/fees/net breakdown for display in the form.
 * Example: "Gross: +$400.00 · Fees: $1.50 · Net: +$398.50"
 */
export function formatPnlBreakdown(grossPnl: number, fees: number, netPnl: number): string {
  const fmtSigned = (n: number) => {
    const abs = Math.abs(n).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return n >= 0 ? `+$${abs}` : `−$${abs}`;
  };
  const fmtUnsigned = (n: number) =>
    `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return `Gross: ${fmtSigned(grossPnl)} · Fees: ${fmtUnsigned(fees)} · Net: ${fmtSigned(netPnl)}`;
}

/**
 * Placeholder fee-estimate configuration. No real numbers are populated here —
 * fees vary by broker, prop firm, and account type. When a real source is
 * verified, populate defaultPerContractRoundTurn and update source/checkedAt.
 *
 * Round-turn = entry commission + exit commission combined.
 */
export const FEE_ESTIMATES = {
  futures: {
    defaultPerContractRoundTurn: null as number | null,
    source: "manual" as const,
    note: "No default set. Populate from verified broker/prop-firm schedule.",
  },
} as const;

/**
 * Parses a user-entered numeric string. Returns null for empty or invalid input.
 * A lone "-" (intermediate state while typing a negative number) returns null.
 */
export function parseNumericInput(value: string): number | null {
  if (value.trim() === "") return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Returns an error message string if value is negative, null otherwise.
 * Used for fields that must be non-negative (quantity, fees).
 */
export function validateNonNegativeField(
  value: number | null,
  label: string,
): string | null {
  if (value !== null && value < 0) {
    return `${label} cannot be negative.`;
  }
  return null;
}

/**
 * Toggles the sign of a numeric input string:
 *   ""     → "-"
 *   "-"    → ""
 *   "120"  → "-120"
 *   "-120" → "120"
 */
export function toggleSign(value: string): string {
  if (value === "-") return "";
  if (value === "") return "-";
  return value.startsWith("-") ? value.slice(1) : `-${value}`;
}
