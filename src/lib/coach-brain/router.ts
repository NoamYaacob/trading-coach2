import type { CoachBrainInput, CoachMode } from "./types";

const DISTRESS_ACTIONS = new Set([
  "fomo",
  "angry",
  "out-of-control",
  "dragged",
  "revenge",
  "stop-me",
]);

const REFLECTIVE_ACTIONS = new Set(["day-summary", "check-in", "back-in-control"]);

/** Deterministic, no model calls. */
export function routeToMode(input: CoachBrainInput): CoachMode {
  const { actionId, traderState, sessionEnded } = input;
  const state = traderState.toLowerCase();

  // Factual: always code-only, never model
  if (actionId === "rule-limits" || actionId === "remaining") return "factual";

  // Safety overrides: lockout, violation, cooldown → distress
  if (input.guardianLocked || input.hasBlockingViolation || input.cooldownActive) return "distress";

  // Explicit distress button presses
  if (actionId && DISTRESS_ACTIONS.has(actionId)) return "distress";

  // State-derived distress
  if (
    state.includes("fomo") ||
    state.includes("revenge") ||
    state.includes("tilt") ||
    state.includes("out_of_control") ||
    state.includes("just_took_loss")
  )
    return "distress";

  // Explicit reflective actions
  if (actionId && REFLECTIVE_ACTIONS.has(actionId)) return "reflective";

  // Session-end always triggers reflection
  if (sessionEnded) return "reflective";

  // Calm / reset / premarket states → reflective
  if (
    state.includes("reset") ||
    state.includes("calm") ||
    state.includes("premarket")
  )
    return "reflective";

  return "free_text";
}
