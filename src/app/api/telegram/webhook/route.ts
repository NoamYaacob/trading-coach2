import { NextResponse } from "next/server";
import { TraderCurrentState } from "@prisma/client";

import {
  isAICoachEnabled,
  EMOTIONAL_ACTION_IDS,
  STRUCTURED_COACHING_ACTION_IDS,
  detectConversationMode,
} from "@/lib/ai-coach";
import { generateCoachReply } from "@/lib/coach-brain";
import type { CoachBrainInput } from "@/lib/coach-brain";
import { filterActionableInterventions } from "@/lib/intervention-engine";
import type { InterventionEvent } from "@/lib/intervention-engine";
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
import type { GuardianSnapshot } from "@/lib/guardian";
import { deriveManualEventSignals, getTodayManualEvents } from "@/lib/manual-trade-events";
import {
  buildRuleEngineInputFromGuardianSnapshot,
  buildViolationFeed,
} from "@/lib/rule-engine";
import type { ManualEventSignals, ViolationFeed } from "@/lib/rule-engine";
import { getRecentCoachingExchanges, logCoachEvent } from "@/lib/session-log";
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
              coachingTone: true,
              interruptionStyle: true,
              responseStyle: true,
              primaryChallenge: true,
              tiltTrigger: true,
              tiltThought: true,
              tradingWhy: true,
              tradingGoal: true,
              groundingReminder: true,
              preferredAddress: true,
              disciplineBreakPattern: true,
              whatHelpsRefocus: true,
              reminderAnchors: true,
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

function deriveInterventionAlertContext(params: {
  violationFeed: ViolationFeed;
  currentState: string;
  guardian: GuardianSnapshot;
  manualSignals: ManualEventSignals;
  tradingGoal: string | null;
  wantsGoalReminders: boolean;
}): string | null {
  const events: InterventionEvent[] = [];

  for (const v of params.violationFeed.warningViolations) {
    if (v.ruleId === "max_daily_loss" && params.guardian.profile.maxDailyLoss) {
      const maxLoss = parseFloat(String(params.guardian.profile.maxDailyLoss));
      const todayPnL = params.guardian.evaluation.todayPnL;
      const used = Math.abs(Math.min(todayPnL, 0));
      const remaining = Math.max(0, maxLoss - used);
      const pctUsed = maxLoss > 0 ? used / maxLoss : 0;
      events.push({ type: "near_daily_loss_limit", pctUsed, remaining });
    } else if (v.ruleId === "stop_after_consecutive_losses" && params.guardian.profile.stopAfterConsecutiveLosses) {
      const streak = Math.max(
        params.guardian.evaluation.consecutiveLosses,
        params.manualSignals.consecutiveLosses,
      );
      events.push({
        type: "consecutive_losses_warning",
        streak,
        limit: params.guardian.profile.stopAfterConsecutiveLosses,
      });
    }
  }

  const state = params.currentState.toLowerCase();
  if (state.includes("revenge") || state.includes("tilt") || state.includes("out_of_control")) {
    events.push({ type: "revenge_trading_signal", traderState: params.currentState });
  }

  if (events.length === 0) return null;

  const results = filterActionableInterventions(events);
  if (results.length === 0) return null;

  const top = results[0];
  if (top.urgency === "low") return null;

  let context = top.coachingPrompt;
  if (params.wantsGoalReminders && params.tradingGoal && (top.urgency === "high" || top.urgency === "critical")) {
    context += ` (Their stated goal: "${params.tradingGoal}" — surface it only if it genuinely strengthens this.)`;
  }
  return context;
}

