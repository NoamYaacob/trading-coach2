/**
 * Pure logic for the Tradovate connect form.
 *
 * "demo" here is the accountSource value for Paper trading accounts — it is
 * the value sent to the backend API and is distinct from the Tradovate
 * environment ("demo" | "live"). The naming overlap is unfortunate but kept
 * for API compatibility.
 */

export type AccountSource = "prop_firm" | "personal" | "demo" | "other";
export type TradovateEnv = "demo" | "live";

// ── Prop firm phase ───────────────────────────────────────────────────────────

export const PROP_FIRM_PHASES = [
  { value: "evaluation",  label: "Evaluation / Challenge / Combine" },
  { value: "funded_sim",  label: "Funded / Sim funded" },
  { value: "live_funded", label: "Live funded" },
  { value: "not_sure",    label: "Not sure" },
] as const;

export type PropFirmPhase = (typeof PROP_FIRM_PHASES)[number]["value"];

export const DEFAULT_PROP_FIRM_PHASE: PropFirmPhase = "evaluation";

// ── Environment defaults ──────────────────────────────────────────────────────

/** The environment that should be pre-selected when the user first picks a source. */
export function getDefaultEnv(source: AccountSource): TradovateEnv {
  return source === "personal" ? "live" : "demo";
}

/**
 * The environment that should be applied when the user picks a prop firm phase.
 * Live funded is the only phase that defaults to Live.
 */
export function getDefaultEnvForPhase(phase: PropFirmPhase): TradovateEnv {
  return phase === "live_funded" ? "live" : "demo";
}

// ── Constraints ───────────────────────────────────────────────────────────────

/**
 * Whether the Live environment is a valid choice for the given account source.
 * Paper trading accounts (source="demo") can only use Demo/Simulation.
 */
export function isLiveAllowed(source: AccountSource): boolean {
  return source !== "demo";
}

/**
 * Whether the environment selection is forced (cannot be changed by the user).
 * Only paper trading accounts force Demo.
 */
export function isEnvForced(source: AccountSource): boolean {
  return source === "demo";
}

// ── Contextual hint ───────────────────────────────────────────────────────────

/**
 * Returns the helper text shown below the environment selector.
 * For prop firm accounts, pass the current phase for phase-specific copy.
 * Returns null when no extra guidance is needed.
 */
export function getEnvHint(
  source: AccountSource,
  env: TradovateEnv,
  phase?: PropFirmPhase,
): string | null {
  switch (source) {
    case "demo":
      return "Paper trading accounts use the Demo/Simulation environment.";
    case "personal":
      return env === "live"
        ? null
        : "Most personal brokerage accounts use Live.";
    case "prop_firm":
      switch (phase) {
        case "evaluation":
          return "Most prop firm evaluations, challenges, and combines use Demo/Simulation.";
        case "funded_sim":
          return "Most prop firm funded accounts are simulated and use Demo/Simulation.";
        case "live_funded":
          return "Live funded prop firm accounts use Tradovate Live. Choose this only if the account appears under Tradovate Live.";
        default:
          return "Choose the environment where the account appears in Tradovate.";
      }
    case "other":
      return "Choose the environment where the account appears in Tradovate.";
  }
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Returns a validation error string, or null when the combination is valid.
 * Paper trading accounts cannot be submitted with the Live environment.
 */
export function validateSourceEnv(
  source: AccountSource,
  env: TradovateEnv,
): string | null {
  if (source === "demo" && env === "live") {
    return "Paper trading accounts use the Demo/Simulation environment, not Live.";
  }
  return null;
}
