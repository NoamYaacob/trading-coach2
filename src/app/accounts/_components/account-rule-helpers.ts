/**
 * Pure helpers for account rule label derivation and stop-state display.
 * No React or Prisma dependencies — all functions are side-effect-free and
 * straightforward to unit-test.
 */

// ── Prop-firm detection ────────────────────────────────────────────────────────

/**
 * Map a free-text propFirm string + accountType to a short display label.
 * Returns null for unknown firms so callers can fall back gracefully.
 */
export function derivePropFirmLabel(
  propFirm: string | null,
  accountType: string,
): string | null {
  if (!propFirm) return null;
  const n = propFirm.toLowerCase();
  if (n.includes("myfunded") || n === "mff") {
    if (accountType === "evaluation") return "MFF Builder";
    if (accountType === "funded") return "MFF Funded";
    return "MFF";
  }
  return null;
}

// ── Rules label ───────────────────────────────────────────────────────────────

/**
 * Returns the rule-source label shown in the compact account row.
 *
 * Priority: account-specific rules > default plan > no rules.
 * When the account belongs to a known prop firm, the label is enriched with
 * the firm's short name so users can see "MFF Builder rule" or
 * "Default plan · MFF Builder" instead of generic labels.
 */
export function deriveRulesLabel(
  hasAccountRules: boolean,
  hasDefaultRules: boolean,
  propFirm: string | null,
  accountType: string,
): string {
  const firm = derivePropFirmLabel(propFirm, accountType);
  if (hasAccountRules) return firm ? `${firm} rule` : "Account rules";
  if (hasDefaultRules) return firm ? `Default plan · ${firm}` : "Default plan";
  return "No rules";
}

// ── Enforcement chip ──────────────────────────────────────────────────────────

/**
 * Returns the label and CSS classes for the enforcement status chip.
 *
 * "Broker-enforced" only fires when a broker lock is explicitly confirmed —
 * a read-only connection never reaches that branch. When the account is
 * STOPPED today, the chip shows "Internal lock", scoped to this account's
 * session state (not to the broker connection or the user).
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
    return { label: "Internal lock", cls: "bg-red-100 text-red-700" };
  }
  return { label: "Monitoring only", cls: "bg-stone-100 text-stone-500" };
}

// ── Stop-state contextual detail ─────────────────────────────────────────────

export type StopContext = {
  /** One-line lock note, e.g. "MFF Builder daily loss limit reached ($1,000). Guardrail marked this account locked." */
  lockNote: string;
  /** Shown when the connection is read-only to clarify Guardrail did not block orders at the broker. */
  readOnlyNote: string | null;
  /** Shown for MFF accounts to surface the prop firm's own soft-pause behaviour. */
  softPauseNote: string | null;
};

/**
 * Build the contextual text shown below the status chips when an account is STOPPED.
 * Returns null when the account is not in a stopped state (caller is responsible for gating).
 */
export function deriveStopContext(input: {
  propFirm: string | null;
  accountType: string;
  /** Effective daily loss limit driving the stop (account-specific, prop-firm, or default). */
  dailyLossLimit: number | null;
  connectionStatus: string;
}): StopContext {
  const firm = derivePropFirmLabel(input.propFirm, input.accountType);
  const limitPart =
    input.dailyLossLimit != null
      ? ` ($${input.dailyLossLimit.toLocaleString("en-US")})`
      : "";
  const prefix = firm
    ? `${firm} daily loss limit reached${limitPart}.`
    : `Daily loss limit reached${limitPart}.`;
  const lockNote = `${prefix} Guardrail marked this account locked for the protected session.`;

  const readOnlyNote =
    input.connectionStatus === "connected_readonly"
      ? "Broker-side blocking from Guardrail is not active on this read-only connection."
      : null;

  const softPauseNote =
    firm?.startsWith("MFF")
      ? "MyFundedFutures may apply its own soft pause according to its rules. Guardrail shows the account as stopped inside the app based on the detected rule breach."
      : null;

  return { lockNote, readOnlyNote, softPauseNote };
}
