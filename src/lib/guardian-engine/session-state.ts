import { prisma } from "@/lib/db";
import type { SessionState } from "./types";
export { classifyFill, normalizeSide } from "./fill-classifier";
import { normalizeSide } from "./fill-classifier";
export { deriveCanonicalEntryCount, deriveCanonicalCompletedCount, type CanonicalFill } from "./canonical-trade-count";
import { deriveCanonicalCompletedCount } from "./canonical-trade-count";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

type SessionStateRow = {
  accountId: string;
  sessionDate: string;
  dailyPnl: unknown;
  tradesCount: number;
  consecutiveLosses: number;
  lastTradeAt: Date | null;
  cooldownActive: boolean;
  cooldownUntil: Date | null;
  riskState: string;
};

function toSessionState(row: SessionStateRow): SessionState {
  return {
    accountId: row.accountId,
    sessionDate: row.sessionDate,
    dailyPnl: Number(row.dailyPnl),
    tradesCount: row.tradesCount,
    consecutiveLosses: row.consecutiveLosses,
    lastTradeAt: row.lastTradeAt,
    cooldownActive: row.cooldownActive,
    cooldownUntil: row.cooldownUntil,
    riskState: row.riskState as "NORMAL" | "WARNING" | "STOPPED",
  };
}

export async function getOrCreateSessionState(accountId: string): Promise<SessionState> {
  const today = todayKey();
  const existing = await prisma.liveSessionState.findUnique({ where: { accountId } });

  if (existing && existing.sessionDate !== today) {
    return toSessionState(
      await prisma.liveSessionState.update({
        where: { accountId },
        data: {
          sessionDate: today,
          dailyPnl: 0,
          tradesCount: 0,
          consecutiveLosses: 0,
          lastTradeAt: null,
          cooldownActive: false,
          cooldownUntil: null,
          riskState: "NORMAL",
        },
      }),
    );
  }

  if (existing) {
    // Clear expired cooldown — account re-enters NORMAL state when cooldownUntil has passed.
    // Hard stops (riskState=STOPPED, cooldownActive=false) are intentionally not cleared here.
    if (existing.cooldownActive && existing.cooldownUntil && existing.cooldownUntil < new Date()) {
      return toSessionState(
        await prisma.liveSessionState.update({
          where: { accountId },
          data: {
            cooldownActive: false,
            cooldownUntil: null,
            riskState: "NORMAL",
            consecutiveLosses: 0,
          },
        }),
      );
    }
    return toSessionState(existing);
  }

  return toSessionState(
    await prisma.liveSessionState.create({
      data: { accountId, sessionDate: today },
    }),
  );
}

/**
 * Query today's fills for the given account + contract (excluding the current
 * fill by externalTradeId) and compute the net signed position.
 *
 * Positive = net long, negative = net short, 0 = flat.
 *
 * Queries both "fill" (sync path) and "trade_closed*" (webhook path) events.
 * Deduplicates by externalTradeId to avoid double-counting when both paths
 * stored the same fill before the cross-path dedup fix was in place.
 */
export async function computeNetPosition(
  accountId: string,
  contractId: number,
  sessionDate: string,
  excludeExternalTradeId: string,
): Promise<number> {
  const dayStart = new Date(`${sessionDate}T00:00:00.000Z`);
  const fills = await prisma.normalizedTradeEvent.findMany({
    where: {
      accountId,
      contractId,
      externalTradeId: { not: excludeExternalTradeId },
      occurredAt: { gte: dayStart },
      eventType: { in: ["fill", "trade_closed", "trade_closed_win", "trade_closed_loss"] },
    },
    select: { side: true, quantity: true, externalTradeId: true },
    orderBy: { occurredAt: "asc" },
  });

  const seen = new Set<string>();
  let position = 0;
  for (const f of fills) {
    if (f.externalTradeId) {
      if (seen.has(f.externalTradeId)) continue;
      seen.add(f.externalTradeId);
    }
    const qty = Number(f.quantity ?? 0);
    const side = normalizeSide(f.side);
    position += side === "BUY" ? qty : -qty;
  }
  return position;
}

