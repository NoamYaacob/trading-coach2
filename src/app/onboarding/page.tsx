import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

import { OnboardingForm } from "./_components/onboarding-form";
import type { SavedOnboardingData } from "./_components/onboarding-form";

export const metadata: Metadata = {
  title: "Onboarding",
};

export default async function OnboardingPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const [traderProfile, riskRules, mentalProfile, coachingPreferences] = await Promise.all([
    prisma.traderProfile.findUnique({ where: { userId: user.id } }),
    prisma.riskRules.findUnique({ where: { userId: user.id } }),
    prisma.mentalProfile.findUnique({ where: { userId: user.id } }),
    prisma.coachingPreferences.findUnique({ where: { userId: user.id } }),
  ]);

  const savedData: SavedOnboardingData = {
    traderProfile: traderProfile
      ? {
          primaryMarket: traderProfile.primaryMarket,
          tradingStyle: traderProfile.tradingStyle,
          experienceYears: traderProfile.experienceYears,
          tradingDays: traderProfile.tradingDays,
          tradingSession: traderProfile.tradingSession,
          timezone: traderProfile.timezone,
        }
      : null,
    riskRules: riskRules
      ? {
          accountSize: riskRules.accountSize?.toString() ?? null,
          maxDailyLoss: riskRules.maxDailyLoss?.toString() ?? null,
          riskPerTrade: riskRules.riskPerTrade?.toString() ?? null,
          maxTradesPerDay: riskRules.maxTradesPerDay,
          stopAfterLosses: riskRules.stopAfterLosses,
        }
      : null,
    mentalProfile: mentalProfile
      ? {
          primaryChallenge: mentalProfile.primaryChallenge,
          tiltTrigger: mentalProfile.tiltTrigger,
          tiltThought: mentalProfile.tiltThought,
          coachingTone: mentalProfile.coachingTone,
          interruptionStyle: mentalProfile.interruptionStyle,
          responseStyle: mentalProfile.responseStyle,
          tradingWhy: mentalProfile.tradingWhy,
          tradingGoal: mentalProfile.tradingGoal,
          groundingReminder: mentalProfile.groundingReminder,
        }
      : null,
    coachingPreferences: coachingPreferences
      ? {
          premarketCheckinEnabled: coachingPreferences.premarketCheckinEnabled,
          postmarketReviewEnabled: coachingPreferences.postmarketReviewEnabled,
          checkinFormat: coachingPreferences.checkinFormat,
          reviewFocus: coachingPreferences.reviewFocus,
          newsAlertsEnabled: coachingPreferences.newsAlertsEnabled,
          preNewsMinutes: coachingPreferences.preNewsMinutes,
          highImpactOnly: coachingPreferences.highImpactOnly,
          economicCalendarProviderKey: coachingPreferences.economicCalendarProviderKey,
          economicCalendarStubScenario: coachingPreferences.economicCalendarStubScenario,
          preferredLanguage: coachingPreferences.preferredLanguage,
        }
      : null,
  };

  return (
    <AppShell
      eyebrow="Onboarding"
      title="Set up the coaching profile."
      description="Complete the core trading, risk, and mindset setup so the platform can create the first coaching profile and prepare Telegram connection."
    >
      <div className="mx-auto w-full max-w-3xl">
        <OnboardingForm userEmail={user.email} savedData={savedData} />
      </div>
    </AppShell>
  );
}
