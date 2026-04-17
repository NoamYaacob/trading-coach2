import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

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
    tiltTriggers: mentalProfile.tiltTrigger ? [mentalProfile.tiltTrigger] : [],
    confidenceNotes: mentalProfile.tiltThought,
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
