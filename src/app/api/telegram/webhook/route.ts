import { NextResponse } from "next/server";
import { TraderCurrentState } from "@prisma/client";

import { buildCoachContext, generateCoachReply } from "@/lib/coach";
import { getTelegramQuickActionKeyboard } from "@/lib/coach-actions";
import { prisma } from "@/lib/db";
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
  getNextHighImpactEconomicEvent,
  isInsidePreNewsWarningWindow,
} from "@/lib/economic-calendar";
import {
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

async function replyToTelegram(chatId: string, text: string) {
  await sendTelegramMessage(chatId, text, {
    replyMarkup: {
      keyboard: getTelegramQuickActionKeyboard(),
      resize_keyboard: true,
      input_field_placeholder: "בחר פעולה מהירה או כתוב הודעה...",
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
        },
      },
    },
  });

  if (!linkToken || linkToken.usedAt || linkToken.expiresAt < new Date()) {
    await sendTelegramMessage(
      params.telegramChatId,
      "This link is invalid or expired. Please create a fresh Telegram connection link from your website dashboard.",
      {
        replyMarkup: {
          keyboard: getTelegramQuickActionKeyboard(),
          resize_keyboard: true,
          input_field_placeholder: "בחר פעולה מהירה או כתוב הודעה...",
        },
      },
    );

    return NextResponse.json({ ok: false }, { status: 400 });
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

  if (!linkToken.user.traderProfile) {
    return replyToTelegram(
      params.telegramChatId,
      "Telegram connected successfully. Complete onboarding on the website before using the coach.",
    );
  }

  if (!access.accessActive) {
    return replyToTelegram(
      params.telegramChatId,
      "Telegram connected successfully, but access is inactive. You need an active trial or plan to use the coach.",
    );
  }

  return replyToTelegram(
    params.telegramChatId,
    "Telegram connected successfully. Bot coaching access is active.",
  );
}

