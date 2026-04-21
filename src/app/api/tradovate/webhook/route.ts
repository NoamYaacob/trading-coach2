import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { getLocale } from "@/lib/i18n";
import { getTelegramQuickActionKeyboard } from "@/lib/coach-actions";
import { sendTelegramMessage } from "@/lib/telegram";
import { generateVoiceReply } from "@/lib/voice-writer";
import type { CoachingIntent } from "@/lib/voice-writer";
import { normalizeFill, normalizeOrder, normalizeAccountSummary } from "@/lib/tradovate/adapter";
import type { TradovateWebhookEvent } from "@/lib/tradovate/types";
import {
  getOrCreateSessionState,
  applyTradeClose,
  applyTradeOpen,
  setCooldown,
  setRiskState,
} from "@/lib/guardian-engine/session-state";
import { detectIntervention } from "@/lib/guardian-engine/detector";
import { buildEnforcementPlan } from "@/lib/guardian-engine/enforcement";
import type { AccountRules, NormalizedEvent } from "@/lib/guardian-engine/types";

// Triggers that fire at most once per session (prevents Telegram spam on repeated signals).
// Concurrent requests are guarded by the DB-level check below.
const ONCE_PER_SESSION_TRIGGERS = new Set([
  "daily_loss_limit",
  "max_trades_reached",
  "rapid_trading",
  "increased_size_after_loss",
  "unrealized_drawdown",
  "outside_allowed_hours",
]);

/** Returns true for any event type that represents a closed trade. */
function isTradeClose(eventType: string): boolean {
  return (
    eventType === "trade_closed" ||
    eventType === "trade_closed_win" ||
    eventType === "trade_closed_loss"
  );
}

