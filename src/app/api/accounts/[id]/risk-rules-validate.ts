/**
 * Server-side validation for the AccountRiskRules PATCH body.
 *
 * Pure function: returns the first error message found, or null if the body
 * is acceptable. Used by /api/accounts/[id] to reject out-of-range hour
 * values (e.g. 123, decimals) and negative counts even if the client
 * bypassed the cutoff dropdown.
 */

export type RiskRulesValidationError = { field: string; message: string };

const HOUR_FIELDS = ["allowedStartHour", "allowedEndHour"] as const;
const NON_NEGATIVE_INT_FIELDS = ["maxTradesPerDay", "stopAfterLosses", "maxContracts"] as const;

export function validateRiskRulesBody(
  body: unknown,
): RiskRulesValidationError | null {
  if (body == null) return null;
  if (typeof body !== "object") return null;
  const o = body as Record<string, unknown>;

  for (const key of HOUR_FIELDS) {
    const v = o[key];
    if (v == null) continue;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 23) {
      return { field: key, message: `${key} must be an integer between 0 and 23.` };
    }
  }

  for (const key of NON_NEGATIVE_INT_FIELDS) {
    const v = o[key];
    if (v == null) continue;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      return { field: key, message: `${key} must be a non-negative integer.` };
    }
  }

  return null;
}
