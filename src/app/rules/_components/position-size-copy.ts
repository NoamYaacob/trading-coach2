/**
 * UI copy for the Max position size rule.
 *
 * The value is expressed in mini-equivalent contracts:
 *   1 NQ  = 1 mini   (full-size mini)
 *   1 MNQ = 0.1 mini (micro = 0.1 of a mini, so maxContracts=1 allows 10 MNQ)
 *   Same 1:10 ratio applies to ES/MES, YM/MYM, RTY/M2K.
 *
 * Broker-side enforcement note:
 *   Guardrail syncs the raw value (maxContracts) to a Tradovate
 *   UserAccountPositionLimit (totalBy="Overall", hardLimit=true) when the
 *   account has "Account Risk Settings: Full Access" permission. Tradovate's
 *   global limit enforces a single raw contract count across all positions —
 *   it cannot express mini-equivalent weighting. Mini-equivalent scaling
 *   is applied by Guardrail at the app level only.
 *
 * For non-Tradovate accounts (and Tradovate accounts without the required
 * permission), the cap is app-level monitoring only.
 */
export const MAX_POSITION_SIZE_COPY = {
  label: "Max position size (mini-equivalent)",
  hint:
    "Micro E-mini contracts count as 0.1 mini — example: maxContracts=1 allows 10 MNQ or 10 MES. " +
    "Synced to Tradovate as a broker-side position limit when " +
    "Account Risk Settings permission is available. " +
    "Note: the broker enforces a raw contract count across all positions; " +
    "mini-equivalent weighting is applied by Guardrail at the app level only.",
} as const;
