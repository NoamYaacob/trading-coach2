import { MAX_POSITION_SIZE_COPY } from "./position-size-copy.ts";

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

export const SESSION_ALREADY_TRADED_BANNER =
  "Rules are locked for this session — this account has already traded. Changes can be made after the session resets.";

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

// ── Default-template → account-form mapping ─────────────────────────────────

/**
 * Shape returned by the account-form mapping. Mirrors the form's
 * `DefaultRuleValues` prop exactly so a test that catches a key
 * mismatch on the mapping side also catches a desync with the form.
 */
export type AccountFormDefaultValues = {
  maxDailyLoss: string;
  riskPerTrade: string;
  maxTradesPerDay: string;
  stopAfterLosses: string;
  allowedEndHour: string;
  maxContracts: string;
};

/**
 * Subset of the Prisma `RiskRules` row that this mapper inspects. Defined
 * structurally so this module doesn't import @prisma/client.
 */
export type DefaultRulesRow = {
  maxDailyLoss?: { toString(): string } | null;
  riskPerTrade?: { toString(): string } | null;
  /** Legacy: some users have only `maxRiskPerTrade` set on the default
   *  template and `riskPerTrade` is null. Account form expects
   *  `riskPerTrade`; we fall back to `maxRiskPerTrade` so inheritance
   *  doesn't render '—' on the diff baseline. */
  maxRiskPerTrade?: { toString(): string } | null;
  maxTradesPerDay?: number | null;
  stopAfterLosses?: number | null;
  /** Default-template column name. Account form uses `allowedEndHour`; we
   *  remap here so the account-form receives the right key. */
  sessionEndHour?: number | null;
  maxContracts?: number | null;
};

function decimalString(v: { toString(): string } | null | undefined): string {
  return v != null ? Number(v).toString() : "";
}

function intString(v: number | null | undefined): string {
  return v != null ? String(v) : "";
}

/**
 * Convert a default-template `RiskRules` row into the prop shape the account
 * form expects (`DefaultRuleValues`).
 *
 * Two non-trivial mappings happen here:
 *   1. `riskPerTrade` falls back to `maxRiskPerTrade` when the former is null.
 *      Some users were onboarded with only `maxRiskPerTrade` populated.
 *   2. `sessionEndHour` (default-template column) is remapped to
 *      `allowedEndHour` (the account-form key, which mirrors the
 *      AccountRiskRules column).
 *
 * Returns all-empty strings when input is null so the form renders
 * placeholders only — no spurious '—' from missing fields when no default
 * template exists.
 */
export function mapDefaultRulesToAccountForm(
  row: DefaultRulesRow | null | undefined,
): AccountFormDefaultValues {
  if (!row) {
    return {
      maxDailyLoss: "",
      riskPerTrade: "",
      maxTradesPerDay: "",
      stopAfterLosses: "",
      allowedEndHour: "",
      maxContracts: "",
    };
  }
  return {
    maxDailyLoss: decimalString(row.maxDailyLoss),
    riskPerTrade: decimalString(row.riskPerTrade ?? row.maxRiskPerTrade),
    maxTradesPerDay: intString(row.maxTradesPerDay),
    stopAfterLosses: intString(row.stopAfterLosses),
    allowedEndHour: intString(row.sessionEndHour),
    maxContracts: intString(row.maxContracts),
  };
}

// ── Pending field diff rows ──────────────────────────────────────────────────

/**
 * Subset of the form's active-baseline values that the pending diff inspects.
 * Defined locally so this pure module doesn't depend on the form component.
 *
 * The diff splits the "active" side into TWO inputs — the override values
 * (this account's AccountRiskRules row) and the inherited default values
 * (the user's RiskRules row mapped via `mapDefaultRulesToAccountForm`).
 * The function picks override-when-present, inherited-otherwise, and
 * reports which source it used via `activeSource` so the UI can label the
 * value (override / inherited / not_set).
 */
export type PendingDiffBaseline = {
  maxDailyLoss: string;
  riskPerTrade: string;
  maxTradesPerDay: string;
  stopAfterLosses: string;
  allowedEndHour: string;
  maxContracts: string;
};

/** Backwards-compatible alias for the override-only baseline shape. */
export type PendingDiffActiveBaseline = PendingDiffBaseline;

