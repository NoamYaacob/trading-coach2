/**
 * Pure helpers for account rule label derivation and stop-state display.
 *
 * Design intent: the UI must NOT overclaim a specific prop-firm program
 * (e.g. "MFF Builder") from local metadata alone. propFirm + accountType
 * are user-set free text / enum values; without verified program data
 * they only tell us "this is a prop firm evaluation account", not which
 * specific plan (Builder, Pro, Lightning, etc.) it is on.
 *
 * Helpers therefore return generic, honest labels and let callers show
 * the underlying propFirm + accountType as descriptive context separately.
 *
 * No React or Prisma dependencies — all functions are side-effect-free.
 */

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  evaluation: "Evaluation",
  funded: "Funded",
  personal: "Personal",
  demo: "Demo",
};

// ── Prop-firm descriptor ──────────────────────────────────────────────────────

/**
 * Format the prop-firm + account-type metadata as a short descriptor for
 * display (e.g. "MyFundedFutures · Evaluation"). Returns null when no
 * propFirm is set so callers can hide the line entirely.
 *
 * This is intentionally generic — it does not infer or assert a specific
 * program (Builder, Pro, etc.) from the propFirm string.
 */
export function formatPropFirmDescriptor(
  propFirm: string | null,
  accountType: string,
): string | null {
  if (!propFirm) return null;
  const trimmed = propFirm.trim();
  if (!trimmed) return null;
  const typeLabel = ACCOUNT_TYPE_LABEL[accountType] ?? accountType;
  return `${trimmed} · ${typeLabel}`;
}

// ── Rules label ───────────────────────────────────────────────────────────────

/**
 * Returns the rule-source label shown in the compact account row.
 *
 * Priority: account-specific rules > default plan > no rules.
 * Prop firm classification is shown separately as secondary metadata via
 * formatPropFirmDescriptor — it must not appear in the rules label itself
 * because having a propFirm set does not imply any rules are configured.
 */
export function deriveRulesLabel(
  hasAccountRules: boolean,
  hasDefaultRules: boolean,
  _hasPropFirm?: boolean,
): string {
  if (hasAccountRules) return "Account override";
  if (hasDefaultRules) return "Default rules";
  return "No rules configured";
}

// ── Enforcement chip ──────────────────────────────────────────────────────────

/**
 * Returns the label and CSS classes for the enforcement status chip.
 *
 * "Broker-enforced" only fires when a broker lock is explicitly confirmed
 * via brokerLockStatus === "broker_locked". A read-only Tradovate
 * connection cannot reach that branch — the only way to be enforced
 * broker-side is verified write-level access plus an explicit lock event.
 *
 * When the account is STOPPED today, the chip shows
 * "Internal Guardrail lock", scoped to this account's session state.
 */
export function deriveEnforcementLabelValues(
  brokerLockStatus: string | null,
  riskState: string | null,
  sessionDate: string | null,
  today: string,
): { label: string; cls: string } {
  if (brokerLockStatus === "broker_locked") {
    return { label: "Broker-enforced", cls: "bg-emerald-100 text-emerald-700" };
  }
  if (riskState === "STOPPED" && sessionDate === today) {
    return { label: "Internal Guardrail lock", cls: "bg-red-100 text-red-700" };
  }
  return { label: "Monitoring only", cls: "bg-stone-100 text-stone-500" };
}

// ── Stop-state contextual detail ─────────────────────────────────────────────

export type StopContext = {
  /** Generic lock summary, e.g. "Prop firm daily loss limit reached ($1,000). Guardrail marked this account locked …" */
  lockNote: string;
  /** Shown when the connection is read-only to clarify Guardrail did not block orders at the broker. */
  readOnlyNote: string | null;
};

/**
 * Build the contextual text shown below the status chips when an account
 * is STOPPED today. Copy is generic — it does not name a specific program.
 */
export function deriveStopContext(input: {
  hasPropFirm: boolean;
  /** Effective daily loss limit driving the stop (account-specific, prop-firm, or default). */
  dailyLossLimit: number | null;
  connectionStatus: string;
}): StopContext {
  const limitPart =
    input.dailyLossLimit != null
      ? ` ($${input.dailyLossLimit.toLocaleString("en-US")})`
      : "";
  const prefix = input.hasPropFirm
    ? `Prop firm daily loss limit reached${limitPart}.`
    : `Daily loss limit reached${limitPart}.`;
  const lockNote = `${prefix} Guardrail marked this account locked for the protected session.`;

  const readOnlyNote =
    input.connectionStatus === "connected_readonly"
      ? "Broker-side blocking from Guardrail is not active on this read-only connection."
      : null;

  return { lockNote, readOnlyNote };
}
