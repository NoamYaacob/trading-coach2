/**
 * Copy strings for the protected session window fieldset.
 * Centralised here so tests can assert on the exact wording.
 */
export const SESSION_WINDOW_COPY = {
  legend: "Protected session window · CME time",
  helperText:
    "Guardrail anchors this window to America/Chicago time so futures sessions stay aligned through US/Israel daylight-saving changes.",
  startLabel: "Session start (CME hour 0–23)",
  endLabel: "Session end (CME hour 0–23)",
  localPreviewPrefix: "Your local time:",
} as const;
