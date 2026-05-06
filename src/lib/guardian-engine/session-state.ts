import { prisma } from "@/lib/db";
import type { SessionState } from "./types";
export { classifyFill } from "./fill-classifier";

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
      eventType: { in: ["trade_closed", "trade_closed_win", "trade_closed_loss"] },
    },
    select: { side: true, quantity: true },
    orderBy: { occurredAt: "asc" },
  });

  let position = 0;
  for (const f of fills) {
    const qty = Number(f.quantity ?? 0);
    position += f.side === "BUY" ? qty : -qty;
  }
  return position;
}

/** Called when a fill opens a new position entry. Increments tradesCount only. */
export async function applyTradeEntry(
  accountId: string,
  occurredAt: Date,
): Promise<SessionState> {
  return toSessionState(
    await prisma.liveSessionState.update({
      where: { accountId },
      data: {
        tradesCount: { increment: 1 },
        lastTradeAt: occurredAt,
      },
    }),
  );
}

/**
 * Called when a fill closes a position (exit fill). Updates dailyPnl and
 * consecutiveLosses. Does NOT increment tradesCount — entries are counted
 * separately in applyTradeEntry so exits are not double-counted.
 */
export async function applyTradeClose(
  accountId: string,
  pnl: number,
  occurredAt: Date,
): Promise<SessionState> {
  const isLoss = pnl < 0;
  return toSessionState(
    await prisma.liveSessionState.update({
      where: { accountId },
      data: {
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
