/**
 * Which source of protection rules covers this account.
 *
 *   account — the account has its own rules configured in Trading Plan.
 *   default — the account is covered by the user's Default Trading Plan.
 *   none    — no rules are configured anywhere; enforcement is not active.
 */
export type AccountRuleSource = "account" | "default" | "none";

/**
 * Determines which rule source covers the account.
 * Account-specific rules take priority over the default plan.
 */
export function deriveRuleSource(input: {
  hasAccountRules: boolean;
  hasDefaultRules: boolean;
}): AccountRuleSource {
  if (input.hasAccountRules) return "account";
  if (input.hasDefaultRules) return "default";
  return "none";
}

/**
 * Human-readable label for the account's rule source.
 * Used on the account detail / readiness page.
 */
export function deriveRuleSourceLabel(ruleSource: AccountRuleSource): string {
  switch (ruleSource) {
    case "account":
      return "Account-specific rules active";
    case "default":
      return "Uses Default Trading Plan";
    case "none":
      return "No rules configured";
  }
}

/**
 * Whether any rules cover this account (account-specific OR default plan).
 * Used to determine if the "no rules" readiness state applies.
 */
export function hasAnyCoverage(input: {
  hasAccountRules: boolean;
  hasDefaultRules: boolean;
}): boolean {
  return input.hasAccountRules || input.hasDefaultRules;
}
