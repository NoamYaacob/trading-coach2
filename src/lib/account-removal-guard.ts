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
 *   3. InternalLockEvent with clearedAt IS NULL and tradingDay === today —
 *      an active internal lock (daily_loss_limit, trade_limit, max_loss_streak)
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

export type RemovalEligibility = {
  /** true when the account can be archived immediately. */
  canRemoveNow: boolean;
  /**
   * Machine-readable reason why removal is deferred. null when canRemoveNow.
   * Format: "session_stopped" | "cooldown_active"
   *         | "internal_lock:<ruleType>" | "account_not_found"
   */
  lockReason: string | null;
  /** YYYY-MM-DD trading day key for the next session reset (when deferred removal applies). */
  nextTradingDay: string;
};

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

  if (!account) {
    return { canRemoveNow: false, lockReason: "account_not_found", nextTradingDay };
  }

  // Unavailable from broker — no active trades or enforcement happening.
  if (account.missingFromBrokerSince != null) {
    return { canRemoveNow: true, lockReason: null, nextTradingDay };
  }

  // Already in an inactive protection state — removal is safe.
  if (account.protectionStatus === "ignored" || account.protectionStatus === "archived") {
    return { canRemoveNow: true, lockReason: null, nextTradingDay };
  }

  // ── 1 & 2. LiveSessionState — session risk stopped or cooldown ───────────
  // LiveSessionState is @unique on accountId (one row per account, updated
  // in place). We only treat the state as "current" when sessionDate matches
  // today's CME trading day key. A stale row from yesterday poses no lock.
  const sessionState = await prisma.liveSessionState.findUnique({
    where: { accountId },
    select: { sessionDate: true, riskState: true, cooldownActive: true },
  });
  if (sessionState?.sessionDate === todayKey) {
    if (sessionState.riskState === "STOPPED") {
      return { canRemoveNow: false, lockReason: "session_stopped", nextTradingDay };
    }
    if (sessionState.cooldownActive === true) {
      return { canRemoveNow: false, lockReason: "cooldown_active", nextTradingDay };
    }
  }

  // ── 3. InternalLockEvent — active internal breach today ──────────────────
  const activeLock = await prisma.internalLockEvent.findFirst({
    where: { accountId, tradingDay: todayKey, clearedAt: null },
    select: { ruleType: true },
  });
  if (activeLock) {
    return {
      canRemoveNow: false,
      lockReason: `internal_lock:${activeLock.ruleType}`,
      nextTradingDay,
    };
  }

  return { canRemoveNow: true, lockReason: null, nextTradingDay };
}
