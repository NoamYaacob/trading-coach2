/**
 * canActivateRulesNow — central decision for "can a saved rule change be
 * activated immediately, or must it be queued as pending?"
 *
 * Product policy:
 *   - Editing is always allowed. Users can type into the form at any time.
 *   - Activation is gated per scope:
 *       * Account scope: safe when CME is not in active trading hours OR the
 *         specific account is locked (Guardrail STOPPED, cooldown, hard lock).
 *       * Default scope: safe when CME is not in active trading hours OR no
 *         inheriting account is currently active. The default template is
 *         conservative because changes can affect many accounts at once.
 *   - The CME calendar drives the global safe windows:
 *       * Mon–Thu 16:00–17:00 CT — daily maintenance break (safe)
 *       * Fri 16:00 CT → Sun 17:00 CT — weekend close (safe)
 *       * Sun 17:00 CT → Fri 16:00 CT — active trading hours (per-scope check)
 *
 * This helper is pure: no I/O, no clock, no Prisma. The caller pre-loads any
 * account state it needs (lockout flags, "any inheriting account active?")
 * and passes it in. That keeps the helper trivially testable and lets the
 * promoter and the PATCH routes use the same logic with the same semantics.
 */

import {
  isCmeMaintenanceWindow,
  isCmeMarketOpen,
  isCmeWeekendClose,
} from "./time/cme-session.ts";

export type ActivationReason =
  /** CME daily maintenance break (Mon–Thu 16:00–17:00 CT). All accounts safe. */
  | "cme_maintenance"
  /** CME weekend close (Fri 16:00 CT → Sun 17:00 CT). All accounts safe. */
  | "cme_weekend_close"
  /** CME market is otherwise closed (e.g. holiday). All accounts safe. */
  | "cme_market_closed"
  /** Account is internally locked: Guardrail STOPPED, cooldown, or hard lock. */
  | "account_locked"
  /** Account is currently tradable — must queue as pending. */
  | "account_active"
  /** Default scope: no inheriting account is currently active. */
  | "default_safe"
  /** Default scope: at least one inheriting account is currently active. */
  | "default_inheriting_account_active";

export type ActivationDecision = {
  canActivate: boolean;
  reason: ActivationReason;
};

export type AccountActivationInput = {
  scope: "account";
  /** True when this specific account is in Guardrail STOPPED, cooldown, or
   *  any other internal lockout state. Computed by the caller from
   *  liveSessionState / GuardianStatus / hard-lock flags. */
  accountIsLocked: boolean;
  /** Optional clock override for testing. */
  now?: Date;
};

export type DefaultActivationInput = {
  scope: "default";
  /** True when at least one account inheriting this default template (no
   *  AccountRiskRules row, or override row with all-null rule columns) is
   *  currently active (not locked). The caller computes this. */
  anyInheritingAccountActive: boolean;
  /** Optional clock override for testing. */
  now?: Date;
};

export type ActivationInput = AccountActivationInput | DefaultActivationInput;

/**
 * Decide whether rule changes for the given scope can be activated right now,
 * or whether they must be saved as pending and promoted later.
 */
export function canActivateRulesNow(input: ActivationInput): ActivationDecision {
  const now = input.now;

  // Global CME safe windows take precedence — when the market itself is not
  // running active trading, no account can be live, so any scope can activate.
  if (isCmeMaintenanceWindow(now)) {
    return { canActivate: true, reason: "cme_maintenance" };
  }
  if (isCmeWeekendClose(now)) {
    return { canActivate: true, reason: "cme_weekend_close" };
  }
  if (!isCmeMarketOpen(now)) {
    return { canActivate: true, reason: "cme_market_closed" };
  }

  // CME is in active trading hours. Decide per scope.
  if (input.scope === "account") {
    if (input.accountIsLocked) {
      return { canActivate: true, reason: "account_locked" };
    }
    return { canActivate: false, reason: "account_active" };
  }

  // Default scope.
  if (input.anyInheritingAccountActive) {
    return { canActivate: false, reason: "default_inheriting_account_active" };
  }
  return { canActivate: true, reason: "default_safe" };
}

/**
 * Stable, user-facing reason text for the pending-vs-active decision. Used by
 * the PATCH endpoints when explaining why a save was queued, and by the
 * promoter when logging.
 */
export function activationReasonMessage(reason: ActivationReason): string {
  switch (reason) {
    case "cme_maintenance":
      return "CME daily maintenance break — changes apply now.";
    case "cme_weekend_close":
      return "CME weekend close — changes apply now.";
    case "cme_market_closed":
      return "CME market is closed — changes apply now.";
    case "account_locked":
      return "Account is locked — changes apply now.";
    case "account_active":
      return "Account is in active trading — changes will activate at the next safe window for this account.";
    case "default_safe":
      return "No inheriting account is currently active — changes apply now.";
    case "default_inheriting_account_active":
      return "An inheriting account is currently active — changes will activate at the next CME maintenance break, weekend close, or when all inheriting accounts are safe.";
  }
}
