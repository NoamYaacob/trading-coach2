/**
 * Promoter for pending ConnectedAccount protection status changes.
 *
 * When an account archive is deferred because the account is locked (rule
 * breach, session stopped, cooldown active), the archive request writes:
 *   - pendingProtectionStatus = "archived"
 *   - pendingProtectionEffectiveDate = nextTradingDay (YYYY-MM-DD)
 *
 * This promoter finds those rows and applies the archive once the effective
 * date has arrived. It is wired into the existing promote-pending-rules cron
 * so no new scheduler entry is required.
 *
 * Safety invariants:
 *   - Only writes protectionStatus = "archived" on ConnectedAccount.
 *   - Clears pendingProtectionStatus and pendingProtectionEffectiveDate.
 *   - Never deletes any row on any table.
 *   - Never touches: NormalizedTradeEvent, AccountRiskRules, InternalLockEvent,
 *     GuardianStatus, BrokerOrderActionLog, RuleChangeAudit.
 *   - Idempotent: once promoted, pendingProtectionStatus is null so subsequent
 *     runs skip the row.
 *
 * Separate from pending-rule-promoter.ts which handles RiskRules /
 * AccountRiskRules pending payload promotions only.
 */

import { dateKeyInTimezone } from "./account-protection.ts";
import { SESSION_WINDOW_TIMEZONE } from "./trading-day.ts";

export type AccountProtectionPromotionSummary = {
  /** Accounts successfully archived by this run. */
  promotedCount: number;
  /** Accounts skipped because their effective date is still in the future. */
  skippedFutureDateCount: number;
  /** Accounts that failed to update (DB error); will be retried next run. */
  failedCount: number;
  errors: Array<{ id: string; message: string }>;
};

/**
 * Minimal Prisma surface this promoter needs. Typed narrowly so tests can
 * provide a plain object mock without importing the full PrismaClient type.
 */
export type AccountProtectionPromoterPrisma = {
  connectedAccount: {
    findMany: (args: {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
    }) => Promise<{ id: string; pendingProtectionEffectiveDate: string | null }[]>;
    update: (args: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => Promise<unknown>;
  };
};

/**
 * Promote pending archive protection changes whose effective date is on or
 * before the current CME trading day key.
 *
 * Per-row error handling: a DB failure on one row does NOT abort the others.
 * The failed row keeps its pendingProtectionStatus so the next cron tick
 * retries it.
 */
export async function promotePendingConnectedAccountProtection(
  prisma: AccountProtectionPromoterPrisma,
  now: Date = new Date(),
): Promise<AccountProtectionPromotionSummary> {
  const todayKey = dateKeyInTimezone(now, SESSION_WINDOW_TIMEZONE);
  const summary: AccountProtectionPromotionSummary = {
    promotedCount: 0,
    skippedFutureDateCount: 0,
    failedCount: 0,
    errors: [],
  };

  const rows = await prisma.connectedAccount.findMany({
    where: {
      pendingProtectionStatus: "archived",
      pendingProtectionEffectiveDate: { not: null },
    },
    select: {
      id: true,
      pendingProtectionEffectiveDate: true,
    },
  });

  for (const row of rows) {
    const effectiveDate = row.pendingProtectionEffectiveDate;
    // Null defensively handled even though the query filters it out.
    if (!effectiveDate || effectiveDate > todayKey) {
      summary.skippedFutureDateCount += 1;
      continue;
    }

    try {
      await prisma.connectedAccount.update({
        where: { id: row.id },
        data: {
          protectionStatus: "archived",
          pendingProtectionStatus: null,
          pendingProtectionEffectiveDate: null,
        },
      });
      summary.promotedCount += 1;
      console.info("[pending-account-protection] account archived", {
        accountId: row.id,
        effectiveDate,
        todayKey,
      });
    } catch (err) {
      summary.failedCount += 1;
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ id: row.id, message });
      console.error("[pending-account-protection] failed to archive account", {
        accountId: row.id,
        message,
      });
    }
  }

  return summary;
}
