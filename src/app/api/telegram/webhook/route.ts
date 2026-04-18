import { NextResponse } from "next/server";
import { TraderCurrentState } from "@prisma/client";

import {
  generateAICoachReply,
  isAICoachEnabled,
  EMOTIONAL_ACTION_IDS,
  shouldUseAICoach,
  detectConversationMode,
} from "@/lib/ai-coach";
import type { CoachIntent } from "@/lib/coach";
import {
  findActionByLocaleText,
  getLocaleReplyForQuickAction,
  getTelegramQuickActionKeyboard,
} from "@/lib/coach-actions";
import { prisma } from "@/lib/db";
import { getLocale } from "@/lib/i18n";
import type { BotLocale } from "@/lib/i18n";
import {
  deriveTodaySessionState,
  getGuardianSnapshot,
  getTodayGuardianSessionStart,
} from "@/lib/guardian";
import { deriveManualEventSignals, getTodayManualEvents } from "@/lib/manual-trade-events";
import {
  buildRuleEngineInputFromGuardianSnapshot,
  buildViolationFeed,
} from "@/lib/rule-engine";
import { getRecentSessionContext, logCoachEvent } from "@/lib/session-log";
import { evaluateTelegramAccess } from "@/lib/telegram-access";
import { sendTelegramMessage } from "@/lib/telegram";
import {
  getSelectedEconomicCalendarSnapshot,
  getCurrentPreNewsPolicy,
  isInsidePreNewsWarningWindow,
} from "@/lib/economic-calendar";
import {
  deriveShortLivedCoachingFlags,
  deriveTraderStateUpdate,
  getCurrentTraderState,
  setCurrentTraderState,
} from "@/lib/trader-state";

type TelegramWebhookPayload = {
  message?: {
    text?: string;
    chat?: {
      id?: number;
    };
    from?: {
      id?: number;
      username?: string;
    };
  };
  startToken?: string;
};

async function replyToTelegram(chatId: string, text: string, locale: BotLocale) {
  await sendTelegramMessage(chatId, text, {
    replyMarkup: {
      keyboard: getTelegramQuickActionKeyboard(locale),
      resize_keyboard: true,
      input_field_placeholder: locale.system.inputPlaceholder,
    },
  });
  return NextResponse.json({ ok: true });
}

async function loadLinkedUserByTelegramUserId(telegramUserId: string) {
  return prisma.telegramConnection.findUnique({
    where: { telegramUserId },
    include: {
      user: {
        select: {
          id: true,
          subscriptionStatus: true,
          trialEndsAt: true,
          traderProfile: {
            select: {
              id: true,
              primaryMarket: true,
              tradingStyle: true,
            },
          },
          riskRules: {
            select: {
              accountSize: true,
              maxDailyLoss: true,
              riskPerTrade: true,
              maxTradesPerDay: true,
              stopAfterLosses: true,
            },
          },
          mentalProfile: {
            select: {
              primaryChallenge: true,
              tiltTrigger: true,
              tiltThought: true,
              coachingTone: true,
              interruptionStyle: true,
              responseStyle: true,
              tradingWhy: true,
              tradingGoal: true,
              groundingReminder: true,
              preferredAddress: true,
            },
          },
          coachingPreferences: true,
          traderState: {
            select: {
              currentState: true,
              stateNotes: true,
              recentLossStreak: true,
              needsCooldown: true,
              cooldownUntil: true,
            },
          },
        },
      },
    },
  });
}

