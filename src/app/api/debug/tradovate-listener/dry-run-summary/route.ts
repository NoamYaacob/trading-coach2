/**
 * GET /api/debug/tradovate-listener/dry-run-summary
 *
 * Read-only grouped summary of DryRunViolation rows for baseline review.
 * Returns violations grouped by trading day, by account+rule, and by rule
 * type — making 7-day dry-run baseline analysis easy without trawling the
 * flat violation list.
 *
 * Safety:
 *   - Read-only — never writes any DB row
 *   - dryRun=true rows only
 *   - No enforcement, no broker writes, no riskState mutations
 *   - Auth: authenticated session + x-cron-secret always required
 *
 * Query params:
 *   - days: number of days to include (default 7, max 30)
 *   - accountId: filter to a specific ConnectedAccount.id (optional)
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  buildViolationSummary,
  type ViolationRow,
} from "@/lib/guardian-engine/dry-run-violation-summary-helpers";

export async function GET(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const secret = request.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const daysParam = Math.min(30, Math.max(1, parseInt(sp.get("days") ?? "7", 10) || 7));
  const accountIdFilter = sp.get("accountId") ?? undefined;

  const since = new Date(Date.now() - daysParam * 24 * 60 * 60 * 1000);

  const rows = await prisma.dryRunViolation.findMany({
    where: {
      userId: currentUser.id,
      dryRun: true,
      ...(accountIdFilter ? { accountId: accountIdFilter } : {}),
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "asc" },
    take: 500,
    select: {
      accountId: true,
      externalAccountId: true,
      env: true,
      ruleType: true,
      tradingDay: true,
      thresholdAmount: true,
      thresholdCount: true,
      observedAmount: true,
      observedCount: true,
      dryRun: true,
      actionWouldHaveTaken: true,
      createdAt: true,
      updatedAt: true,
      account: { select: { label: true } },
    },
  });

  const cappedAt500 = rows.length === 500;

  const violationRows: ViolationRow[] = rows.map((r) => ({
    accountId: r.accountId,
    accountLabel: r.account.label,
    externalAccountId: r.externalAccountId,
    env: r.env,
    ruleType: r.ruleType,
    tradingDay: r.tradingDay,
    thresholdAmount: r.thresholdAmount != null ? Number(r.thresholdAmount) : null,
    thresholdCount: r.thresholdCount ?? null,
    observedAmount: r.observedAmount != null ? Number(r.observedAmount) : null,
    observedCount: r.observedCount ?? null,
    dryRun: r.dryRun,
    actionWouldHaveTaken: r.actionWouldHaveTaken,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));

  const summary = buildViolationSummary(violationRows);

  return NextResponse.json({
    note: "Dry run only — no enforcement action was taken. These records are observe-only.",
    dryRunEnabled: process.env.ENFORCEMENT_DRY_RUN === "true",
    queryDays: daysParam,
    ...(cappedAt500 ? { warning: "Result capped at 500 rows — consider narrowing the days or accountId filter." } : {}),
    ...summary,
  });
}