/**
 * Where the row's "active" value came from:
 *   - "override"  — this account has its own value set
 *   - "inherited" — the value comes from the default template
 *   - "not_set"   — neither override nor default has a value
 */
export type PendingFieldActiveSource = "override" | "inherited" | "not_set";

export type PendingFieldRow = {
  label: string;
  active: string;
  pending: string;
  activeSource: PendingFieldActiveSource;
};

/**
 * Resolves which side wins for the active value and reports the source.
 * Override wins when non-empty; otherwise default wins when non-empty;
 * otherwise "not_set".
 */
export function resolvePendingActiveSource(
  overrideValue: string,
  defaultValue: string,
): PendingFieldActiveSource {
  if (overrideValue.trim()) return "override";
  if (defaultValue.trim()) return "inherited";
  return "not_set";
}

/**
 * Builds the rows shown inside the "Pending changes saved" panel.
 *
 * The "active" side of each row MUST come from the DB active baseline
 * (the rules currently in force), NOT from the form's input state. Once
 * the user edits a field and clicks Save during a locked window, the form
 * input now contains the *pending* value — using the form input as the
 * active side would make the diff render `$400 → $400` instead of
 * `$500 → $400`. Callers pass the `initial` prop (server-loaded DB active
 * values) as the baseline.
 *
 * Rows where the formatted active value equals the formatted pending value
 * are filtered out: there is no meaningful change to show, even if the
 * payload key is present (e.g. user re-saved the same value).
 *
 * This shape returns rows without `activeSource`; callers that need to
 * tag rows as Override / Inherited / Not set should use
 * `computePendingFieldRowsWithSource` instead.
 */
export function computePendingFieldRows(input: {
  activeBaseline: PendingDiffBaseline;
  pendingPayload: Record<string, unknown> | null;
  pendingIsDelete: boolean;
}): { label: string; active: string; pending: string }[] {
  if (!input.pendingPayload || input.pendingIsDelete) return [];

  const fmtMoney = (v: string): string => (v.trim() ? `$${v}` : "Not set");
  const fmtCount = (v: string): string => (v.trim() ? v : "Not set");
  const fmtCutoff = (v: string): string => (v.trim() ? `${v}:00 CME` : "Not set");

  const rows: { label: string; active: string; pending: string }[] = [];
  const push = (
    label: string,
    activeRaw: string,
    pendingRaw: string,
    fmt: (v: string) => string,
  ) => {
    const active = fmt(activeRaw);
    const pending = fmt(pendingRaw);
    if (active !== pending) rows.push({ label, active, pending });
  };

  const p = input.pendingPayload;
  const dl = typeof p.maxDailyLoss === "string" ? p.maxDailyLoss : null;
  const rpt = typeof p.riskPerTrade === "string" ? p.riskPerTrade : null;
  const mtpd = typeof p.maxTradesPerDay === "number" ? String(p.maxTradesPerDay) : null;
  const sal = typeof p.stopAfterLosses === "number" ? String(p.stopAfterLosses) : null;
  const aeh = typeof p.allowedEndHour === "number" ? String(p.allowedEndHour) : null;
  const mc = typeof p.maxContracts === "number" ? String(p.maxContracts) : null;

  if (dl !== null) push("Daily loss limit", input.activeBaseline.maxDailyLoss, dl, fmtMoney);
  if (rpt !== null) push("Risk per trade", input.activeBaseline.riskPerTrade, rpt, fmtMoney);
  if (mtpd !== null) push("Max trades / day", input.activeBaseline.maxTradesPerDay, mtpd, fmtCount);
  if (sal !== null) push("Stop after losses", input.activeBaseline.stopAfterLosses, sal, fmtCount);
  if (aeh !== null) push("Cutoff time", input.activeBaseline.allowedEndHour, aeh, fmtCutoff);
  if (mc !== null) push(MAX_POSITION_SIZE_COPY.label, input.activeBaseline.maxContracts, mc, fmtCount);

  return rows;
}

