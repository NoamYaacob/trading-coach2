import { prisma } from "@/lib/db";
import { getLocale } from "@/lib/i18n";
import { getTelegramQuickActionKeyboard } from "@/lib/coach-actions";
import { sendTelegramMessage } from "@/lib/telegram";
import { generateVoiceReply } from "@/lib/voice-writer";
import type { CoachingIntent } from "@/lib/voice-writer";
import { evaluateIntervention } from "@/lib/intervention-engine";
import type { CurrentInterventionEvent } from "@/lib/intervention-engine";
import { getGuardianSnapshot } from "@/lib/guardian";

async function loadUserCoachingData(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      telegramConnection: {
        select: { telegramChatId: true },
      },
      coachingPreferences: {
        select: {
          preferredLanguage: true,
          wantsToughInterventionWhenTilting: true,
        },
      },
      mentalProfile: {
        select: {
          coachingTone: true,
          interruptionStyle: true,
          responseStyle: true,
          preferredAddress: true,
          tradingGoal: true,
          tradingWhy: true,
          groundingReminder: true,
          primaryChallenge: true,
          tiltTrigger: true,
          reminderAnchors: true,
          disciplineBreakPattern: true,
          whatHelpsRefocus: true,
        },
      },
      riskRules: {
        select: {
          maxDailyLoss: true,
          maxTradesPerDay: true,
          stopAfterLosses: true,
          riskPerTrade: true,
        },
      },
    },
  });
}

async function sendCoachingPush(
  userId: string,
  intent: CoachingIntent,
  traderMessage: string,
  constraintMessage: string | null,
): Promise<boolean> {
  const user = await loadUserCoachingData(userId);
  if (!user?.telegramConnection?.telegramChatId) return false;

  const chatId = user.telegramConnection.telegramChatId;
  const language = user.coachingPreferences?.preferredLanguage ?? "he";
  const locale = getLocale(language);
  const wantsToughIntervention = user.coachingPreferences?.wantsToughInterventionWhenTilting ?? true;

  const message = await generateVoiceReply({
    intent,
    traderMessage,
    constraintMessage,
    personalCue: user.mentalProfile?.tradingGoal
      ? { type: "goal", text: user.mentalProfile.tradingGoal }
      : null,
    knownPattern: null,
    askQuestion: intent === "pre_session_checkin" || intent === "end_of_day_review",
    language,
    coachingTone: user.mentalProfile?.coachingTone ?? null,
    interruptionStyle: user.mentalProfile?.interruptionStyle ?? null,
    responseStyle: user.mentalProfile?.responseStyle ?? null,
    preferredAddress: user.mentalProfile?.preferredAddress ?? null,
    recentMessages: [],
    recentCoachingExchanges: [],
    reminderAnchors: user.mentalProfile?.reminderAnchors ?? [],
    disciplineBreakPattern: user.mentalProfile?.disciplineBreakPattern ?? null,
    whatHelpsRefocus: user.mentalProfile?.whatHelpsRefocus ?? null,
    wantsToughIntervention,
  });

  if (!message) return false;

  await sendTelegramMessage(chatId, message, {
    replyMarkup: {
      keyboard: getTelegramQuickActionKeyboard(locale),
      resize_keyboard: true,
      input_field_placeholder: locale.system.inputPlaceholder,
    },
  });

  return true;
}

export async function sendProactiveCheckin(userId: string): Promise<void> {
  await sendCoachingPush(
    userId,
    "pre_session_checkin",
    "[Proactive pre-session check-in]",
    null,
  );
}

export async function sendProactiveReview(userId: string): Promise<void> {
  const guardian = await getGuardianSnapshot(userId);
  const pnl = guardian.evaluation.todayPnL;
  const tradeCount = guardian.evaluation.todayTradesCount;

  const traderMessage = `[Proactive end-of-day review — PnL: ${pnl >= 0 ? "+" : ""}${pnl}, trades: ${tradeCount}]`;

  await sendCoachingPush(userId, "end_of_day_review", traderMessage, null);
}

export async function sendInterventionAlert(
  userId: string,
  event: CurrentInterventionEvent,
): Promise<void> {
  const result = evaluateIntervention(event);
  if (!result.shouldSendTelegram) return;

  const intentMap: Partial<Record<CurrentInterventionEvent["type"], CoachingIntent>> = {
    pre_session_check_in: "pre_session_checkin",
    end_of_day_review: "end_of_day_review",
    consecutive_losses_warning: "acknowledge_multiple_losses",
    revenge_trading_signal: "stop_revenge",
    near_daily_loss_limit: "rule_limit_hit",
    exceeded_trade_count: "rule_limit_hit",
    mid_session_goal_reminder: "surface_purpose",
  };

  const intent: CoachingIntent = intentMap[event.type] ?? "general_coaching";

  await sendCoachingPush(
    userId,
    intent,
    `[Guardian alert: ${event.type}]`,
    result.coachingPrompt,
  );
}