export async function POST(request: Request) {
  const payload = (await request.json()) as TelegramWebhookPayload;
  const rawText = payload.message?.text?.trim() ?? "";
  const token = payload.startToken ?? rawText.replace("/start ", "").trim();
  const telegramUserId = payload.message?.from?.id;
  const telegramChatId = payload.message?.chat?.id;

  if (!telegramUserId || !telegramChatId) {
    return NextResponse.json(
      { ok: false, error: "telegram identifiers are required" },
      { status: 400 },
    );
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
    return replyToTelegram(
      chatId,
      "This Telegram account is not linked yet. Please connect Telegram from your website dashboard first.",
    );
  }

  const access = evaluateTelegramAccess({
    subscriptionStatus: connection.user.subscriptionStatus,
    trialEndsAt: connection.user.trialEndsAt,
    onboardingComplete: Boolean(connection.user.traderProfile),
    telegramConnected: true,
  });

  if (!connection.user.traderProfile) {
    return replyToTelegram(
      chatId,
      "Your Telegram account is connected, but onboarding is incomplete. Please complete onboarding on the website first.",
    );
  }

  if (!access.accessActive) {
    return replyToTelegram(
      chatId,
      "Your coaching access is inactive. Please start an active trial or plan on the website to continue.",
    );
  }

  await prisma.telegramConnection.update({
    where: { id: connection.id },
    data: {
      telegramUsername: payload.message?.from?.username,
      telegramChatId: chatId,
      lastWebhookAt: new Date(),
    },
  });

  const stateUpdate = rawText ? deriveTraderStateUpdate(rawText) : null;

  const activeTraderState = stateUpdate
    ? (
        await setCurrentTraderState(
          connection.user.id,
          stateUpdate.nextState,
          stateUpdate.extraData,
        )
      ).traderState
    : (await getCurrentTraderState(connection.user.id)).traderState;
  const [sessionContext, guardian, todayGuardianSession, economicCalendarSnapshot, todayManualEvents] = await Promise.all([
    getRecentSessionContext(connection.user.id),
    getGuardianSnapshot(connection.user.id),
    getTodayGuardianSessionStart(connection.user.id),
    getSelectedEconomicCalendarSnapshot(connection.user.coachingPreferences),
    getTodayManualEvents(connection.user.id),
  ]);
  const todaySessionState = deriveTodaySessionState(guardian, {
    onboardingComplete: Boolean(connection.user.traderProfile),
    sessionStart: todayGuardianSession,
  });

  const nextHighImpactEconomicEvent = getNextHighImpactEconomicEvent(
    economicCalendarSnapshot,
  );
  const economicCalendarPolicy = getCurrentPreNewsPolicy(economicCalendarSnapshot);
  const manualEventSignals = deriveManualEventSignals(todayManualEvents);
  const coachContext = buildCoachContext({
    traderProfile: connection.user.traderProfile,
    riskRules: connection.user.riskRules,
    mentalProfile: connection.user.mentalProfile,
    coachingPreferences: connection.user.coachingPreferences,
    traderState: activeTraderState,
    todaySessionSummary: sessionContext.summary,
    recentSessionEvents: sessionContext.recentEvents.map((event) => ({
      message: event.message,
      detectedIntent: event.detectedIntent,
      traderState: event.traderState,
      createdAt: event.createdAt,
    })),
    guardian: {
      guardianEnabled: guardian.evaluation.guardianActive,
      currentLockoutActive: guardian.evaluation.lockoutActive,
      primaryReason: guardian.evaluation.primaryReason,
      primaryReasonLabel: guardian.evaluation.primaryReasonLabel,
      triggeredRules: guardian.evaluation.triggeredRules,
      triggeredRuleLabels: guardian.evaluation.triggeredRuleLabels,
      actionGuidance: guardian.evaluation.actionGuidance,
      resetMode: guardian.evaluation.resetMode,
      resetTimezone: guardian.evaluation.resetTimezone,
      nextAllowedResetAt: guardian.evaluation.nextAllowedResetAt,
      lastResetAt: guardian.evaluation.lastResetAt,
      resetAllowedNow: guardian.evaluation.resetAllowedNow,
    },
    economicCalendar: {
      nextHighImpactEvent: nextHighImpactEconomicEvent,
      hasUpcomingHighImpactEvent: Boolean(nextHighImpactEconomicEvent),
      isInsidePreNewsWarningWindow: isInsidePreNewsWarningWindow(
        economicCalendarSnapshot,
      ),
      preNewsPolicy: economicCalendarPolicy,
    },
    sessionLifecycle: {
      todaySessionStateKind: todaySessionState.kind,
      sessionStarted: todaySessionState.sessionStarted,
      sessionStartedAt: todaySessionState.sessionStartedAt,
      sessionEnded: todaySessionState.sessionEnded,
      sessionEndedAt: todaySessionState.sessionEndedAt,
      resetTimezone: todaySessionState.resetTimezone,
    },
    manualActivity: manualEventSignals,
  });

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

  const coachReply = generateCoachReply(rawText || "check in", coachContext);
  const cooldownActive = Boolean(
    activeTraderState?.needsCooldown &&
      activeTraderState.cooldownUntil &&
      activeTraderState.cooldownUntil > new Date(),
  );
  const loggedTraderState = stateUpdate
    ? activeTraderState?.currentState ?? coachContext.currentState
    : TraderCurrentState.NONE;

  await logCoachEvent({
    userId: connection.user.id,
    source: "telegram",
    message: rawText || "check in",
    detectedIntent: coachReply.intent,
    coachMode: coachReply.mode,
    traderState: loggedTraderState,
    cooldownActive,
    metadataJson: {
      replyBehavior: coachReply.behavior,
      stateSnapshot: activeTraderState?.currentState ?? coachContext.currentState,
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

  await sendTelegramMessage(chatId, coachReply.reply, {
    replyMarkup: {
      keyboard: getTelegramQuickActionKeyboard(),
      resize_keyboard: true,
      input_field_placeholder: "בחר פעולה מהירה או כתוב הודעה...",
    },
  });

  return NextResponse.json({ ok: true });
}
