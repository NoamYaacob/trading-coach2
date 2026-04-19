import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeFill } from "@/lib/tradovate/adapter";
import {
  getOrCreateSessionState,
  applyTradeClose,
} from "@/lib/guardian-engine/session-state";
import { detectIntervention } from "@/lib/guardian-engine/detector";
import type { AccountRules } from "@/lib/guardian-engine/types";

export async function POST(request: NextRequest) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_available" }, { status: 404 });
  }

  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { accountId } = (await request.json()) as { accountId?: string };
  if (!accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }

  const account = await prisma.connectedAccount.findFirst({
    where: { id: accountId, userId: currentUser.id, platform: "tradovate", isActive: true },
    include: { riskRules: true },
  });

  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  const now = new Date();

  // Synthetic fill — a small losing trade to exercise the full pipeline.
  const syntheticFill = {
    id: Date.now(),
    orderId: 0,
    accountId: Number(account.externalAccountId) || 0,
    contractId: 0,
    timestamp: now.toISOString(),
    tradeDate: { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() },
    action: "Sell" as const,
    qty: 1,
    price: 0,
    active: false,
    profit: -50,
  };

  const normalizedEvent = normalizeFill(account.id, syntheticFill);

  await prisma.normalizedTradeEvent.create({
    data: {
      accountId: account.id,
      eventType: normalizedEvent.eventType,
      // Prefix avoids colliding with real externalTradeIds from Tradovate.
      externalTradeId: `debug-${syntheticFill.id}`,
      side: normalizedEvent.side ?? null,
      quantity: normalizedEvent.quantity != null ? String(normalizedEvent.quantity) : null,
      price: normalizedEvent.price != null ? String(normalizedEvent.price) : null,
      pnl: normalizedEvent.pnl != null ? String(normalizedEvent.pnl) : null,
      rawPayload: (normalizedEvent.rawPayload as object) ?? undefined,
      occurredAt: normalizedEvent.occurredAt,
    },
  });

  // Mirror the webhook handler: transition to connected_live on first event.
  if (account.connectionStatus !== "connected_live") {
    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: { connectionStatus: "connected_live", connectedAt: normalizedEvent.occurredAt },
    });
  }

  const stateBefore = await getOrCreateSessionState(account.id);
  const stateAfter = await applyTradeClose(
    account.id,
    normalizedEvent.pnl ?? -50,
    normalizedEvent.occurredAt,
  );

  const prevEvent = await prisma.normalizedTradeEvent.findFirst({
    where: { accountId: account.id, eventType: "trade_closed" },
    orderBy: { occurredAt: "desc" },
    skip: 1,
  });

  const rules: AccountRules = {
    maxDailyLoss:
      account.riskRules?.maxDailyLoss != null ? Number(account.riskRules.maxDailyLoss) : null,
    riskPerTrade:
      account.riskRules?.riskPerTrade != null ? Number(account.riskRules.riskPerTrade) : null,
    maxTradesPerDay: account.riskRules?.maxTradesPerDay ?? null,
    stopAfterLosses: account.riskRules?.stopAfterLosses ?? null,
    allowedStartHour: account.riskRules?.allowedStartHour ?? null,
    allowedEndHour: account.riskRules?.allowedEndHour ?? null,
  };

  const outcome = detectIntervention(normalizedEvent, stateAfter, rules, {
    previousTradeAt: prevEvent?.occurredAt ?? null,
    previousTradePnl: prevEvent?.pnl != null ? Number(prevEvent.pnl) : null,
    previousTradeQty: prevEvent?.quantity != null ? Number(prevEvent.quantity) : null,
  });

  let intervention = null;
  if (outcome.action !== "no_action") {
    intervention = await prisma.guardianIntervention.create({
      data: {
        accountId: account.id,
        userId: currentUser.id,
        triggerType: outcome.trigger,
        outcome: outcome.action,
        message: "message" in outcome ? outcome.message : null,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    event: {
      eventType: normalizedEvent.eventType,
      pnl: normalizedEvent.pnl,
      occurredAt: normalizedEvent.occurredAt,
    },
    stateBefore: {
      riskState: stateBefore.riskState,
      dailyPnl: Number(stateBefore.dailyPnl),
      tradesCount: stateBefore.tradesCount,
      consecutiveLosses: stateBefore.consecutiveLosses,
    },
    stateAfter: {
      riskState: stateAfter.riskState,
      dailyPnl: Number(stateAfter.dailyPnl),
      tradesCount: stateAfter.tradesCount,
      consecutiveLosses: stateAfter.consecutiveLosses,
    },
    outcome,
    intervention: intervention
      ? { triggerType: intervention.triggerType, outcome: intervention.outcome }
      : null,
    note: "Telegram not sent. State and interventions are persisted.",
  });
}
