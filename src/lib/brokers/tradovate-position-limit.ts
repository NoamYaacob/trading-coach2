/**
 * Pure helpers for Tradovate broker-side Max Position Size enforcement.
 *
 * Tradovate's position limit system uses two linked objects:
 *   - UserAccountPositionLimit: caps the maximum net open contracts
 *     (`exposedLimit`) per account. `totalBy = "Overall"` applies the
 *     cap across all contracts rather than per-symbol.
 *   - UserAccountRiskParameter: marks the above limit as a hard limit
 *     (`hardLimit = true`) so Tradovate rejects orders that would breach
 *     it, not just alerts the user.
 *
 * Guardrail owns at most ONE position limit per account, identified by
 * description = GUARDRAIL_POSITION_LIMIT_DESCRIPTION. This prevents
 * accidentally touching limits the user or their prop firm created manually.
 *
 * No I/O. No framework imports. Safe to unit-test directly.
 */

export const GUARDRAIL_POSITION_LIMIT_DESCRIPTION = "Guardrail Max Position Size";

// ── Raw Tradovate API shapes ──────────────────────────────────────────────────

export type TvUserAccountPositionLimit = {
  id?: number;
  accountId?: number;
  /** Max net open contracts this account may hold simultaneously. */
  exposedLimit?: number | null;
  /**
   * Aggregation scope. "Overall" applies the cap across all contracts.
   * Other possible values: "PerContract", "PerProduct".
   */
  totalBy?: string | null;
  active?: boolean | null;
  description?: string | null;
};

export type TvUserAccountRiskParameter = {
  id?: number;
  userAccountPositionLimitId?: number;
  /**
   * When true Tradovate rejects orders that would breach the position
   * limit at the broker level, rather than merely alerting. This is the
   * enforcement mode Guardrail needs.
   */
  hardLimit?: boolean | null;
};

// ── Result types ─────────────────────────────────────────────────────────────

export type PositionLimitAction =
  | "created"
  | "updated"
  | "deactivated"
  | "skipped"
  /**
   * Returned when brokerEnforcementMode is "app_side_only": any existing
   * Guardrail-owned global raw limit was deactivated (or was absent) and no new
   * raw limit was written. App-side standard-equivalent enforcement handles the cap.
   */
  | "app_side_only";

export type PositionLimitSyncResult = {
  action: PositionLimitAction;
  /** Endpoint(s) used: "none" when action is "skipped". */
  endpoints: string[];
  positionLimitPayload: Record<string, unknown> | null;
  riskParameterPayload: Record<string, unknown> | null;
  positionLimitResponse: unknown;
  riskParameterResponse: unknown;
};

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Finds the Guardrail-owned position limit record in an array of records
 * returned by `/userAccountPositionLimit/deps`. Returns null when none exists.
 *
 * Guardrail only manages limits whose description matches exactly
 * GUARDRAIL_POSITION_LIMIT_DESCRIPTION. This prevents touching limits
 * the user or their prop firm created independently.
 */
export function findGuardrailPositionLimit(
  limits: TvUserAccountPositionLimit[],
): TvUserAccountPositionLimit | null {
  return limits.find((l) => l.description === GUARDRAIL_POSITION_LIMIT_DESCRIPTION) ?? null;
}

/**
 * Builds the POST body for `userAccountPositionLimit/create`.
 */
export function buildCreatePositionLimitPayload(
  tvAccountId: number,
  maxContracts: number,
): Record<string, unknown> {
  return {
    accountId: tvAccountId,
    exposedLimit: maxContracts,
    totalBy: "Overall",
    active: true,
    description: GUARDRAIL_POSITION_LIMIT_DESCRIPTION,
  };
}

/**
 * Builds the POST body for `userAccountPositionLimit/update`.
 */
export function buildUpdatePositionLimitPayload(
  id: number,
  maxContracts: number,
): Record<string, unknown> {
  return {
    id,
    exposedLimit: maxContracts,
    active: true,
  };
}

/**
 * Builds the POST body for `userAccountPositionLimit/update` that
 * deactivates the limit without deleting the record. Tradovate's delete
 * endpoints may not be available on all account tiers; deactivation is
 * the safe fallback for clearing Guardrail enforcement.
 */
export function buildDeactivatePositionLimitPayload(id: number): Record<string, unknown> {
  return { id, active: false };
}

/**
 * Builds the POST body for `userAccountRiskParameter/create`.
 * Sets `hardLimit = true` so Tradovate rejects breaching orders at the
 * broker level rather than merely alerting.
 */
export function buildCreateRiskParameterPayload(
  userAccountPositionLimitId: number,
): Record<string, unknown> {
  return { userAccountPositionLimitId, hardLimit: true };
}

/**
 * Builds the POST body for `userAccountRiskParameter/update`.
 */
export function buildUpdateRiskParameterPayload(id: number): Record<string, unknown> {
  return { id, hardLimit: true };
}

/**
 * Builds the POST body for `userAccountRiskParameter/update` to clear the
 * hard limit before deactivating the parent position limit record.
 * Clearing hardLimit first avoids Tradovate rejecting the position limit
 * deactivation while an active hard-limit enforcement record is still attached.
 */
export function buildDeactivateRiskParameterPayload(id: number): Record<string, unknown> {
  return { id, hardLimit: false };
}

/**
 * Builds the POST body for `userAccountPositionLimit/update` using the full
 * existing record with active=false. Some Tradovate account tiers reject a
 * minimal `{ id, active: false }` payload and require all fields to be present.
 * Used as a retry after the minimal deactivation payload fails.
 */
export function buildDeactivatePositionLimitFullPayload(
  existing: TvUserAccountPositionLimit,
): Record<string, unknown> {
  return { ...existing, active: false };
}
