export type AccountRulesFormBanner =
  | { kind: "none" }
  | { kind: "first_time"; message: string }
  | { kind: "locked"; message: string };

export const FIRST_TIME_SETUP_BANNER =
  "First-time setup — these account-specific rules will apply immediately after saving.";

export const LOCKED_BANNER =
  "Rules are locked during your active trading session. Changes will apply at the next edit window.";

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

// ── Save button state ────────────────────────────────────────────────────────

export type AccountSaveButtonState = {
  /** Whether the Save button should be disabled. */
  disabled: boolean;
  /** Visible label: "Save rules", "Saving…", or "Saved". */
  label: string;
};

/**
 * Derives the disabled/label state of the account-rules Save button.
 *
 * Enabled when:
 *   - the form is dirty (any field changed since load), OR
 *   - this is a first-time setup (no rules exist yet — saving creates them), OR
 *   - the user just ticked the consent checkbox (consent itself is a saveable change).
 *
 * After a successful save, isDirty flips back to false and savedAt is stamped,
 * which renders the "Saved" label and re-disables the button until the next edit.
 */
export function computeAccountSaveButtonState(input: {
  isDirty: boolean;
  saving: boolean;
  removing: boolean;
  hasExistingRules: boolean;
  hasValidConsent: boolean;
  consentChecked: boolean;
  savedAt: Date | null;
  pendingMessage: string | null;
  /** True when cross-field validation reports any error. Disables save. */
  hasValidationErrors?: boolean;
}): AccountSaveButtonState {
  const hasSomethingToSave =
    input.isDirty ||
    !input.hasExistingRules ||
    (!input.hasValidConsent && input.consentChecked);
  const disabled =
    input.saving ||
    input.removing ||
    !hasSomethingToSave ||
    Boolean(input.hasValidationErrors);
  const label = input.saving
    ? "Saving…"
    : !input.isDirty && input.savedAt && !input.pendingMessage && input.hasExistingRules
      ? "Saved"
      : "Save rules";
  return { disabled, label };
}
