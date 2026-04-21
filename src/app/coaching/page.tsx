import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";

import { CoachingProfileForm } from "./_components/coaching-profile-form";

export const metadata: Metadata = {
  title: "Coaching — Guardrail",
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
      eyebrow="Coaching"
      title="Coaching profile"
      description="Tell the coach about yourself. The more honest you are, the more useful it gets."
    >
      <SectionCard
        title="Your coaching profile"
        description="Used by the Telegram coach to personalize responses and interventions."
      >
        <CoachingProfileForm initial={initial} />
      </SectionCard>
    </AppShell>
  );
}
