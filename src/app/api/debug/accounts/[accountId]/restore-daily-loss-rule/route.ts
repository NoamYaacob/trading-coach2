/**
 * POST /api/debug/accounts/[accountId]/restore-daily-loss-rule
 *
 * Operator-only DB patch: restores AccountRiskRules.maxDailyLoss to 40 000
 * for a single demo account after a QA test (e.g. C1 internal-lock test)
 * lowered it to a test value.
 *
 * Safety gates (all run before any write):
 *   A1. Authenticated user session (getCurrentUser).
 *   A2. Caller email passes isAdminEmail.
 *   A3. x-cron-secret header matches CRON_SECRET env var.
 *   A4. Account must belong to the authenticated user.
 *   A5. Account must be on a "demo" broker connection (live is always blocked).
 *   A6. Request body must include { "confirm": "restore-daily-loss-rule" } exactly.
 *   A7. AccountRiskRules row must already exist (no implicit creation).
 *
 * What this endpoint does:
 *   - Updates AccountRiskRules.maxDailyLoss to 40 000 in Guardrail's DB only.
 *   - Returns { before: { maxDailyLoss }, after: { maxDailyLoss: 40000 } }.
 *   - Writes a console.info audit line (same pattern as reset-session-state).
 *
 * What this endpoint does NOT do:
 *   - No Tradovate API calls of any kind.
 *   - No broker risk settings writes.
 *   - No change to riskState, tradesCount, dailyPnl, or any session state.
 *   - No modification to live accounts.
 *   - No cancel, flatten, or order actions.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/subscription";
import { prisma } from "@/lib/db";

const CONFIRM_PHRASE = "restore-daily-loss-rule";
const RESTORE_MAX_DAILY_LOSS = 40_000;

type Ctx = { params: Promise<{ accountId: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  // A1: authenticated session
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // A2: admin-only
  if (!isAdminEmail(currentUser.email)) {
    return NextResponse.json(
      { ok: false, error: "forbidden", reason: "admin_required" },
      { status: 403 },
    );
  }

  // A3: x-cron-secret must match CRON_SECRET
  const secret = request.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json(
      { ok: false, error: "forbidden", reason: "cron_secret_required" },
      { status: 403 },
    );
  }

  // Parse body
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  // A6: explicit confirm phrase required
  if (body.confirm !== CONFIRM_PHRASE) {
    return NextResponse.json(
      {
        ok: false,
        error: "confirm_phrase_required",
        reason: `Body must include { "confirm": "${CONFIRM_PHRASE}" }.`,
      },
      { status: 400 },
    );
  }

  const { accountId } = await ctx.params;

  // A4: account ownership check
  const account = await prisma.connectedAccount.findFirst({
    where: { id: accountId, userId: currentUser.id },
    select: {
      id: true,
      brokerConnection: { select: { env: true } },
      riskRules: { select: { maxDailyLoss: true } },
    },
  });

  if (!account) {
    return NextResponse.json({ ok: false, error: "account_not_found" }, { status: 404 });
  }

  // A5: demo-only — live accounts are always blocked
  const env = account.brokerConnection?.env ?? null;
  if (env !== "demo") {
    return NextResponse.json(
      {
        ok: false,
        error: "forbidden",
        reason: env === "live" ? "live_accounts_blocked" : "demo_only",
        env,
      },
      { status: 403 },
    );
  }

  // A7: AccountRiskRules row must already exist
  if (!account.riskRules) {
    return NextResponse.json(
      {
        ok: false,
        error: "no_account_risk_rules",
        reason:
          "No AccountRiskRules row exists for this account. " +
          "Cannot restore a rule that was never created.",
      },
      { status: 404 },
    );
  }

  const beforeMaxDailyLoss =
    account.riskRules.maxDailyLoss != null ? Number(account.riskRules.maxDailyLoss) : null;

  await prisma.accountRiskRules.update({
    where: { accountId },
    data: { maxDailyLoss: RESTORE_MAX_DAILY_LOSS },
  });

  console.info("[debug/restore-daily-loss-rule] maxDailyLoss restored", {
    accountId,
    userId: currentUser.id,
    before: beforeMaxDailyLoss,
    after: RESTORE_MAX_DAILY_LOSS,
  });

  return NextResponse.json({
    ok: true,
    accountId,
    before: { maxDailyLoss: beforeMaxDailyLoss },
    after: { maxDailyLoss: RESTORE_MAX_DAILY_LOSS },
    note: "DB-only update. No Tradovate API calls made. Rule takes effect on next rule save or enforcement check.",
  });
}