function todayUTCStart(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-tradovate-secret");
  const expected = process.env.TRADOVATE_WEBHOOK_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Malformed JSON returns 400 so Tradovate does not retry an unprocessable payload.
  let body: TradovateWebhookEvent;
  try {
    body = (await request.json()) as TradovateWebhookEvent;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.accountId) {
    return NextResponse.json({ ok: true, skipped: "missing_account_id" });
  }

  const account = await prisma.connectedAccount.findFirst({
    where: {
      externalAccountId: String(body.accountId),
      platform: "tradovate",
      isActive: true,
    },
    include: {
      riskRules: true,
      user: {
        select: {
          id: true,
          mentalProfile: {
            select: {
              coachingTone: true,
              interruptionStyle: true,
              responseStyle: true,
              preferredAddress: true,
              reminderAnchors: true,
              disciplineBreakPattern: true,
              whatHelpsRefocus: true,
            },
          },
          coachingPreferences: {
            select: {
              preferredLanguage: true,
              wantsToughInterventionWhenTilting: true,
            },
          },
          telegramConnection: {
            select: { telegramChatId: true },
          },
        },
      },
    },
  });

  if (!account) {
    return NextResponse.json({ ok: true, skipped: "account_not_found" });
  }

  // Normalize the incoming event — adapter throws on invalid timestamps or missing required
  // fields, which are treated as bad data (400) so Tradovate does not retry them.
  let normalizedEvent: NormalizedEvent | null = null;
  try {
    if (body.type === "fill") {
      normalizedEvent = normalizeFill(account.id, body.data);
    } else if (body.type === "order") {
      normalizedEvent = normalizeOrder(account.id, body.data);
    } else if (body.type === "account_summary") {
      normalizedEvent = normalizeAccountSummary(account.id, body.data);
    }
  } catch {
    return NextResponse.json({ ok: true, skipped: "invalid_event_data" });
  }

  if (!normalizedEvent) {
    return NextResponse.json({ ok: true, skipped: "unhandled_event_type" });
  }

  // Deduplication: fills and orders carry a stable externalTradeId.
  // Treat all trade_closed* variants as equivalent for dedup (a fill retry keeps the same ID).
  if (normalizedEvent.externalTradeId) {
    const dupWhere = isTradeClose(normalizedEvent.eventType)
      ? {
          accountId: account.id,
          eventType: { in: ["trade_closed", "trade_closed_win", "trade_closed_loss"] },
          externalTradeId: normalizedEvent.externalTradeId,
        }
      : {
          accountId: account.id,
          eventType: normalizedEvent.eventType,
          externalTradeId: normalizedEvent.externalTradeId,
        };

    const duplicate = await prisma.normalizedTradeEvent.findFirst({
      where: dupWhere,
      select: { id: true },
    });
    if (duplicate) {
      return NextResponse.json({ ok: true, skipped: "duplicate_event" });
    }
  }

  // Persist the normalized event.
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

  // Transition connection status to live on first successful event (idempotent).
  if (account.connectionStatus !== "connected_live") {
    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: { connectionStatus: "connected_live", connectedAt: normalizedEvent.occurredAt },
    });
  }

  // Apply session state mutations. getOrCreateSessionState clears expired cooldowns.
  let state = await getOrCreateSessionState(account.id);

  if (isTradeClose(normalizedEvent.eventType) && normalizedEvent.pnl != null) {
    state = await applyTradeClose(account.id, normalizedEvent.pnl, normalizedEvent.occurredAt);
  } else if (normalizedEvent.eventType === "trade_opened") {
    state = await applyTradeOpen(account.id, normalizedEvent.occurredAt);
  }

  // Load the most recent closed trade for context (skip the current one if it was a close).
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

  const outcome = detectIntervention(normalizedEvent, state, rules, {
    previousTradeAt: prevEvent?.occurredAt ?? null,
    previousTradePnl: prevEvent?.pnl != null ? Number(prevEvent.pnl) : null,
    previousTradeQty: prevEvent?.quantity != null ? Number(prevEvent.quantity) : null,
  });

  if (outcome.action === "no_action") {
    return NextResponse.json({ ok: true, outcome: "no_action" });
  }

  // Dedup once-per-session triggers before creating the intervention record.
  // Guards against concurrent requests and repeated rapid-trading events.
  if (ONCE_PER_SESSION_TRIGGERS.has(outcome.trigger)) {
    const alreadyFired = await prisma.guardianIntervention.findFirst({
      where: {
        accountId: account.id,
        triggerType: outcome.trigger,
        createdAt: { gte: todayUTCStart() },
      },
      select: { id: true },
    });
    if (alreadyFired) {
      return NextResponse.json({ ok: true, skipped: "already_intervened", trigger: outcome.trigger });
    }
  }

  // Build the enforcement plan — determines tier, DB action, and coaching intent.
  const plan = buildEnforcementPlan(outcome);
  if (!plan) {
    return NextResponse.json({ ok: true, outcome: "no_action" });
  }

  // Log the intervention with the enforcement tier as part of the outcome label.
  const intervention = await prisma.guardianIntervention.create({
    data: {
      accountId: account.id,
      userId: account.userId,
      triggerType: outcome.trigger,
      outcome: `${outcome.action}:${plan.tier}`,
      message: "message" in outcome ? outcome.message : null,
    },
  });

  // Apply DB state changes based on enforcement tier.
  if (plan.tier === "cooldown" && outcome.action === "cooldown") {
    await setCooldown(account.id, outcome.durationMinutes);
  } else if (plan.tier === "lockdown") {
    await setRiskState(account.id, "STOPPED");
  } else if (plan.tier === "hard_warning") {
    await setRiskState(account.id, "WARNING");
  }
  // soft_warning: no riskState change — the account can continue trading

  // Send Telegram coaching message for ALL enforcement tiers.
  // A Telegram or voice-generation failure must not cause a 500 — the intervention is
  // already persisted and the state has been updated. Tradovate retrying the webhook
  // would re-process the event with the wrong state.
  const chatId = account.user.telegramConnection?.telegramChatId;
  if (chatId) {
    try {
      const language = account.user.coachingPreferences?.preferredLanguage ?? "he";
      const locale = getLocale(language);

      const message = await generateVoiceReply({
        intent: plan.coachingIntent as CoachingIntent,
        traderMessage: `[Guardian alert: ${outcome.trigger}]`,
        constraintMessage: "message" in outcome ? outcome.message : null,
        personalCue: null,
        knownPattern: null,
        askQuestion: false,
        language,
        coachingTone: account.user.mentalProfile?.coachingTone ?? null,
        interruptionStyle: account.user.mentalProfile?.interruptionStyle ?? null,
        responseStyle: account.user.mentalProfile?.responseStyle ?? null,
        preferredAddress: account.user.mentalProfile?.preferredAddress ?? null,
        recentMessages: [],
        reminderAnchors: account.user.mentalProfile?.reminderAnchors ?? [],
        disciplineBreakPattern: account.user.mentalProfile?.disciplineBreakPattern ?? null,
        whatHelpsRefocus: account.user.mentalProfile?.whatHelpsRefocus ?? null,
        wantsToughIntervention: account.user.coachingPreferences?.wantsToughInterventionWhenTilting ?? true,
      });

      if (message) {
        await sendTelegramMessage(chatId, message, {
          replyMarkup: {
            keyboard: getTelegramQuickActionKeyboard(locale),
            resize_keyboard: true,
            input_field_placeholder: locale.system.inputPlaceholder,
          },
        });

        await prisma.guardianIntervention.update({
          where: { id: intervention.id },
          data: { message, sentAt: new Date() },
        });
      }
    } catch {
      // Intervention is already logged. sentAt remains null to indicate message was not sent.
    }
  }

  return NextResponse.json({ ok: true, outcome: outcome.action, tier: plan.tier });
}
