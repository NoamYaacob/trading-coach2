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

// Triggers that should fire at most once per trading session.
// Concurrent requests can both read NORMAL state before either writes STOPPED,
// so we do a DB-level check before creating the intervention record.
const ONCE_PER_SESSION_TRIGGERS = new Set(["daily_loss_limit", "max_trades_reached"]);

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

  // Malformed JSON causes request.json() to throw. Return 400 so Tradovate
  // does not retry — retrying a malformed payload would never succeed.
  let body: TradovateWebhookEvent;
  try {
    body = (await request.json()) as TradovateWebhookEvent;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Validate the top-level accountId is present before any DB work.
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

  // Normalize the incoming Tradovate event. Adapter throws on invalid
  // timestamps or missing required fields — treat those as bad data, not
  // server errors, so Tradovate does not retry.
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

  // Deduplication: fills and orders carry a stable externalTradeId from Tradovate.
  // If we have already persisted this event (Tradovate retry / duplicate delivery),
  // skip the entire pipeline — no state mutation, no intervention.
  if (normalizedEvent.externalTradeId) {
    const duplicate = await prisma.normalizedTradeEvent.findFirst({
      where: {
        accountId: account.id,
        eventType: normalizedEvent.eventType,
        externalTradeId: normalizedEvent.externalTradeId,
      },
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

  // Transition connection status to live on first successful event.
  // This is idempotent — safe to run on every event, not just the first.
  if (account.connectionStatus !== "connected_live") {
    await prisma.connectedAccount.update({
      where: { id: account.id },
      data: { connectionStatus: "connected_live", connectedAt: normalizedEvent.occurredAt },
    });
  }

  // Apply state mutation. getOrCreateSessionState also clears expired cooldowns.
  let state = await getOrCreateSessionState(account.id);

  if (normalizedEvent.eventType === "trade_closed" && normalizedEvent.pnl != null) {
    state = await applyTradeClose(account.id, normalizedEvent.pnl, normalizedEvent.occurredAt);
  } else if (normalizedEvent.eventType === "trade_opened") {
    state = await applyTradeOpen(account.id, normalizedEvent.occurredAt);
  }

  // Get the previous closed trade for pnl/qty context (skip current if it was a close).
  const prevEvent = await prisma.normalizedTradeEvent.findFirst({
    where: {
      accountId: account.id,
      eventType: "trade_closed",
    },
    orderBy: { occurredAt: "desc" },
    skip: normalizedEvent.eventType === "trade_closed" ? 1 : 0,
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

  // Prevent firing the same once-per-session trigger more than once.
  // This guards against concurrent requests that both read NORMAL state before
  // either one writes STOPPED — without this check, both would create
  // interventions and both would attempt Telegram sends.
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

  // Log the intervention.
  const intervention = await prisma.guardianIntervention.create({
    data: {
      accountId: account.id,
      userId: account.userId,
      triggerType: outcome.trigger,
      outcome: outcome.action,
      message: "message" in outcome ? outcome.message : null,
    },
  });

  // Apply state effects in order of severity.
  if (outcome.action === "cooldown") {
    await setCooldown(account.id, outcome.durationMinutes);
  }

  if (outcome.action === "stop") {
    await setRiskState(account.id, "STOPPED");
  }

  if (outcome.action === "warning") {
    await setRiskState(account.id, "WARNING");
  }

  if (outcome.action === "telegram_message_trigger" && outcome.trigger === "daily_loss_limit") {
    await setRiskState(account.id, "STOPPED");
  }

  // Send Telegram coaching message. Wrapped in try/catch so a Telegram or
  // voice-generation failure does not cause a 500 — which would make Tradovate
  // retry and double-process the event. The intervention is already persisted.
  if (outcome.action === "telegram_message_trigger") {
    const chatId = account.user.telegramConnection?.telegramChatId;
    if (chatId) {
      try {
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
      } catch {
        // Intervention is already logged without sentAt.
      }
    }
  }

  return NextResponse.json({ ok: true, outcome: outcome.action });
}
