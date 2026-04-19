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
import type { AccountRules, NormalizedEvent } from "@/lib/guardian-engine/types";

export async function POST(request: Request) {
  const secret = request.headers.get("x-tradovate-secret");
  const expected = process.env.TRADOVATE_WEBHOOK_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as TradovateWebhookEvent;

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
            },
          },
          coachingPreferences: {
            select: { preferredLanguage: true },
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

  // Normalize the incoming Tradovate event
  let normalizedEvent: NormalizedEvent | null = null;
  if (body.type === "fill") {
    normalizedEvent = normalizeFill(account.id, body.data);
  } else if (body.type === "order") {
    normalizedEvent = normalizeOrder(account.id, body.data);
  } else if (body.type === "account_summary") {
    normalizedEvent = normalizeAccountSummary(account.id, body.data);
  }

  if (!normalizedEvent) {
    return NextResponse.json({ ok: true, skipped: "unhandled_event_type" });
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

  // Get or create session state, then apply the event
  let state = await getOrCreateSessionState(account.id);

  if (normalizedEvent.eventType === "trade_closed" && normalizedEvent.pnl != null) {
    state = await applyTradeClose(account.id, normalizedEvent.pnl, normalizedEvent.occurredAt);
  } else if (normalizedEvent.eventType === "trade_opened") {
    state = await applyTradeOpen(account.id, normalizedEvent.occurredAt);
  }

  // Get the previous closed trade for pnl/qty context (skip current if it was a close)
  const prevEvent = await prisma.normalizedTradeEvent.findFirst({
    where: {
      accountId: account.id,
      eventType: "trade_closed",
    },
    orderBy: { occurredAt: "desc" },
    skip: normalizedEvent.eventType === "trade_closed" ? 1 : 0,
  });

  // Build account rules
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

  // Log the intervention
  const intervention = await prisma.guardianIntervention.create({
    data: {
      accountId: account.id,
      userId: account.userId,
      triggerType: outcome.trigger,
      outcome: outcome.action,
      message: "message" in outcome ? outcome.message : null,
    },
  });

  // Apply cooldown to session state
  if (outcome.action === "cooldown") {
    await setCooldown(account.id, outcome.durationMinutes);
  }

  // Mark as stopped for hard stops
  if (outcome.action === "stop") {
    await setRiskState(account.id, "STOPPED");
  }

  // Mark as warning for warnings
  if (outcome.action === "warning") {
    await setRiskState(account.id, "WARNING");
  }

  // Send Telegram intervention for serious events
  if (outcome.action === "telegram_message_trigger") {
    const chatId = account.user.telegramConnection?.telegramChatId;
    if (chatId) {
      const language = account.user.coachingPreferences?.preferredLanguage ?? "he";
      const locale = getLocale(language);

      const message = await generateVoiceReply({
        intent: outcome.coachingIntent as CoachingIntent,
        traderMessage: `[Guardian alert: ${outcome.trigger}]`,
        constraintMessage: null,
        personalCue: null,
        knownPattern: null,
        askQuestion: false,
        language,
        coachingTone: account.user.mentalProfile?.coachingTone ?? null,
        interruptionStyle: account.user.mentalProfile?.interruptionStyle ?? null,
        responseStyle: account.user.mentalProfile?.responseStyle ?? null,
        preferredAddress: account.user.mentalProfile?.preferredAddress ?? null,
        recentMessages: [],
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
    }
  }

  return NextResponse.json({ ok: true, outcome: outcome.action });
}