async function connectTelegramAccount(params: {
  token: string;
  telegramUserId: string;
  telegramChatId: string;
  telegramUsername?: string;
}) {
  const linkToken = await prisma.telegramLinkToken.findUnique({
    where: { token: params.token },
    include: {
      user: {
        select: {
          id: true,
          subscriptionStatus: true,
          trialEndsAt: true,
          traderProfile: {
            select: { id: true },
          },
          coachingPreferences: {
            select: { preferredLanguage: true },
          },
        },
      },
    },
  });

  if (linkToken?.usedAt) {
    // Token already consumed — connection was created on a previous delivery.
    // Return 200 silently so Telegram stops retrying this update.
    return NextResponse.json({ ok: true });
  }

  if (!linkToken || linkToken.expiresAt < new Date()) {
    const defaultLocale = getLocale();
    return replyToTelegram(params.telegramChatId, defaultLocale.system.invalidLink, defaultLocale);
  }

  await prisma.$transaction([
    prisma.telegramConnection.upsert({
      where: { userId: linkToken.user.id },
      create: {
        userId: linkToken.user.id,
        telegramUserId: params.telegramUserId,
        telegramUsername: params.telegramUsername,
        telegramChatId: params.telegramChatId,
        lastWebhookAt: new Date(),
      },
      update: {
        telegramUserId: params.telegramUserId,
        telegramUsername: params.telegramUsername,
        telegramChatId: params.telegramChatId,
        lastWebhookAt: new Date(),
      },
    }),
    prisma.telegramLinkToken.update({
      where: { id: linkToken.id },
      data: { usedAt: new Date() },
    }),
  ]);

  const access = evaluateTelegramAccess({
    subscriptionStatus: linkToken.user.subscriptionStatus,
    trialEndsAt: linkToken.user.trialEndsAt,
    onboardingComplete: Boolean(linkToken.user.traderProfile),
    telegramConnected: true,
  });

  const connectLocale = getLocale(linkToken.user.coachingPreferences?.preferredLanguage);

  if (!linkToken.user.traderProfile) {
    return replyToTelegram(
      params.telegramChatId,
      connectLocale.system.connectSuccessIncomplete,
      connectLocale,
    );
  }

  if (!access.accessActive) {
    return replyToTelegram(
      params.telegramChatId,
      connectLocale.system.connectSuccessNoAccess,
      connectLocale,
    );
  }

  return replyToTelegram(
    params.telegramChatId,
    connectLocale.system.connectSuccess,
    connectLocale,
  );
}

function deriveLogIntent(actionId: string | null, rawText: string): CoachIntent {
  if (actionId) {
    if (actionId === "check-in") return "check_in";
    if (actionId === "day-summary") return "day_summary";
    if (actionId === "rule-limits") return "rule_question";
    return "emotional_distress";
  }
  if (!rawText) return "check_in";
  return "generic_coaching";
}

