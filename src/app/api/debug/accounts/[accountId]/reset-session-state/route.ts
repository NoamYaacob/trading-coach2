import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type Ctx = { params: Promise<{ accountId: string }> };

/**
 * POST /api/debug/accounts/[accountId]/reset-session-state
 *
 * QA/admin-only action: resets today's LiveSessionState for an account back to
 * NORMAL so the account can be used for first-breach testing from a clean state.
 *
 * Protection:
 *   - Blocked in production unless a valid CRON_SECRET is provided.
 *   - Requires an authenticated user session in all cases.
 *   - The account must belong to the authenticated user.
 *
 * What is reset:
 *   - riskState = NORMAL
 *   - pendingSessionEndLock = false
 *   - cooldownActive = false
 *   - cooldownUntil = null
 *
 * What is NOT touched:
 *   - NormalizedTradeEvent rows
 *   - GuardianIntervention history
 *   - Broker connection or tokens
 *   - Risk rules (maxContracts, etc.)
 *   - dailyPnl, tradesCount, consecutiveLosses (session P&L/counters preserved)
 *   - Tradovate risk settings
 *
 * Idempotent: safe to call when already NORMAL.
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  // ── Authorization gate ──────────────────────────────────────────────────────
  // In production, require the CRON_SECRET header to prevent accidental exposure.
  // In non-production, user auth is sufficient.
  const isProduction = process.env.NODE_ENV === "production";
  const secret = request.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET;
  const hasValidSecret = expectedSecret != null && secret === expectedSecret;

  if (isProduction && !hasValidSecret) {
    return NextResponse.json(
      {
        ok: false,
        error: "forbidden",
        message:
          "This endpoint is restricted. " +
          "Provide the x-cron-secret header with the CRON_SECRET value to use it in production.",
      },
      { status: 403 },
    );
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { accountId } = await ctx.params;

  // ── Ownership check ─────────────────────────────────────────────────────────
  const account = await prisma.connectedAccount.findFirst({
    where: { id: accountId, userId: currentUser.id },
    select: { id: true },
  });

  if (!account) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  // ── Reset ───────────────────────────────────────────────────────────────────
  const existing = await prisma.liveSessionState.findUnique({
    where: { accountId },
    select: { riskState: true },
  });

  if (!existing) {
    return NextResponse.json({
      ok: true,
      accountId,
      previousRiskState: null,
      newRiskState: "NORMAL",
      changed: false,
      message: "No LiveSessionState found for this account — nothing to reset.",
    });
  }

  const previousRiskState = existing.riskState;

  await prisma.liveSessionState.update({
    where: { accountId },
    data: {
      riskState: "NORMAL",
      pendingSessionEndLock: false,
      cooldownActive: false,
      cooldownUntil: null,
    },
  });

  console.info("[debug/reset-session-state] reset applied", {
    accountId,
    userId: currentUser.id,
    previousRiskState,
    newRiskState: "NORMAL",
  });

  return NextResponse.json({
    ok: true,
    accountId,
    previousRiskState,
    newRiskState: "NORMAL",
    changed: previousRiskState !== "NORMAL",
  });
}
