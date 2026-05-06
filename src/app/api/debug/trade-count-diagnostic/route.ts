import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deriveCanonicalEntryCount } from "@/lib/guardian-engine/session-state";
import { deriveCmeTradingDayKey } from "@/lib/trading-day";

/**
 * Diagnostic endpoint for investigating trade-count discrepancies.
 *
 * Usage: GET /api/debug/trade-count-diagnostic?accountId=DEMO7433035
 *
 * Returns:
 *   rawFillCount      — total fill-like events in DB for today's session
 *   dedupedFillCount  — after deduplication by externalTradeId
 *   derivedEntryCount — position-aware entry count (what the dashboard should show)
 *   liveState         — current LiveSessionState values
 *   fills             — per-fill breakdown for manual inspection
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const externalAccountId = searchParams.get("accountId");
  if (!externalAccountId) {
    return NextResponse.json({ error: "accountId query parameter required" }, { status: 400 });
  }

  const account = await prisma.connectedAccount.findFirst({
    where: { externalAccountId, platform: "tradovate", isActive: true },
    select: { id: true },
  });
  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  const sessionDate = deriveCmeTradingDayKey(new Date());
  const dayStart = new Date(`${sessionDate}T00:00:00.000Z`);

  const allFills = await prisma.normalizedTradeEvent.findMany({
    where: {
      accountId: account.id,
      occurredAt: { gte: dayStart },
      eventType: { in: ["fill", "trade_closed", "trade_closed_win", "trade_closed_loss"] },
    },
    select: {
      externalTradeId: true,
      contractId: true,
      eventType: true,
      side: true,
      quantity: true,
      occurredAt: true,
      rawPayload: true,
    },
    orderBy: { occurredAt: "asc" },
  });

  const rawFillCount = allFills.length;

  const seen = new Set<string>();
  const dedupedFills = allFills.filter((f) => {
    if (!f.externalTradeId) return true;
    if (seen.has(f.externalTradeId)) return false;
    seen.add(f.externalTradeId);
    return true;
  });
  const dedupedFillCount = dedupedFills.length;

  const derivedEntryCount = deriveCanonicalEntryCount(
    allFills.map((f) => ({
      externalTradeId: f.externalTradeId,
      contractId: f.contractId,
      side: f.side,
      quantity: f.quantity != null ? String(f.quantity) : null,
      occurredAt: f.occurredAt,
      rawPayload: f.rawPayload,
    })),
  );

  const liveState = await prisma.liveSessionState.findUnique({
    where: { accountId: account.id },
    select: { tradesCount: true, tradeCountSource: true, sessionDate: true, riskState: true },
  });

  return NextResponse.json({
    accountId: externalAccountId,
    sessionDate,
    rawFillCount,
    dedupedFillCount,
    derivedEntryCount,
    tradeCountSource: "verified",
    liveState: liveState ?? null,
    fills: allFills.map((f) => ({
      externalTradeId: f.externalTradeId,
      eventType: f.eventType,
      contractId: f.contractId,
      side: f.side,
      quantity: f.quantity != null ? String(f.quantity) : null,
      occurredAt: f.occurredAt.toISOString(),
    })),
  });
}
