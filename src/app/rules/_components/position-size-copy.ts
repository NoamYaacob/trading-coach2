/**
 * UI copy for the Max position size rule.
 *
 * The cap is now broker-synced for connected Tradovate accounts when the
 * user has granted "Account Risk Settings: Full Access" — Guardrail
 * creates a `userAccountPositionLimit` (totalBy = "Overall", active = true)
 * and a `userAccountRiskParameter` with `hardLimit = true`, so Tradovate
 * rejects opening orders that would push net open contracts above the cap.
 *
 * Live reject behavior is implemented but pending demo verification — do
 * not advertise as "fully verified" until orderQty > exposedLimit has been
 * tested on a sim/demo account.
 *
 * For non-Tradovate accounts (and Tradovate accounts without the required
 * permission), the cap remains app-level monitoring only.
 */
export const MAX_POSITION_SIZE_COPY = {
  label: "Max position size",
  hint:
    "Synced to Tradovate as a broker-side position limit when " +
    "Account Risk Settings permission is available. Otherwise " +
    "enforced by Guardrail at the app level only.",
} as const;
