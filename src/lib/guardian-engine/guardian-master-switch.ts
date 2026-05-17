/**
 * Guardian master-switch gating.
 *
 * GuardianProfile.guardianEnabled is the master on/off switch for ALL rule
 * evaluation and enforcement. When Guardian is off for a user, the listener
 * may still sync account/connection data and update the dashboard, but it
 * must NOT:
 *   - write DryRunViolation rows
 *   - create InternalLockEvent rows or set riskState=STOPPED
 *   - attempt broker enforcement
 *
 * This module holds the pure decision so it can be unit-tested without a DB.
 */

export type GuardianProfileGate = { guardianEnabled: boolean } | null | undefined;

/**
 * Resolve whether Guardian rule evaluation/enforcement is active for a user.
 *
 * A missing GuardianProfile resolves to false: Guardian is treated as off
 * until the user explicitly turns it on. This is the safe default — it never
 * evaluates rules or applies a lock for a user who has not opted in.
 */
export function isGuardianRuleEvaluationActive(profile: GuardianProfileGate): boolean {
  return profile?.guardianEnabled === true;
}

/** Skip reason recorded when an account is skipped because Guardian is off. */
export const GUARDIAN_DISABLED_SKIP_REASON =
  "guardian disabled (master switch off)";
