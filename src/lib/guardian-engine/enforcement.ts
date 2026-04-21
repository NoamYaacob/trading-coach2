import type { InterventionOutcome, DetectionTrigger } from "./types";

/**
 * Enforcement tier model — classifies intervention severity and determines what
 * actions Guardrail takes in response to a rule breach or warning signal.
 *
 * IMPORTANT: "internal_only" means Guardrail sets internal riskState and notifies
 * via Telegram. It does NOT prevent execution at the broker — that would require
 * the Tradovate Trading API (a separate integration, not yet implemented).
 */

export type EnforcementTier =
  | "soft_warning"   // Telegram notification only; riskState unchanged
  | "hard_warning"   // Telegram + riskState=WARNING
  | "cooldown"       // Telegram + riskState=STOPPED + timed cooldown
  | "lockdown";      // Telegram + riskState=STOPPED (manual reset required)

/** What the enforcement action can actually do at the platform level. */
export type EnforcementCapability =
  | "internal_only"  // Guardrail state + Telegram notification; no broker-side action
  | "broker_stop";   // Placeholder: would issue a stop at the broker (not yet implemented)

export type EnforcementPlan = {
  tier: EnforcementTier;
  /** CoachingIntent string used for AI voice generation */
  coachingIntent: string;
  /** What Guardrail can actually enforce on this platform */
  capability: EnforcementCapability;
};

const TRIGGER_TIER: Record<DetectionTrigger, EnforcementTier> = {
  rapid_trading:              "soft_warning",
  outside_allowed_hours:      "soft_warning",
  unrealized_drawdown:        "soft_warning",
  increased_size_after_loss:  "hard_warning",
  revenge_entry:              "hard_warning",
  consecutive_losses:         "cooldown",
  daily_loss_limit:           "lockdown",
  max_trades_reached:         "lockdown",
};

const TRIGGER_INTENT: Record<DetectionTrigger, string> = {
  rapid_trading:              "general_coaching",
  outside_allowed_hours:      "general_coaching",
  unrealized_drawdown:        "general_coaching",
  increased_size_after_loss:  "stop_revenge",
  revenge_entry:              "stop_revenge",
  consecutive_losses:         "acknowledge_multiple_losses",
  daily_loss_limit:           "account_locked",
  max_trades_reached:         "rule_limit_hit",
};

export function buildEnforcementPlan(outcome: InterventionOutcome): EnforcementPlan | null {
  if (outcome.action === "no_action") return null;

  const trigger = outcome.trigger;
  const tier: EnforcementTier = TRIGGER_TIER[trigger] ?? "soft_warning";
  const coachingIntent: string = TRIGGER_INTENT[trigger] ?? "general_coaching";

  return { tier, coachingIntent, capability: "internal_only" };
}

export function formatEnforcementTierLabel(tier: EnforcementTier): string {
  switch (tier) {
    case "soft_warning": return "Warning";
    case "hard_warning": return "Strong warning";
    case "cooldown":     return "Cooldown";
    case "lockdown":     return "Lockdown";
  }
}