/**
 * DB-backed canonical trade count for a session.
 *
 * Queries all fill-like events for the account+day (both "fill" from the sync
 * path and "trade_closed*" from the webhook path), deduplicates them, and
 * counts only position entries using position-aware classification.
 *
 * Always returns tradeCountSource "verified" — this is the single authoritative
 * count that sync writes to LiveSessionState instead of the API-based resolver.
 */
export async function countCanonicalEntries(
  accountId: string,
  sessionDate: string,
): Promise<{ count: number; tradeCountSource: "verified" }> {
  const dayStart = new Date(`${sessionDate}T00:00:00.000Z`);
  const fills = await prisma.normalizedTradeEvent.findMany({
    where: {
      accountId,
      occurredAt: { gte: dayStart },
      eventType: { in: ["fill", "trade_closed", "trade_closed_win", "trade_closed_loss"] },
      side: { not: null },
      quantity: { not: null },
    },
    select: {
      externalTradeId: true,
      contractId: true,
      side: true,
      quantity: true,
      price: true,
      occurredAt: true,
      rawPayload: true,
    },
    orderBy: { occurredAt: "asc" },
  });

  const canonical = fills.map((row) => ({
    externalTradeId: row.externalTradeId,
    contractId: row.contractId,
    side: row.side,
    quantity: row.quantity == null ? null : row.quantity.toString(),
    price: row.price == null ? null : row.price.toString(),
    occurredAt: row.occurredAt,
    rawPayload: row.rawPayload,
  }));
  return { count: deriveCanonicalCompletedCount(canonical), tradeCountSource: "verified" };
}

/**
 * Called when a fill opens a new position entry.
 * Does NOT increment tradesCount — a trade is only counted when it completes
 * (position returns to flat or reversal closes the previous direction).
 * Updates lastTradeAt so the session knows a trade is in progress.
 */
export async function applyTradeEntry(
  accountId: string,
  occurredAt: Date,
): Promise<SessionState> {
  return toSessionState(
    await prisma.liveSessionState.update({
      where: { accountId },
      data: {
        lastTradeAt: occurredAt,
      },
    }),
  );
}

/**
 * Called when a fill closes (partially or fully) a position.
 *
 * @param isCompletedRoundTrip - true when the position returns to flat OR when
 *   a reversal closes the previous direction. Only then is tradesCount
 *   incremented — partial exits that leave a position open do NOT count.
 */
export async function applyTradeClose(
  accountId: string,
  pnl: number,
  occurredAt: Date,
  isCompletedRoundTrip = false,
): Promise<SessionState> {
  const isLoss = pnl < 0;
  return toSessionState(
    await prisma.liveSessionState.update({
      where: { accountId },
      data: {
        ...(isCompletedRoundTrip ? { tradesCount: { increment: 1 } } : {}),
        dailyPnl: { increment: pnl },
        consecutiveLosses: isLoss ? { increment: 1 } : 0,
        lastTradeAt: occurredAt,
      },
    }),
  );
}

export async function applyTradeOpen(
  accountId: string,
  occurredAt: Date,
): Promise<SessionState> {
  return toSessionState(
    await prisma.liveSessionState.update({
      where: { accountId },
      data: {
        lastTradeAt: occurredAt,
      },
    }),
  );
}

export async function setCooldown(accountId: string, minutes: number): Promise<void> {
  const until = new Date(Date.now() + minutes * 60_000);
  await prisma.liveSessionState.update({
    where: { accountId },
    data: { cooldownActive: true, cooldownUntil: until, riskState: "STOPPED" },
  });
}

export async function setRiskState(
  accountId: string,
  riskState: "NORMAL" | "WARNING" | "STOPPED",
): Promise<void> {
  await prisma.liveSessionState.update({
    where: { accountId },
    data: { riskState },
  });
}
