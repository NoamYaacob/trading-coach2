export type AccountRulesFormBanner =
  | { kind: "none" }
  | { kind: "first_time"; message: string }
  | { kind: "locked"; message: string };

export const FIRST_TIME_SETUP_BANNER =
  "First-time setup — these account-specific rules will apply immediately after saving.";

// Editing is always allowed. The "locked" banner explains that saves made
// during active trading are queued as pending and activated automatically
// when this account reaches its next safe window (Guardrail lockout, CME
// daily maintenance, weekend close, or market close).
export const LOCKED_BANNER =
  "You can edit anytime. Saving while this account is in active trading queues the change as pending — it activates automatically at the account's next safe window.";

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

// ── Pending panel visibility ─────────────────────────────────────────────────

/**
 * Determines whether the "Pending changes saved" yellow panel should appear.
 *
 * The panel is only shown when at least one value actually differs between the
 * active state and the pending payload. This guards against a scenario where
 * the cron has already promoted the pending values to active columns but the
 * pendingPayloadJson column has not yet been cleared (e.g. a Prisma JSON-null
 * write that reads back as a non-null sentinel in some Prisma versions). In
 * that case both active and pending would be identical — the panel must be
 * hidden because there is nothing meaningful left to display.
 *
 * @param pendingFieldRows  Pairs of { active, pending } display strings for
 *   each field that is present in the pending payload. Pass the FULL list
 *   (including identical pairs) — this function does the filtering.
 * @param pendingIsDelete   True when the pending payload is { __delete: true }.
 * @param hasPendingPayload True when pendingPayloadJson is non-null.
 * @param pendingSessionPresets  Pending session preset IDs, or null if not pending.
 * @param activeSessionPresets   Active session preset IDs (current form state).
 * @param isDirty  True when the user has unsaved edits — hides the panel while editing.
 */
export function computeShowPendingPanel(input: {
  pendingFieldRows: { active: string; pending: string }[];
  pendingIsDelete: boolean;
  hasPendingPayload: boolean;
  pendingSessionPresets: string[] | null;
  activeSessionPresets: string[];
  isDirty: boolean;
}): boolean {
  if (input.isDirty) return false;
  // Delete-override sentinel: always show if there is an active payload.
  if (input.pendingIsDelete && input.hasPendingPayload) return true;
  // Show when at least one field value actually differs.
  const hasFieldDiff = input.pendingFieldRows.some((r) => r.active !== r.pending);
  if (hasFieldDiff) return true;
  // Show when session presets differ (order-independent comparison).
  if (input.pendingSessionPresets !== null) {
    const pendingSorted = [...input.pendingSessionPresets].sort().join(",");
    const activeSorted = [...input.activeSessionPresets].sort().join(",");
    if (pendingSorted !== activeSorted) return true;
  }
  return false;
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
