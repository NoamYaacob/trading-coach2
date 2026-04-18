import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getLocale } from "@/lib/i18n";
import { getTelegramQuickActionKeyboard } from "@/lib/coach-actions";
import { sendTelegramMessage } from "@/lib/telegram";

type OnboardingRequest = {
  traderProfile?: {
    primaryMarket?: string;
    tradingStyle?: string;
    experienceYears?: number;
    tradingDays?: string;
    tradingSession?: string;
    timezone?: string;
  };
  riskRules?: {
    accountSize?: number;
    maxDailyLoss?: number;
    riskPerTrade?: number;
    maxTradesPerDay?: number;
    stopAfterLosses?: number;
  };
  mentalProfile?: {
    primaryChallenge?: string;
    tiltTrigger?: string;
    tiltThought?: string;
    coachingTone?: string;
    interruptionStyle?: string;
    responseStyle?: string;
    preferredAddress?: string;
    tradingWhy?: string;
    tradingGoal?: string;
    groundingReminder?: string;
  };
  coachingPreferences?: {
    premarketCheckinEnabled?: boolean;
    postmarketReviewEnabled?: boolean;
    checkinFormat?: string;
    reviewFocus?: string;
    newsAlertsEnabled?: boolean;
    preNewsMinutes?: number;
    highImpactOnly?: boolean;
    economicCalendarProviderKey?: string;
    economicCalendarStubScenario?: string;
    preferredLanguage?: string;
  };
};

function toDecimalInput(value: number | undefined) {
  return value === undefined ? undefined : value.toString();
}

function normalizeTraderProfile(
  traderProfile: OnboardingRequest["traderProfile"],
) {
  if (!traderProfile) {
    return undefined;
  }

  return {
    primaryMarket: traderProfile.primaryMarket,
    tradingStyle: traderProfile.tradingStyle,
    experienceYears: traderProfile.experienceYears,
    tradingDays: traderProfile.tradingDays,
    tradingSession: traderProfile.tradingSession,
    preferredSession: traderProfile.tradingSession,
    timezone: traderProfile.timezone,
    tradingExperience:
      traderProfile.experienceYears === undefined
        ? undefined
        : `${traderProfile.experienceYears} years`,
  };
}

function normalizeRiskRules(riskRules: OnboardingRequest["riskRules"]) {
  if (!riskRules) {
    return undefined;
  }

  return {
    accountSize: toDecimalInput(riskRules.accountSize),
    maxDailyLoss: toDecimalInput(riskRules.maxDailyLoss),
    riskPerTrade: toDecimalInput(riskRules.riskPerTrade),
    maxRiskPerTrade: toDecimalInput(riskRules.riskPerTrade),
    maxTradesPerDay: riskRules.maxTradesPerDay,
    stopAfterLosses: riskRules.stopAfterLosses,
  };
}

function normalizeMentalProfile(
  mentalProfile: OnboardingRequest["mentalProfile"],
) {
  if (!mentalProfile) {
    return undefined;
  }

  return {
    primaryChallenge: mentalProfile.primaryChallenge,
    tiltTrigger: mentalProfile.tiltTrigger,
    tiltThought: mentalProfile.tiltThought,
    coachingTone: mentalProfile.coachingTone,
    interruptionStyle: mentalProfile.interruptionStyle,
    responseStyle: mentalProfile.responseStyle,
    preferredAddress: mentalProfile.preferredAddress,
    tiltTriggers: mentalProfile.tiltTrigger ? [mentalProfile.tiltTrigger] : [],
    confidenceNotes: mentalProfile.tiltThought,
    tradingWhy: mentalProfile.tradingWhy,
    tradingGoal: mentalProfile.tradingGoal,
    groundingReminder: mentalProfile.groundingReminder,
  };
}