export async function POST(request: Request) {
  const payload = (await request.json()) as TelegramWebhookPayload;
  const rawText = payload.message?.text?.trim() ?? "";
  const startMatch = rawText.match(/^\/start\s+(\S+)/);
  const token = payload.startToken ?? startMatch?.[1] ?? "";
  const telegramUserId = payload.message?.from?.id;
  const telegramChatId = payload.message?.chat?.id;

  if (!telegramUserId || !telegramChatId) {
    // Non-message update type (channel post, poll, etc.) — acknowledge and ignore.
    return NextResponse.json({ ok: true });
  }

  const chatId = String(telegramChatId);

  if (token && rawText.startsWith("/start")) {
    return connectTelegramAccount({
      token,
      telegramUserId: String(telegramUserId),
      telegramChatId: chatId,
      telegramUsername: payload.message?.from?.username,
    });
  }

  const connection = await loadLinkedUserByTelegramUserId(String(telegramUserId));

  if (!connection) {
    const defaultLocale = getLocale();
    return replyToTelegram(chatId, defaultLocale.system.notLinked, defaultLocale);
  }

  const locale = getLocale(connection.user.coachingPreferences?.preferredLanguage);

  const access = evaluateTelegramAccess({
    subscriptionStatus: connection.user.subscriptionStatus,
    trialEndsAt: connection.user.trialEndsAt,
    onboardingComplete: Boolean(connection.user.traderProfile),
    telegramConnected: true,
  });

  if (!connection.user.traderProfile) {
    return replyToTelegram(chatId, locale.system.onboardingIncomplete, locale);
  }

  if (!access.accessActive) {
    return replyToTelegram(chatId, locale.system.accessInactive, locale);
  }

  await prisma.telegramConnection.update({
    where: { id: connection.id },
    data: {
      telegramUsername: payload.message?.from?.username,
      telegramChatId: chatId,
      lastWebhookAt: new Date(),
    },
  });

  const matchedAction = rawText ? findActionByLocaleText(rawText, locale) : null;
  const canonicalText = matchedAction?.message ?? rawText;

  const stateUpdate = canonicalText ? deriveTraderStateUpdate(canonicalText) : null;

  const activeTraderState = stateUpdate
    ? (
        await setCurrentTraderState(
          connection.user.id,
          stateUpdate.nextState,
          stateUpdate.extraData,
        )
      ).traderState
    : (await getCurrentTraderState(connection.user.id)).traderState;

  const flags = deriveShortLivedCoachingFlags(activeTraderState);

  const isFreeText = rawText.length > 0 && matchedAction === null;
  // Pre-decision using only what we know before DB fetches — session context
  // is only loaded when AI is at least plausible for this message type.
  const mightUseAI =
    isAICoachEnabled() &&
    (isFreeText || (matchedAction !== null && EMOTIONAL_ACTION_IDS.has(matchedAction.id)));

  const [guardian, todayGuardianSession, economicCalendarSnapshot, todayManualEvents, sessionContext] = await Promise.all([
    getGuardianSnapshot(connection.user.id),
    getTodayGuardianSessionStart(connection.user.id),
    getSelectedEconomicCalendarSnapshot(connection.user.coachingPreferences),
    getTodayManualEvents(connection.user.id),
    mightUseAI ? getRecentSessionContext(connection.user.id) : Promise.resolve(null),
  ]);

  const todaySessionState = deriveTodaySessionState(guardian, {
    onboardingComplete: Boolean(connection.user.traderProfile),
    sessionStart: todayGuardianSession,
  });

  const economicCalendarPolicy = getCurrentPreNewsPolicy(economicCalendarSnapshot);
  const manualEventSignals = deriveManualEventSignals(todayManualEvents);

  const violationFeed = buildViolationFeed(
    buildRuleEngineInputFromGuardianSnapshot(guardian, {
      sessionStarted: todaySessionState.sessionStarted,
      sessionEnded: todaySessionState.sessionEnded,
      todaySessionStateKind: todaySessionState.kind,
      preNewsPolicy: economicCalendarPolicy.isActive
        ? {
            isActive: economicCalendarPolicy.isActive,
            mode: economicCalendarPolicy.policy.mode,
            message: economicCalendarPolicy.message,
          }
        : null,
      manualSignals: manualEventSignals,
    }),
  );

  const recentMessages = sessionContext
    ? sessionContext.recentEvents
        .slice()
        .reverse()
        .slice(0, 4)
        .map((e) => ({
          message: e.message ?? "",
          traderState: String(e.traderState ?? "NONE"),
        }))
    : [];

  const conversationMode = detectConversationMode({
    message: rawText,
    hasEmotionalAction: matchedAction !== null && EMOTIONAL_ACTION_IDS.has(matchedAction.id),
    guardianLocked: guardian.evaluation.lockoutActive,
  });

  const isCoachingMode = conversationMode === "coaching";

  const aiInput = {
    message: rawText || (matchedAction ? canonicalText : "") || locale.keyboard.checkIn,
    language: connection.user.coachingPreferences?.preferredLanguage ?? "he",
    source: "telegram" as const,
    alertContext: null,
    actionId: matchedAction?.id ?? null,
    primaryMarket: connection.user.traderProfile?.primaryMarket ?? null,
    tradingStyle: connection.user.traderProfile?.tradingStyle ?? null,
    coachingTone: connection.user.mentalProfile?.coachingTone ?? null,
    maxDailyLoss: connection.user.riskRules?.maxDailyLoss
      ? parseFloat(String(connection.user.riskRules.maxDailyLoss))
      : null,
    maxTradesPerDay: connection.user.riskRules?.maxTradesPerDay ?? null,
    stopAfterLosses: connection.user.riskRules?.stopAfterLosses ?? null,
    riskPerTrade: connection.user.riskRules?.riskPerTrade
      ? parseFloat(String(connection.user.riskRules.riskPerTrade))
      : null,
    // Live session + emotional state: coaching only
    currentState: isCoachingMode ? flags.currentState : "NONE",
    recentLossStreak: isCoachingMode ? flags.recentLossStreak : 0,
    manualSignals: isCoachingMode ? manualEventSignals : null,
    warningMessages: isCoachingMode ? violationFeed.warningViolations.map((v) => v.message) : [],
    isPreNewsWindow: isCoachingMode ? isInsidePreNewsWarningWindow(economicCalendarSnapshot) : false,
    preNewsMessage: isCoachingMode && economicCalendarPolicy.isActive
      ? (economicCalendarPolicy.message ?? null)
      : null,
    // Safety constraints: always pass through regardless of mode
    cooldownActive: flags.cooldownActive,
    guardianLocked: guardian.evaluation.lockoutActive,
    lockoutReason: guardian.evaluation.primaryReason,
    sessionStarted: todaySessionState.sessionStarted,
    sessionEnded: todaySessionState.sessionEnded,
    todaySessionStateKind: todaySessionState.kind,
    hasBlockingViolation: violationFeed.hasBlockingViolation,
    violationMessage: violationFeed.primaryViolation?.message ?? null,
    recentMessages,
    tradingWhy: connection.user.mentalProfile?.tradingWhy ?? null,
    tradingGoal: connection.user.mentalProfile?.tradingGoal ?? null,
    groundingReminder: connection.user.mentalProfile?.groundingReminder ?? null,
    preferredAddress: connection.user.mentalProfile?.preferredAddress ?? null,
    conversationMode,
  };

  const useAI = shouldUseAICoach({
    actionId: matchedAction?.id ?? null,
    isFreeText,
    guardianLocked: guardian.evaluation.lockoutActive,
    hasBlockingViolation: violationFeed.hasBlockingViolation,
    cooldownActive: flags.cooldownActive,
  });

  const aiReply = useAI ? await generateAICoachReply(aiInput) : null;

  // Fallback priority: quick-action locale reply → state-derived reply → session-state reply → generic
  const stateToActionId: Partial<Record<TraderCurrentState, string>> = {
    [TraderCurrentState.FOMO]: "fomo",
    [TraderCurrentState.REVENGE]: "revenge",
    [TraderCurrentState.JUST_TOOK_LOSS]: "just-lost",
    [TraderCurrentState.JUST_TOOK_TWO_LOSSES]: "lost-twice",
    [TraderCurrentState.TILTED]: "out-of-control",
    [TraderCurrentState.RESETTING]: "calming-down",
    [TraderCurrentState.CALM]: "back-in-control",
  };
  const stateActionId = stateUpdate?.nextState
    ? (stateToActionId[stateUpdate.nextState] ?? null)
    : null;

  const fallbackText =
    (matchedAction && getLocaleReplyForQuickAction(matchedAction.id, locale)) ??
    (stateActionId && getLocaleReplyForQuickAction(stateActionId, locale)) ??
    (todaySessionState.sessionEnded ? locale.prompts.review : null) ??
    (todaySessionState.sessionStarted ? locale.prompts.checkIn : locale.prompts.sessionNotStarted);

  const replyText = aiReply ?? fallbackText;

  const loggedTraderState = stateUpdate
    ? (activeTraderState?.currentState ?? TraderCurrentState.NONE)
    : TraderCurrentState.NONE;

  await logCoachEvent({
    userId: connection.user.id,
    source: "telegram",
    message: rawText || locale.keyboard.checkIn,
    detectedIntent: deriveLogIntent(matchedAction?.id ?? null, rawText),
    coachMode: useAI ? "AI_COACH" : "RULE_BASED",
    traderState: loggedTraderState,
    cooldownActive: flags.cooldownActive,
    metadataJson: {
      aiReplyGenerated: aiReply !== null,
      stateSnapshot: flags.currentState,
      guardianLockoutActive: guardian.evaluation.lockoutActive,
      guardianPrimaryReason: guardian.evaluation.primaryReason,
      guardianTriggeredRules: guardian.evaluation.triggeredRules,
      todaySessionState: todaySessionState.kind,
      sessionStarted: todaySessionState.sessionStarted,
      sessionEnded: todaySessionState.sessionEnded,
      ruleViolations: {
        hasBlockingViolation: violationFeed.hasBlockingViolation,
        primaryViolation: violationFeed.primaryViolation
          ? {
              ruleId: violationFeed.primaryViolation.ruleId,
              status: violationFeed.primaryViolation.status,
              severity: violationFeed.primaryViolation.severity,
              message: violationFeed.primaryViolation.message,
            }
          : null,
        activeCount: violationFeed.activeViolations.length,
        triggeredRules: violationFeed.triggeredViolations.map((v) => v.ruleId),
        blockedRules: violationFeed.blockedViolations.map((v) => v.ruleId),
        warningRules: violationFeed.warningViolations.map((v) => v.ruleId),
      },
    },
  });

  return replyToTelegram(chatId, replyText, locale);
}
