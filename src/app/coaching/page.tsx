import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";

import { CoachingProfileForm } from "./_components/coaching-profile-form";

export const metadata: Metadata = {
  title: "Telegram Bot — Guardrail",
};

export default async function CoachingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [mentalProfile, coachingPrefs] = await Promise.all([
    prisma.mentalProfile.findUnique({ where: { userId: user.id } }),
    prisma.coachingPreferences.findUnique({ where: { userId: user.id } }),
  ]);

  const initial = {
    tradingWhy: mentalProfile?.tradingWhy ?? "",
    tradingGoal: mentalProfile?.tradingGoal ?? "",
    groundingReminder: mentalProfile?.groundingReminder ?? "",
    primaryChallenge: mentalProfile?.primaryChallenge ?? "",
    tiltTrigger: mentalProfile?.tiltTrigger ?? "",
    disciplineBreakPattern: mentalProfile?.disciplineBreakPattern ?? "",
    whatHelpsRefocus: mentalProfile?.whatHelpsRefocus ?? "",
    reminderAnchors: mentalProfile?.reminderAnchors ?? [],
    coachingTone: coachingPrefs?.coachingTone ?? "",
    wantsMidSessionCheckIns: coachingPrefs?.wantsMidSessionCheckIns ?? false,
    wantsGoalReminders: coachingPrefs?.wantsGoalReminders ?? true,
    wantsToughInterventionWhenTilting: coachingPrefs?.wantsToughInterventionWhenTilting ?? true,
    premarketCheckinEnabled: coachingPrefs?.premarketCheckinEnabled ?? false,
    postmarketReviewEnabled: coachingPrefs?.postmarketReviewEnabled ?? false,
  };

  return (
    <AppShell
      eyebrow="Alerts · Telegram bot"
      title="Telegram bot profile."
      description="Optional. Customize how the Telegram bot communicates with you. These settings shape bot messaging only — they have no effect on Guardian rule enforcement or risk state."
    >
      <SectionCard
        title="Bot profile"
        description="The bot uses this to personalize alert tone and context. Guardian enforces your rules regardless of what is set here."
      >
        <CoachingProfileForm initial={initial} />
      </SectionCard>
    </AppShell>
  );
}