function normalizeCoachingPreferences(
  coachingPreferences: OnboardingRequest["coachingPreferences"],
) {
  if (!coachingPreferences) {
    return undefined;
  }

  return {
    premarketCheckinEnabled: coachingPreferences.premarketCheckinEnabled ?? false,
    postmarketReviewEnabled: coachingPreferences.postmarketReviewEnabled ?? false,
    checkinFormat: coachingPreferences.checkinFormat,
    reviewFocus: coachingPreferences.reviewFocus,
    newsAlertsEnabled: coachingPreferences.newsAlertsEnabled ?? false,
    preNewsMinutes: coachingPreferences.preNewsMinutes,
    highImpactOnly: coachingPreferences.highImpactOnly ?? false,
    economicCalendarProviderKey: coachingPreferences.economicCalendarProviderKey,
    economicCalendarStubScenario: coachingPreferences.economicCalendarStubScenario,
    preferredLanguage: coachingPreferences.preferredLanguage,
    checkInFrequency:
      coachingPreferences.premarketCheckinEnabled ||
      coachingPreferences.postmarketReviewEnabled
        ? "enabled"
        : "disabled",
    remindersEnabled:
      (coachingPreferences.premarketCheckinEnabled ?? false) ||
      (coachingPreferences.newsAlertsEnabled ?? false),
    reflectionStyle: coachingPreferences.reviewFocus,
  };
}

async function refreshTelegramKeyboard(userId: string, language: string) {
  const connection = await prisma.telegramConnection.findUnique({
    where: { userId },
    select: { telegramChatId: true },
  });
  if (!connection?.telegramChatId) return;
  const locale = getLocale(language);
  await sendTelegramMessage(connection.telegramChatId, locale.system.languageUpdated, {
    replyMarkup: {
      keyboard: getTelegramQuickActionKeyboard(locale),
      resize_keyboard: true,
      input_field_placeholder: locale.system.inputPlaceholder,
    },
  });
}

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as OnboardingRequest;
  const traderProfile = normalizeTraderProfile(body.traderProfile);
  const riskRules = normalizeRiskRules(body.riskRules);
  const mentalProfile = normalizeMentalProfile(body.mentalProfile);
  const coachingPreferences = normalizeCoachingPreferences(
    body.coachingPreferences,
  );

  const newLanguage = body.coachingPreferences?.preferredLanguage;
  const existingPrefs = newLanguage
    ? await prisma.coachingPreferences.findUnique({
        where: { userId: currentUser.id },
        select: { preferredLanguage: true },
      })
    : null;
  const languageChanged = Boolean(
    newLanguage && newLanguage !== existingPrefs?.preferredLanguage,
  );

  try {
    await Promise.all([
      traderProfile
        ? prisma.traderProfile.upsert({
            where: { userId: currentUser.id },
            create: { userId: currentUser.id, ...traderProfile },
            update: traderProfile,
          })
        : null,
      riskRules
        ? prisma.riskRules.upsert({
            where: { userId: currentUser.id },
            create: { userId: currentUser.id, ...riskRules },
            update: riskRules,
          })
        : null,
      mentalProfile
        ? prisma.mentalProfile.upsert({
            where: { userId: currentUser.id },
            create: { userId: currentUser.id, ...mentalProfile },
            update: mentalProfile,
          })
        : null,
      coachingPreferences
        ? prisma.coachingPreferences.upsert({
            where: { userId: currentUser.id },
            create: { userId: currentUser.id, ...coachingPreferences },
            update: coachingPreferences,
          })
        : null,
    ]);
  } catch (err) {
    console.error("[onboarding] save error:", err);
    return NextResponse.json(
      { error: "Failed to save onboarding data." },
      { status: 500 },
    );
  }

  if (languageChanged && newLanguage) {
    refreshTelegramKeyboard(currentUser.id, newLanguage).catch(() => {});
  }

  const user = await prisma.user.findUnique({
    where: { id: currentUser.id },
    select: {
      id: true,
      email: true,
      subscriptionStatus: true,
      trialStartedAt: true,
      trialEndsAt: true,
    },
  });

  return NextResponse.json({
    ok: true,
    user,
  });
}
