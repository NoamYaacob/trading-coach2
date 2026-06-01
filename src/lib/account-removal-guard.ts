/**
 * Safety guard for account archiving / removal.
 *
 * Before an account can be removed from Guardrail monitoring, we must verify
 * it has not breached a rule or become locked in the current trading session.
 * Allowing immediate removal while locked would let a user bypass their own
 * Guardrail rules by disconnecting the account after a violation.
 *
 * Three independent lock signals are checked (all per-account or per-user):
 *   1. LiveSessionState.riskState === "STOPPED" today — session risk engine stopped
 *   2. LiveSessionState.cooldownActive today — post-loss-streak cooldown active
 *   3. InternalLockEvent with clearedAt IS NULL — an active internal lock
 *      (daily_loss_limit, trade_limit, max_loss_streak)
 *
 * On the InternalLockEvent day boundary: the lock's `tradingDay` uses the CME
 * session key (changes at 17:00 CT), while this guard's `todayKey` is the CT
 * calendar day (changes at midnight CT). These diverge in the 17:00→midnight
 * window. `clearedAt IS NULL` is the authoritative "still locked" signal — a
 * lock is only cleared on manual reset or session end — so an active lock must
 * defer removal regardless of which `tradingDay` key it carries. Restricting
 * the query to `tradingDay === todayKey` previously let removal through once
 * the CT calendar day rolled forward while the lock was still active.
 *
 * Note on GuardianStatus: the GuardianStatus model is per-user (userId @unique),
 * not per-account. It reflects aggregate stats across all user accounts. We do
 * not use it here because it would incorrectly block removal of a clean account
 * when a different account is locked.
 *
 * Bypass conditions (always canRemoveNow = true):
 *   - Account is missing from broker (missingFromBrokerSince set): no active
 *     monitoring, no protection to respect.
 *   - Account protectionStatus is "ignored" or "archived": already opted out.
 */

import { prisma } from "./db";
import { dateKeyInTimezone } from "./account-protection";
import { SESSION_WINDOW_TIMEZONE } from "./trading-day";
import { decideRemovalEligibility, type RemovalEligibility } from "./account-removal-eligibility";

export type { RemovalEligibility, RemovalDecisionInput } from "./account-removal-eligibility";
export { decideRemovalEligibility } from "./account-removal-eligibility";

/**
 * Check whether the given account can be removed from Guardrail right now.
 *
 * Caller must verify userId ownership before calling — this function trusts
 * the accountId/userId pair is already validated.
 */
export async function checkAccountRemovalEligibility(
  accountId: string,
  userId: string,
  now: Date = new Date(),
): Promise<RemovalEligibility> {
  const todayKey = dateKeyInTimezone(now, SESSION_WINDOW_TIMEZONE);
  // Next trading day: advance 24h and re-compute the CME day key.
  const tomorrowApprox = new Date(now.getTime() + 24 * 60 * 60_000);
  const nextTradingDay = dateKeyInTimezone(tomorrowApprox, SESSION_WINDOW_TIMEZONE);

  const account = await prisma.connectedAccount.findFirst({
    where: { id: accountId, userId },
    select: { missingFromBrokerSince: true, protectionStatus: true },
  });

  // Short-circuit: account not found needs no further reads.
  if (!account) {
    return decideRemovalEligibility({
      accountFound: false,
      missingFromBrokerSince: null,
      protectionStatus: null,
      sessionDate: null,
      todayKey,
      riskState: null,
      cooldownActive: false,
      activeInternalLock: null,
      nextTradingDay,
    });
  }

  // LiveSessionState is @unique on accountId (one row per account).
  const sessionState = await prisma.liveSessionState.findUnique({
    where: { accountId },
    select: { sessionDate: true, riskState: true, cooldownActive: true },
  });

  // Any active internal lock for this account — clearedAt IS NULL is the
  // authoritative active-lock signal; intentionally NOT filtered by tradingDay.
  const activeLock = await prisma.internalLockEvent.findFirst({
    where: { accountId, clearedAt: null },
    select: { ruleType: true },
  });

  return decideRemovalEligibility({
    accountFound: true,
    missingFromBrokerSince: account.missingFromBrokerSince,
    protectionStatus: account.protectionStatus,
    sessionDate: sessionState?.sessionDate ?? null,
    todayKey,
    riskState: sessionState?.riskState ?? null,
    cooldownActive: sessionState?.cooldownActive ?? false,
    activeInternalLock: activeLock,
    nextTradingDay,
  });
}
