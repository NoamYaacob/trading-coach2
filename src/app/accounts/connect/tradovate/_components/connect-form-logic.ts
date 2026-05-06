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

// ── Environment defaults ──────────────────────────────────────────────────────

/** The environment that should be pre-selected when the user first picks a source. */
export function getDefaultEnv(source: AccountSource): TradovateEnv {
  return source === "personal" ? "live" : "demo";
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
 * Returns the helper text shown below the environment selector for the given
 * source + env combination. Returns null when no extra guidance is needed.
 */
export function getEnvHint(source: AccountSource, env: TradovateEnv): string | null {
  switch (source) {
    case "demo":
      return "Paper trading accounts use the Demo/Simulation environment.";
    case "personal":
      return env === "live"
        ? null
        : "Most personal brokerage accounts use Live.";
    case "prop_firm":
      return env === "demo"
        ? "Most prop firm evaluation and simulated funded accounts use Demo/Simulation. Choose Live only if your prop firm account appears in Tradovate Live."
        : "Use Live only if this prop firm account appears in Tradovate Live.";
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
