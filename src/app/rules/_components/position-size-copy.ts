/**
 * UI copy for the Max position size rule.
 *
 * The value is expressed in standard-equivalent contracts (Apex model):
 *   1 NQ  = 1 standard
 *   1 MNQ = 0.1 standard (micro = 0.1 of standard; maxContracts=1 allows 10 MNQ)
 *   Same 1:10 ratio applies to ES/MES, YM/MYM, RTY/M2K.
 *
 * Enforcement model (detection-response, NOT pre-trade):
 *   Guardrail cannot intercept orders before they execute at Tradovate. Enforcement
 *   is detection-response only: cron sync (~every 5 min) reads live positions,
 *   computes standard-equivalent exposure, and locks/flattens if the limit is exceeded.
 *   Orders placed before detection will fill first.
 *
 * Why no broker-side hard limit (intentionally not set):
 *   Tradovate's position limit API only supports totalBy="Overall" (global raw contract
 *   count). PerContract and PerProduct were probed against the live Tradovate API and
 *   returned HTTP 400 "illegal enum value" — product-specific broker limits are not
 *   available. Setting a raw global cap to maxContracts=1 would incorrectly block
 *   2 MNQ (each micro = 0.1 standard-equivalent, well within a 1-standard limit).
 */
export const MAX_POSITION_SIZE_COPY = {
  label: "Max standard-equivalent contracts",
  hint:
    "Guardrail uses this limit to monitor position size. " +
    "Standard-equivalent sizing lets 1 NQ equal 10 MNQ.",
} as const;
