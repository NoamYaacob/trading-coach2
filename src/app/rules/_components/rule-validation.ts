/**
 * Pure cross-field validation for rule combinations entered in the
 * Trading Plan forms (default template + account-specific override).
 *
 * No I/O, no framework. Inputs are the raw string values from <input>;
 * blanks are treated as "no opinion" and never produce an error on their
 * own. Errors only fire when both sides of a comparison are present.
 *
 * Used to disable the Save button and surface inline error copy when the
 * user enters a logically impossible combination (e.g. risk-per-trade
 * larger than the daily loss limit).
 */

export type RuleValidationField =
  | "maxDailyLoss"
  | "riskPerTrade"
  | "maxTradesPerDay"
  | "stopAfterLosses";

export type RuleValidationInput = Record<RuleValidationField, string>;

export type RuleValidationError = {
  field: RuleValidationField;
  message: string;
};

function asFloat(v: string): number | null {
  if (!v.trim()) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function asInt(v: string): number | null {
  if (!v.trim()) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

export function validateRules(input: RuleValidationInput): RuleValidationError[] {
  const errors: RuleValidationError[] = [];
  const dl = asFloat(input.maxDailyLoss);
  const rpt = asFloat(input.riskPerTrade);
  const mtpd = asInt(input.maxTradesPerDay);
  const sal = asInt(input.stopAfterLosses);

  if (dl != null && dl <= 0) {
    errors.push({ field: "maxDailyLoss", message: "Daily loss limit must be greater than 0." });
  }
  if (rpt != null && rpt <= 0) {
    errors.push({ field: "riskPerTrade", message: "Risk per trade must be greater than 0." });
  }
  if (mtpd != null && mtpd <= 0) {
    errors.push({ field: "maxTradesPerDay", message: "Max trades per day must be greater than 0." });
  }
  if (sal != null && sal <= 0) {
    errors.push({ field: "stopAfterLosses", message: "Stop after losses must be greater than 0." });
  }

  if (dl != null && rpt != null && dl > 0 && rpt > 0 && rpt > dl) {
    errors.push({
      field: "riskPerTrade",
      message: "Risk per trade cannot be higher than daily loss limit.",
    });
  }
  if (mtpd != null && sal != null && mtpd > 0 && sal > 0 && sal > mtpd) {
    errors.push({
      field: "stopAfterLosses",
      message: "Stop after losses cannot be higher than max trades per day.",
    });
  }

  return errors;
}

/**
 * Resolves the effective value for a field on the account-specific form.
 * If the user left the input blank, the inherited default fills in — and
 * validation must check the effective combination, not just the typed one.
 */
export function effectiveValue(accountValue: string, defaultValue: string | undefined): string {
  return accountValue.trim() ? accountValue : (defaultValue ?? "");
}
