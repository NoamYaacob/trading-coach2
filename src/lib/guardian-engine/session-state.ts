import { prisma } from "@/lib/db";
import type { SessionState } from "./types";

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

  if (existing) return toSessionState(existing);

  return toSessionState(
    await prisma.liveSessionState.create({
      data: { accountId, sessionDate: today },
    }),
  );
}

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
        tradesCount: { increment: 1 },
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
        tradesCount: { increment: 1 },
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
