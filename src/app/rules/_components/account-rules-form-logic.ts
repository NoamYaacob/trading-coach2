export type AccountRulesFormBanner =
  | { kind: "none" }
  | { kind: "first_time"; message: string }
  | { kind: "locked"; message: string };

export const FIRST_TIME_SETUP_BANNER =
  "First-time setup · These account-specific rules will apply immediately after saving.";

export const LOCKED_BANNER =
  "Rule changes are locked during your active trading session. Changes will apply at the next edit window.";

export const REVIEW_INHERITED_HINT = "Review these inherited limits before saving.";

/**
 * Determines which banner (if any) should appear above the account rules form.
 *
 * First-time setup (no existing account-specific rules) bypasses the session
 * lock — there is nothing to weaken, so the change applies immediately.
 *
 * @param lockMessage - Session-aware message from the server explaining why editing is locked.
 */
export function computeAccountRulesBanner(
  hasExistingRules: boolean,
  isLocked: boolean,
  showForm: boolean,
  lockMessage?: string | null,
): AccountRulesFormBanner {
  if (!showForm) return { kind: "none" };
  if (!hasExistingRules) return { kind: "first_time", message: FIRST_TIME_SETUP_BANNER };
  if (isLocked) {
    return {
      kind: "locked",
      message: lockMessage ?? LOCKED_BANNER,
    };
  }
  return { kind: "none" };
}

/**
 * True when the save should be applied immediately (not deferred to the next
 * trading day). First-time setup is always immediate regardless of lock state.
 */
export function canSaveAccountRulesNow(hasExistingRules: boolean, isLocked: boolean): boolean {
  if (!hasExistingRules) return true;
  return !isLocked;
}