/**
 * Source-aware variant of `computePendingFieldRows`. Takes the override
 * values (this account's AccountRiskRules row) and the inherited default
 * values (the user's RiskRules mapped via mapDefaultRulesToAccountForm)
 * separately, and reports `activeSource` per row so the UI can tag each
 * value as Override / Inherited / Not set.
 *
 * Behaviour rules (mirrors the legacy function on row inclusion):
 *   - override wins per field when non-empty
 *   - inherited default fills in when override is empty
 *   - rows whose formatted active equals the formatted pending are
 *     filtered out (handles the case where the cron promoted the value
 *     but didn't clear pendingPayloadJson — UI must not show 4 → 4)
 */
export function computePendingFieldRowsWithSource(input: {
  override: PendingDiffBaseline;
  defaultBaseline: PendingDiffBaseline;
  pendingPayload: Record<string, unknown> | null;
  pendingIsDelete: boolean;
}): PendingFieldRow[] {
  if (!input.pendingPayload || input.pendingIsDelete) return [];

  const fmtMoney = (v: string): string => (v.trim() ? `$${v}` : "Not set");
  const fmtCount = (v: string): string => (v.trim() ? v : "Not set");
  const fmtCutoff = (v: string): string => (v.trim() ? `${v}:00 CME` : "Not set");

  const rows: PendingFieldRow[] = [];
  const push = (
    label: string,
    overrideRaw: string,
    defaultRaw: string,
    pendingRaw: string,
    fmt: (v: string) => string,
  ) => {
    const activeRaw = overrideRaw.trim() ? overrideRaw : defaultRaw;
    const active = fmt(activeRaw);
    const pending = fmt(pendingRaw);
    if (active !== pending) {
      rows.push({
        label,
        active,
        pending,
        activeSource: resolvePendingActiveSource(overrideRaw, defaultRaw),
      });
    }
  };

  const p = input.pendingPayload;
  const dl = typeof p.maxDailyLoss === "string" ? p.maxDailyLoss : null;
  const rpt = typeof p.riskPerTrade === "string" ? p.riskPerTrade : null;
  const mtpd = typeof p.maxTradesPerDay === "number" ? String(p.maxTradesPerDay) : null;
  const sal = typeof p.stopAfterLosses === "number" ? String(p.stopAfterLosses) : null;
  const aeh = typeof p.allowedEndHour === "number" ? String(p.allowedEndHour) : null;
  const mc = typeof p.maxContracts === "number" ? String(p.maxContracts) : null;

  const o = input.override;
  const d = input.defaultBaseline;
  if (dl !== null) push("Daily loss limit", o.maxDailyLoss, d.maxDailyLoss, dl, fmtMoney);
  if (rpt !== null) push("Risk per trade", o.riskPerTrade, d.riskPerTrade, rpt, fmtMoney);
  if (mtpd !== null) push("Max trades / day", o.maxTradesPerDay, d.maxTradesPerDay, mtpd, fmtCount);
  if (sal !== null) push("Stop after losses", o.stopAfterLosses, d.stopAfterLosses, sal, fmtCount);
  if (aeh !== null) push("Cutoff time", o.allowedEndHour, d.allowedEndHour, aeh, fmtCutoff);
  if (mc !== null) push(MAX_POSITION_SIZE_COPY.label, o.maxContracts, d.maxContracts, mc, fmtCount);

  return rows;
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
  /**
   * True when the account has already traded this session (session_already_traded).
   * The server will 423-reject any save attempt; the button is disabled proactively
   * so the user doesn't need to attempt a save to discover the block.
   * First-time setup (hasExistingRules=false) is exempted — same as the server check.
   */
  isHardLocked?: boolean;
}): AccountSaveButtonState {
  const hasSomethingToSave =
    input.isDirty ||
    !input.hasExistingRules ||
    (!input.hasValidConsent && input.consentChecked);
  const disabled =
    input.saving ||
    input.removing ||
    !hasSomethingToSave ||
    Boolean(input.hasValidationErrors) ||
    Boolean(input.isHardLocked && input.hasExistingRules);
  const label = input.saving
    ? "Saving…"
    : !input.isDirty && input.savedAt && input.pendingMessage
      ? // Pending save just succeeded — distinguish from immediate save so users
        // know their values aren't active yet (matches the in-form pending panel).
        "Saved as pending"
      : !input.isDirty && input.savedAt && !input.pendingMessage && input.hasExistingRules
        ? "Saved"
        : "Save rules";
  return { disabled, label };
}
