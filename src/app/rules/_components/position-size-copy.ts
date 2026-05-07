export const MAX_POSITION_SIZE_COPY = {
  label: "Max position size",
  hint: "App-level monitoring — Guardrail tracks this limit but broker-side blocking is not yet active. Measured in mini-equivalent exposure: 1 NQ = 10 MNQ, so a limit of 2 allows 2 NQ, 20 MNQ, or 1 NQ + 10 MNQ. Actual trades are placed as whole contracts per symbol.",
} as const;
