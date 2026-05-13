/**
 * UI copy for the Max position size rule.
 *
 * The value is expressed in standard-equivalent contracts (Apex model):
 *   1 NQ  = 1 standard
 *   1 MNQ = 0.1 standard (micro = 0.1 of standard; maxContracts=1 allows 10 MNQ)
 *   Same 1:10 ratio applies to ES/MES, YM/MYM, RTY/M2K.
 *
 * Broker-side enforcement note:
 *   Tradovate's global position limit (totalBy="Overall") enforces a single raw
 *   contract count and cannot express standard-equivalent weighting. Standard-
 *   equivalent scaling is applied by Guardrail at the app level only.
 */
export const MAX_POSITION_SIZE_COPY = {
  label: "Max standard-equivalent contracts",
  hint:
    "1 standard-equivalent allows up to 10 micro contracts on supported micro futures " +
    "(e.g. 1 NQ-equivalent = 10 MNQ, 1 ES-equivalent = 10 MES). " +
    "The broker hard limit at Tradovate is raw-contract based and cannot express standard-equivalent weighting — " +
    "Guardrail monitors exposure and can alert, lock, or flatten after detection when order permissions are enabled.",
} as const;
