/**
 * Persisted consent for automated broker actions.
 *
 * Before any real Tradovate broker write (lockout via userAccountAutoLiq or
 * position-close via order/liquidatepositions) is allowed, the user must have
 * explicitly consented to automated lockout and position-close. The consent
 * is recorded on the rule record (default `RiskRules` for the user, or
 * per-account `AccountRiskRules`) at save time:
 *
 *   automatedActionsConsentAt      = the moment the checkbox was checked
 *   automatedActionsConsentVersion = the version of the consent text the
 *                                    user accepted
 *
 * If the version we ship later changes materially, bump
 * AUTOMATED_ACTIONS_CONSENT_VERSION — the gate then treats prior consents as
 * stale and blocks broker writes until the user re-confirms.
 *
 * The internal Guardrail lock (riskState = STOPPED) is unaffected by this
 * consent: monitoring and app-side lockout always run.
 */

/**
 * Bump this string when the consent text or scope of automated actions
 * changes. The format is freeform; date prefix + short tag is recommended
 * so old values are easy to read in audit logs.
 */
export const AUTOMATED_ACTIONS_CONSENT_VERSION = "2026-05-auto-lockout-v1";

/**
 * Consent text exactly as shown in the rules form. Surfaced via a constant
 * so tests can assert the user-facing copy without depending on JSX. */
export const AUTOMATED_ACTIONS_CONSENT_TEXT =
  "I understand that Guardrail may automatically lock this account and may attempt to close open positions when my configured rules are breached.";

export type ConsentState = {
  consentAt: Date | null;
  consentVersion: string | null;
};

/**
 * Returns true when the consent record is non-null AND the version matches
 * the current version. Used by the enforcement gate.
 *
 * Cases:
 *   { consentAt: null, … }                    → false (never consented)
 *   { consentAt: Date, consentVersion: null }  → false (legacy / corrupt row)
 *   { consentAt: Date, consentVersion: "old" } → false (consent superseded)
 *   { consentAt: Date, consentVersion: "<current>" } → true
 */
export function hasValidConsent(state: ConsentState): boolean {
  if (state.consentAt == null) return false;
  if (state.consentVersion !== AUTOMATED_ACTIONS_CONSENT_VERSION) return false;
  return true;
}

/**
 * Decide which consent record applies to a given account.
 *
 *  - If the account has its own AccountRiskRules row, that row's consent is
 *    authoritative for that account.
 *  - Otherwise the account uses the user's default RiskRules template, so
 *    the template's consent applies.
 *
 * Returns the resolved ConsentState, plus a `source` label suitable for
 * audit logs. Both inputs may be null when the records do not exist.
 */
export function resolveConsentForAccount(input: {
  accountRiskRules: ConsentState | null;
  defaultRiskRules: ConsentState | null;
}): { state: ConsentState; source: "account" | "default" | "none" } {
  if (input.accountRiskRules != null) {
    return { state: input.accountRiskRules, source: "account" };
  }
  if (input.defaultRiskRules != null) {
    return { state: input.defaultRiskRules, source: "default" };
  }
  return {
    state: { consentAt: null, consentVersion: null },
    source: "none",
  };
}

/**
 * Reason label persisted on GuardianIntervention.brokerLockStatus when the
 * gate blocks. The lockStatus enum has been extended with
 * "unavailable_consent_missing"; this is the user-facing message.
 */
export const CONSENT_MISSING_MESSAGE =
  "Broker action unavailable: automated-action consent required. " +
  "Open Trading Plan and confirm automated lockout consent to enable broker-side protection.";

/**
 * Short copy for the Dashboard "Action required" banner, shown when an
 * account has full broker permissions but no valid consent on file.
 */
export const CONSENT_ACTION_REQUIRED_BANNER =
  "Action required · Confirm automated lockout consent before broker-side protection can activate.";

/**
 * Decide whether broker writes are allowed for an account, based purely on
 * the persisted consent records. Other gates (platform, trigger, connection,
 * permissionLevel, dry-run) are checked separately by their own helpers.
 *
 * This is the function `applyBrokerDayLockout` calls — pulled out as a pure
 * helper so the consent decision can be unit-tested independently of Prisma.
 */
export type ConsentGateDecision =
  | { allowed: true; source: "account" | "default" }
  | {
      allowed: false;
      lockStatus: "unavailable_consent_missing";
      flattenStatus: "unavailable_consent_missing";
      message: string;
      reason: "missing" | "version_mismatch";
    };

export function decideConsentGate(input: {
  accountRiskRules: ConsentState | null;
  defaultRiskRules: ConsentState | null;
}): ConsentGateDecision {
  const resolved = resolveConsentForAccount(input);
  if (hasValidConsent(resolved.state)) {
    return {
      allowed: true,
      source: resolved.source === "none" ? "default" : resolved.source,
    };
  }
  const reason: "missing" | "version_mismatch" =
    resolved.state.consentAt == null ? "missing" : "version_mismatch";
  return {
    allowed: false,
    lockStatus: "unavailable_consent_missing",
    flattenStatus: "unavailable_consent_missing",
    message: CONSENT_MISSING_MESSAGE,
    reason,
  };
}
