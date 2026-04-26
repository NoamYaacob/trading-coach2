import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LogoutButton } from "@/components/ui/logout-button";

import { OnboardingForm } from "./_components/onboarding-form";
import type { SavedOnboardingData } from "./_components/onboarding-form";

export const metadata: Metadata = {
  title: "Set up your profile — Guardrail",
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
          preferredAddress: mentalProfile.preferredAddress,
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
    <div className="min-h-screen bg-stone-50">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-stone-200 bg-white px-4 sm:px-6">
        <Link
          href="/"
          className="text-[10px] font-bold uppercase tracking-[0.38em] text-stone-900 transition-opacity hover:opacity-70"
        >
          Guardrail
        </Link>
        <LogoutButton />
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-amber-600">
            Getting started
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-stone-950">
            Set up your risk profile and trading rules
          </h1>
          <p className="mt-1.5 text-sm leading-6 text-stone-500">
            Define the rules you want held — max daily loss, max trades, consecutive-loss stop, session hours — and the enforcement style you prefer when a rule is breached. About 3 minutes.
          </p>
        </div>

        <OnboardingForm userEmail={user.email} savedData={savedData} />
      </main>
    </div>
  );
}
