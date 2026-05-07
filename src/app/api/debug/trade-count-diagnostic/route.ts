import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { deriveCanonicalEntryCount } from "@/lib/guardian-engine/canonical-trade-count";
import { classifyFill } from "@/lib/guardian-engine/fill-classifier";
import { deriveCmeTradingDayKey } from "@/lib/trading-day";

/**
 * Diagnostic endpoint for investigating trade-count discrepancies.
 *
 * Usage: GET /api/debug/trade-count-diagnostic?accountId=DEMO7433035
 *
 * Returns:
 *   rawFillCount      — total fill-like events in DB for today's session
 *   dedupedFillCount  — after externalTradeId / composite-key deduplication
 *   derivedEntryCount — position-aware entry count (what the dashboard should show)
 *   liveState         — current LiveSessionState values
 *   fillTrace         — per-fill breakdown: dedup key, position before/after, classification, counted
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
      price: true,
      occurredAt: true,
      rawPayload: true,
    },
    orderBy: { occurredAt: "asc" },
  });

  const rawFillCount = allFills.length;

  const canonicalFills = allFills.map((f) => ({
    externalTradeId: f.externalTradeId,
    contractId: f.contractId,
    side: f.side,
    quantity: f.quantity != null ? String(f.quantity) : null,
    price: f.price != null ? String(f.price) : null,
    occurredAt: f.occurredAt,
    rawPayload: f.rawPayload,
  }));

  const derivedEntryCount = deriveCanonicalEntryCount(canonicalFills);

  // Build per-fill trace by replicating the dedup + sort + classify pass.
  // This mirrors deriveCanonicalEntryCount exactly so the trace matches the count.
  function compositeKey(f: (typeof canonicalFills)[number]): string {
    return [
      String(f.contractId ?? ""),
      f.occurredAt.toISOString(),
      f.side ?? "",
      f.quantity ?? "",
      f.price ?? "",
    ].join("|");
  }

  const byExtId = new Map<string, (typeof canonicalFills)[number]>();
  const noIdSeen = new Set<string>();
  const noIdFills: Array<(typeof canonicalFills)[number]> = [];

  for (const fill of canonicalFills) {
    if (!fill.externalTradeId) {
      const key = compositeKey(fill);
      if (!noIdSeen.has(key)) {
        noIdSeen.add(key);
        noIdFills.push(fill);
      }
      continue;
    }
    const existing = byExtId.get(fill.externalTradeId);
    if (!existing || (fill.contractId != null && existing.contractId == null)) {
      byExtId.set(fill.externalTradeId, fill);
    }
  }

  const deduped = [...byExtId.values(), ...noIdFills].sort((a, b) => {
    const timeDiff = a.occurredAt.getTime() - b.occurredAt.getTime();
    if (timeDiff !== 0) return timeDiff;
    const aId = a.externalTradeId != null ? Number(a.externalTradeId) : Infinity;
    const bId = b.externalTradeId != null ? Number(b.externalTradeId) : Infinity;
    if (aId !== bId) return aId - bId;
    return (Number(a.price) || 0) - (Number(b.price) || 0);
  });

  const dedupedFillCount = deduped.length;

  const contractPositions = new Map<string, number>();
  const fillTrace = deduped.map((fill) => {
    let contractKey: string;
    if (fill.contractId != null) {
      contractKey = `cid:${fill.contractId}`;
    } else {
      const payload = fill.rawPayload as { symbol?: string } | null;
      contractKey = `sym:${payload?.symbol ?? "unknown"}`;
    }

    const positionBefore = contractPositions.get(contractKey) ?? 0;
    const side = fill.side as "BUY" | "SELL";
    const qty = Number(fill.quantity ?? 0);
    const classification = classifyFill(positionBefore, side, qty);
    const counted = classification === "entry" || classification === "reversal";
    const positionAfter = positionBefore + (side === "BUY" ? qty : -qty);
    contractPositions.set(contractKey, positionAfter);

    const dedupKey = fill.externalTradeId
      ? `id:${fill.externalTradeId}`
      : `composite:${compositeKey(fill)}`;

    return {
      externalTradeId: fill.externalTradeId,
      contractKey,
      side: fill.side,
      quantity: fill.quantity,
      price: fill.price,
      occurredAt: fill.occurredAt.toISOString(),
      dedupKey,
      positionBefore,
      positionAfter,
      classification,
      counted,
    };
  });

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
    fillTrace,
  });
}
