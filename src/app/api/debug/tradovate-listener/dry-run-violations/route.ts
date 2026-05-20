import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/debug/tradovate-listener/dry-run-violations
 *
 * Returns recent DryRunViolation rows for the current user's accounts.
 * These are observe-only records written by the realtime listener worker
 * when ENFORCEMENT_DRY_RUN=true — they record what enforcement action
 * WOULD have been taken without actually taking any action.
 *
 * Security:
 *   - Requires authenticated session (401 otherwise).
 *   - Requires x-cron-secret header matching CRON_SECRET env var.
 *   - Only returns rows owned by the current user (userId filter).
 *   - Read-only — never mutates any row.
 *
 * Query params:
 *   - days: number of days back to include (default 7, max 30)
 *   - accountId: filter to a specific account (optional)
 */
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
      ...(accountIdFilter ? { accountId: accountIdFilter } : {}),
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      accountId: true,
      externalAccountId: true,
      env: true,
      ruleType: true,
      thresholdAmount: true,
      thresholdCount: true,
      observedAmount: true,
      observedCount: true,
      dryRun: true,
      actionWouldHaveTaken: true,
      tradingDay: true,
      dedupKey: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({
    note: "Dry run only — no enforcement action was taken. These records are observe-only.",
    dryRunEnabled: process.env.ENFORCEMENT_DRY_RUN === "true",
    queryDays: daysParam,
    count: rows.length,
    violations: rows.map((r) => ({
      ...r,
      thresholdAmount: r.thresholdAmount?.toString() ?? null,
      observedAmount: r.observedAmount?.toString() ?? null,
    })),
  });
}