function deriveLogIntent(actionId: string | null, rawText: string): CoachIntent {
  if (actionId) {
    if (actionId === "check-in") return "check_in";
    if (actionId === "day-summary") return "day_summary";
    if (actionId === "rule-limits" || actionId === "remaining") return "rule_question";
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

  // /start without a token — not yet linked or just starting the bot fresh
  if (rawText === "/start") {
    const defaultLocale = getLocale();
    return replyToTelegram(chatId, defaultLocale.commands.welcome, defaultLocale);
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

  // Slash command shortcuts — resolve to canonical keyboard text so the rest
  // of the pipeline handles them identically to button taps.
  const SLASH_COMMAND_OVERRIDES: Record<string, string> = {
    "/checkin": locale.keyboard.checkIn,
    "/review": locale.keyboard.daySummary,
    "/limits": locale.keyboard.ruleLimits,
  };

  if (rawText === "/help") {
    return replyToTelegram(chatId, locale.commands.help, locale);
  }

  if (rawText === "/menu") {
    return replyToTelegram(chatId, locale.commands.welcome, locale);
  }

  // Unknown slash commands (not /start, /help, /menu, or our shortcuts)
  if (rawText.startsWith("/") && !SLASH_COMMAND_OVERRIDES[rawText]) {
    return replyToTelegram(chatId, locale.commands.unknownCommand, locale);
  }

  const effectiveText = SLASH_COMMAND_OVERRIDES[rawText] ?? rawText;

  const matchedAction = effectiveText ? findActionByLocaleText(effectiveText, locale) : null;
  const canonicalText = matchedAction?.message ?? effectiveText;

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

  const isFreeText = effectiveText.length > 0 && matchedAction === null && !effectiveText.startsWith("/");
  const [guardian, todayGuardianSession, economicCalendarSnapshot, todayManualEvents, recentCoachingExchanges] = await Promise.all([
    getGuardianSnapshot(connection.user.id),
    getTodayGuardianSessionStart(connection.user.id),
    getSelectedEconomicCalendarSnapshot(connection.user.coachingPreferences),
    getTodayManualEvents(connection.user.id),
    isAICoachEnabled() ? getRecentCoachingExchanges(connection.user.id, 3) : Promise.resolve([]),
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

  // rule-limits and remaining use meta mode (factual); check-in/day-summary use coaching mode via EMOTIONAL_ACTION_IDS
  const rawConversationMode = detectConversationMode({
    message: effectiveText,
    hasEmotionalAction: matchedAction !== null && EMOTIONAL_ACTION_IDS.has(matchedAction.id),
    guardianLocked: guardian.evaluation.lockoutActive,
  });
  const isMetaAction = matchedAction?.id === "rule-limits" || matchedAction?.id === "remaining";
  const conversationMode = isMetaAction ? "meta" : rawConversationMode;

  const isCoachingMode = conversationMode === "coaching";

  const wantsGoalReminders = connection.user.coachingPreferences?.wantsGoalReminders ?? true;
  const wantsToughInterventionWhenTilting = connection.user.coachingPreferences?.wantsToughInterventionWhenTilting ?? true;

  // Build intervention alert context only for free-text coaching messages.
  // Button presses already carry clear intent — stacking English context on top
  // risks language leakage and creates duplicate/contradictory signals.
  const interventionAlertContext = isCoachingMode && isFreeText
    ? deriveInterventionAlertContext({
        violationFeed,
        currentState: String(flags.currentState),
        guardian,
        manualSignals: manualEventSignals,
        tradingGoal: connection.user.mentalProfile?.tradingGoal ?? null,
        wantsGoalReminders,
      })
    : null;

  const useAI =
    isAICoachEnabled() &&
    (isFreeText ||
      (matchedAction !== null &&
        (EMOTIONAL_ACTION_IDS.has(matchedAction.id) ||
          STRUCTURED_COACHING_ACTION_IDS.has(matchedAction.id))) ||
      guardian.evaluation.lockoutActive ||
      violationFeed.hasBlockingViolation ||
      flags.cooldownActive);

  const coachBrainInput: CoachBrainInput = {
    userId: connection.user.id,
    message: effectiveText || (matchedAction ? canonicalText : "") || locale.keyboard.checkIn,
    language: connection.user.coachingPreferences?.preferredLanguage ?? "he",
    actionId: matchedAction?.id ?? null,
    traderState: isCoachingMode ? String(flags.currentState) : "NONE",
    rules: {
      accountSize: connection.user.riskRules?.accountSize
        ? parseFloat(String(connection.user.riskRules.accountSize))
        : null,
      maxDailyLoss: connection.user.riskRules?.maxDailyLoss
        ? parseFloat(String(connection.user.riskRules.maxDailyLoss))
        : null,
      maxTradesPerDay: connection.user.riskRules?.maxTradesPerDay ?? null,
      stopAfterLosses: connection.user.riskRules?.stopAfterLosses ?? null,
    },
    usage: {
      todayPnL: guardian.evaluation.todayPnL,
      todayTradesCount: guardian.evaluation.todayTradesCount,
      consecutiveLosses: Math.max(
        guardian.evaluation.consecutiveLosses,
        manualEventSignals.consecutiveLosses,
      ),
    },
    coachingTone: connection.user.mentalProfile?.coachingTone ?? null,
    preferredAddress: connection.user.mentalProfile?.preferredAddress ?? null,
    reminderAnchors: connection.user.mentalProfile?.reminderAnchors ?? [],
    recentContext: recentCoachingExchanges.slice(-2).map((e) => ({
      userMessage: e.userMessage,
      coachReply: e.coachReply,
    })),
    guardianLocked: guardian.evaluation.lockoutActive,
    lockoutReason: guardian.evaluation.primaryReason,
    cooldownActive: flags.cooldownActive,
    hasBlockingViolation: violationFeed.hasBlockingViolation,
    violationMessage: violationFeed.primaryViolation?.message ?? null,
    sessionStarted: todaySessionState.sessionStarted,
    sessionEnded: todaySessionState.sessionEnded,
    alertContext: interventionAlertContext,
  };

  const brainOutput = useAI ? await generateCoachReply(coachBrainInput) : null;
  const aiReply = brainOutput?.reply ?? null;
  const coachingMove = brainOutput?.coachingMove;

  // Fallback priority: quick-action locale reply → state-derived reply → session-state reply → generic
  const stateToActionId: Partial<Record<TraderCurrentState, string>> = {
    [TraderCurrentState.FOMO]: "fomo",
    [TraderCurrentState.REVENGE]: "revenge",
    [TraderCurrentState.JUST_TOOK_LOSS]: "angry",
    [TraderCurrentState.JUST_TOOK_TWO_LOSSES]: "out-of-control",
    [TraderCurrentState.TILTED]: "out-of-control",
    [TraderCurrentState.RESETTING]: "stop-me",
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
    message: effectiveText || locale.keyboard.checkIn,
    detectedIntent: deriveLogIntent(matchedAction?.id ?? null, effectiveText),
    coachMode: useAI ? "AI_COACH" : "RULE_BASED",
    traderState: loggedTraderState,
    cooldownActive: flags.cooldownActive,
    coachReply: replyText,
    coachingMove,
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
