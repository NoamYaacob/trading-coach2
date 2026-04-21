import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { normalizeFill, normalizeOrder, normalizeAccountSummary } from "@/lib/tradovate/adapter";
import type { TradovateOrderFill, TradovateOrder, TradovateAccountSummary } from "@/lib/tradovate/types";
import {
  getOrCreateSessionState,
  applyTradeClose,
  applyTradeOpen,
} from "@/lib/guardian-engine/session-state";
import { detectIntervention } from "@/lib/guardian-engine/detector";
import type { AccountRules, NormalizedEvent } from "@/lib/guardian-engine/types";

type DebugTradovateEventRequest = {
  email: string;
  externalAccountId: string;
  type: "fill" | "order" | "account_summary";
  data: TradovateOrderFill | TradovateOrder | TradovateAccountSummary;
};

export async function POST(request: Request) {
  const body = (await request.json()) as DebugTradovateEventRequest;

  if (!body.email || !body.externalAccountId || !body.type || !body.data) {
    return NextResponse.json(
      { error: "email, externalAccountId, type, and data are required" },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { email: body.email.trim().toLowerCase() },
    select: { id: true, email: true },
  });

  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const account = await prisma.connectedAccount.findFirst({
    where: {
      userId: user.id,
      externalAccountId: String(body.externalAccountId).trim(),
      platform: "tradovate",
      isActive: true,
    },
    include: { riskRules: true },
  });

  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  let normalizedEvent: NormalizedEvent | null = null;
  if (body.type === "fill") {
    normalizedEvent = normalizeFill(account.id, body.data as TradovateOrderFill);
  } else if (body.type === "order") {
    normalizedEvent = normalizeOrder(account.id, body.data as TradovateOrder);
  } else if (body.type === "account_summary") {
    normalizedEvent = normalizeAccountSummary(account.id, body.data as TradovateAccountSummary);
  }

  if (!normalizedEvent) {
    return NextResponse.json({ error: "unhandled event type" }, { status: 400 });
  }

  // Persist the normalized event
  await prisma.normalizedTradeEvent.create({
    data: {
      accountId: account.id,
      eventType: normalizedEvent.eventType,
      externalTradeId: normalizedEvent.externalTradeId ?? null,
      side: normalizedEvent.side ?? null,
      quantity: normalizedEvent.quantity != null ? String(normalizedEvent.quantity) : null,
      price: normalizedEvent.price != null ? String(normalizedEvent.price) : null,
      pnl: normalizedEvent.pnl != null ? String(normalizedEvent.pnl) : null,
      rawPayload: normalizedEvent.rawPayload as object ?? undefined,
      occurredAt: normalizedEvent.occurredAt,
    },
  });

  const isTradeClose = (t: string) =>
    t === "trade_closed" || t === "trade_closed_win" || t === "trade_closed_loss";

  const stateBefore = await getOrCreateSessionState(account.id);

  let stateAfter = stateBefore;
  if (isTradeClose(normalizedEvent.eventType) && normalizedEvent.pnl != null) {
    stateAfter = await applyTradeClose(account.id, normalizedEvent.pnl, normalizedEvent.occurredAt);
  } else if (normalizedEvent.eventType === "trade_opened") {
    stateAfter = await applyTradeOpen(account.id, normalizedEvent.occurredAt);
  }

  const prevEvent = await prisma.normalizedTradeEvent.findFirst({
    where: {
      accountId: account.id,
      eventType: { in: ["trade_closed", "trade_closed_win", "trade_closed_loss"] },
    },
    orderBy: { occurredAt: "desc" },
    skip: isTradeClose(normalizedEvent.eventType) ? 1 : 0,
  });

  const rules: AccountRules = {
    maxDailyLoss: account.riskRules?.maxDailyLoss != null ? Number(account.riskRules.maxDailyLoss) : null,
    riskPerTrade: account.riskRules?.riskPerTrade != null ? Number(account.riskRules.riskPerTrade) : null,
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
        userId: user.id,
        triggerType: outcome.trigger,
        outcome: outcome.action,
        message: "message" in outcome ? outcome.message : null,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    account: { id: account.id, label: account.label, externalAccountId: account.externalAccountId },
    normalizedEvent: {
      eventType: normalizedEvent.eventType,
      side: normalizedEvent.side,
      quantity: normalizedEvent.quantity,
      price: normalizedEvent.price,
      pnl: normalizedEvent.pnl,
      occurredAt: normalizedEvent.occurredAt,
    },
    stateBefore: {
      riskState: stateBefore.riskState,
      dailyPnl: Number(stateBefore.dailyPnl),
      tradesCount: stateBefore.tradesCount,
      consecutiveLosses: stateBefore.consecutiveLosses,
      cooldownActive: stateBefore.cooldownActive,
    },
    stateAfter: {
      riskState: stateAfter.riskState,
      dailyPnl: Number(stateAfter.dailyPnl),
      tradesCount: stateAfter.tradesCount,
      consecutiveLosses: stateAfter.consecutiveLosses,
      cooldownActive: stateAfter.cooldownActive,
    },
    rules,
    outcome,
    intervention: intervention ? { id: intervention.id, triggerType: intervention.triggerType, outcome: intervention.outcome } : null,
    note: "Telegram not sent in debug mode. State and interventions are persisted.",
  });
}
