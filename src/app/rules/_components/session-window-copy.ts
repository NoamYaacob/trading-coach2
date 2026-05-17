/**
 * Copy strings for the daily cutoff fieldset.
 * Centralised here so tests can assert on the exact wording.
 *
 * NOTE: Session start hour and trading-days selectors have been removed from
 * the product surface. Broker-level time-window order rejection is not
 * confirmed in the Tradovate API. The only time-based enforcement Guardrail
 * currently supports is the daily cutoff (sessionEndHour).
 */
export const SESSION_WINDOW_COPY = {
  legend: "Daily cutoff · CME time",
  helperText:
    "Times are anchored to CME time so futures sessions stay aligned through daylight-saving changes.",
  endLabel: "Stop trading at (CME hour)",
  endHint:
    "Saved in Guardrail. Automatic cutoff scheduling is not active yet — Guardrail will warn around this time but will not close positions or lock at this hour today.",
  cutoffBehaviorLabel: "At cutoff",
  localPreviewPrefix: "Your local time:",
} as const;
