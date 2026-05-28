import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { promotePendingRules, type PromoterPrisma } from "@/lib/pending-rule-promoter";
import {
  promotePendingConnectedAccountProtection,
  type AccountProtectionPromoterPrisma,
} from "@/lib/pending-connected-account-promoter";

/**
 * POST /api/cron/promote-pending-rules
 *
 * Activates pending rule changes whose `pendingEffectiveDate` is on/before
 * today's CME (America/Chicago) trading-day key. Spreads the stored
 * `pendingPayloadJson` into the active columns of the same row, then clears
 * `pendingPayloadJson` + `pendingEffectiveDate`. Idempotent.
 *
 * Scope:
 *   - Default-template rules (RiskRules, scoped by userId)
 *   - Account-specific overrides (AccountRiskRules, scoped by accountId)
 *   - { __delete: true } pending payloads on account rows remove the override
 *
 * Isolation:
 *   - Per-row updates only — Account A and Account B never see each other.
 *   - Default-template promotion never touches AccountRiskRules; account
 *     promotion never touches RiskRules.
 *   - This route does NOT call Tradovate. Promotion is a Guardrail-internal
 *     DB activation step. Broker risk-settings writes still happen only
 *     on breach via the existing enforcement code.
 *
 * Auth: requires the `x-cron-secret` header to match `CRON_SECRET`. Same
 * pattern as /api/cron/tradovate-sync — set the env var in the deployment
 * config and configure the scheduler to attach the header.
 *
 * Suggested cadence: every 5–15 minutes. The CME trading-day key only rolls
 * once per day at 17:00 CT, so the cron is mostly a no-op outside that
 * boundary.
 */
export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    // Both promoters are structurally typed so the deep generic types of
    // @prisma/client don't bleed into their API surfaces. The casts are safe
    // because we only read the columns listed in each `select`.
    const [summary, accountProtectionSummary] = await Promise.all([
      promotePendingRules(prisma as unknown as PromoterPrisma),
      promotePendingConnectedAccountProtection(
        prisma as unknown as AccountProtectionPromoterPrisma,
      ),
    ]);
    if (
      summary.promotedAccountCount > 0 ||
      summary.promotedDefaultCount > 0 ||
      summary.failedCount > 0 ||
      accountProtectionSummary.promotedCount > 0 ||
      accountProtectionSummary.failedCount > 0
    ) {
      console.info("[cron/promote-pending-rules] done", { ...summary, accountProtectionSummary });
    }
    return NextResponse.json({
      ok: true,
      ...summary,
      promotedAccountProtectionCount: accountProtectionSummary.promotedCount,
      skippedAccountProtectionCount: accountProtectionSummary.skippedFutureDateCount,
      failedAccountProtectionCount: accountProtectionSummary.failedCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/promote-pending-rules] fatal error", { message });
    return NextResponse.json({ error: "promotion_failed", message }, { status: 500 });
  }
}
