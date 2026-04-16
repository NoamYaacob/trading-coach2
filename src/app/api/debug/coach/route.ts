import { NextResponse } from "next/server";
import { TraderCurrentState } from "@prisma/client";

import { deriveTraderStateUpdate, getCurrentTraderState, setCurrentTraderState } from "@/lib/trader-state";
import { buildCoachContext, generateCoachReply } from "@/lib/coach";
import { prisma } from "@/lib/db";
import {
  deriveTodaySessionState,
  getGuardianSnapshot,
  getTodayGuardianSessionStart,
} from "@/lib/guardian";
import { deriveManualEventSignals, getTodayManualEvents } from "@/lib/manual-trade-events";
import { getRecentSessionContext, logCoachEvent } from "@/lib/session-log";

type DebugCoachRequest = {
  email?: string;
  message?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as DebugCoachRequest;
  const email = body.email?.trim().toLowerCase();
  const message = body.message?.trim();

  if (!email || !message) {
    return NextResponse.json(
      { error: "email and message are required" },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      traderProfile: {
        select: {
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
      coachingPreferences: {
        select: {
          premarketCheckinEnabled: true,
          postmarketReviewEnabled: true,
          checkinFormat: true,
          reviewFocus: true,
          newsAlertsEnabled: true,
          preNewsMinutes: true,
          highImpactOnly: true,
        },
      },
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
  });

  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const stateUpdate = deriveTraderStateUpdate(message);
  const activeTraderState = stateUpdate
    ? (await setCurrentTraderState(user.id, stateUpdate.nextState, stateUpdate.extraData))
        .traderState
    : (await getCurrentTraderState(user.id)).traderState;
  const [sessionContext, guardian, todayGuardianSession, todayManualEvents] = await Promise.all([
    getRecentSessionContext(user.id),
    getGuardianSnapshot(user.id),
    getTodayGuardianSessionStart(user.id),
    getTodayManualEvents(user.id),
  ]);
  const todaySessionState = deriveTodaySessionState(guardian, {
    onboardingComplete: Boolean(user.traderProfile),
    sessionStart: todayGuardianSession,
  });

  const manualEventSignals = deriveManualEventSignals(todayManualEvents);
  const coachContext = buildCoachContext({
    traderProfile: user.traderProfile,
    riskRules: user.riskRules,
    mentalProfile: user.mentalProfile,
    coachingPreferences: user.coachingPreferences,
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

  const result = generateCoachReply(message, coachContext);
  const cooldownActive = Boolean(
    activeTraderState?.needsCooldown &&
      activeTraderState.cooldownUntil &&
      activeTraderState.cooldownUntil > new Date(),
  );
  const loggedTraderState = stateUpdate
    ? activeTraderState?.currentState ?? coachContext.currentState
    : TraderCurrentState.NONE;

  await logCoachEvent({
    userId: user.id,
    source: "debug",
    message,
    detectedIntent: result.intent,
    coachMode: result.mode,
    traderState: loggedTraderState,
    cooldownActive,
    metadataJson: {
      replyBehavior: result.behavior,
      stateSnapshot: activeTraderState?.currentState ?? coachContext.currentState,
      guardianLockoutActive: guardian.evaluation.lockoutActive,
      guardianPrimaryReason: guardian.evaluation.primaryReason,
      guardianTriggeredRules: guardian.evaluation.triggeredRules,
      todaySessionState: todaySessionState.kind,
      sessionStarted: todaySessionState.sessionStarted,
      sessionEnded: todaySessionState.sessionEnded,
    },
  });

  const updatedSessionContext = await getRecentSessionContext(user.id);

  return NextResponse.json({
    ok: true,
    email: user.email,
    intent: result.intent,
    mode: result.mode,
    currentTraderState: activeTraderState?.currentState ?? "NONE",
    cooldownActive,
    todaySessionSummary: updatedSessionContext.summary,
    recentSessionEvents: updatedSessionContext.recentEvents,
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
    sessionLifecycle: {
      todaySessionStateKind: todaySessionState.kind,
      sessionStarted: todaySessionState.sessionStarted,
      sessionStartedAt: todaySessionState.sessionStartedAt,
      sessionEnded: todaySessionState.sessionEnded,
      sessionEndedAt: todaySessionState.sessionEndedAt,
      resetTimezone: todaySessionState.resetTimezone,
    },
    reply: result.reply,
  });
}
