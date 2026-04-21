import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type CoachingProfileBody = {
  // MentalProfile fields
  tradingWhy?: string;
  tradingGoal?: string;
  groundingReminder?: string;
  primaryChallenge?: string;
  tiltTrigger?: string;
  disciplineBreakPattern?: string;
  whatHelpsRefocus?: string;
  reminderAnchors?: string[];
  // CoachingPreferences fields
  coachingTone?: string;
  wantsMidSessionCheckIns?: boolean;
  wantsGoalReminders?: boolean;
  wantsToughInterventionWhenTilting?: boolean;
  premarketCheckinEnabled?: boolean;
  postmarketReviewEnabled?: boolean;
};

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as CoachingProfileBody;

  const [mentalProfile, coachingPrefs] = await Promise.all([
    prisma.mentalProfile.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        tradingWhy: body.tradingWhy ?? null,
        tradingGoal: body.tradingGoal ?? null,
        groundingReminder: body.groundingReminder ?? null,
        primaryChallenge: body.primaryChallenge ?? null,
        tiltTrigger: body.tiltTrigger ?? null,
        disciplineBreakPattern: body.disciplineBreakPattern ?? null,
        whatHelpsRefocus: body.whatHelpsRefocus ?? null,
        reminderAnchors: body.reminderAnchors ?? [],
      },
      update: {
        tradingWhy: body.tradingWhy ?? null,
        tradingGoal: body.tradingGoal ?? null,
        groundingReminder: body.groundingReminder ?? null,
        primaryChallenge: body.primaryChallenge ?? null,
        tiltTrigger: body.tiltTrigger ?? null,
        disciplineBreakPattern: body.disciplineBreakPattern ?? null,
        whatHelpsRefocus: body.whatHelpsRefocus ?? null,
        reminderAnchors: body.reminderAnchors ?? [],
      },
    }),
    prisma.coachingPreferences.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        coachingTone: body.coachingTone ?? null,
        wantsMidSessionCheckIns: body.wantsMidSessionCheckIns ?? false,
        wantsGoalReminders: body.wantsGoalReminders ?? true,
        wantsToughInterventionWhenTilting: body.wantsToughInterventionWhenTilting ?? true,
        premarketCheckinEnabled: body.premarketCheckinEnabled ?? false,
        postmarketReviewEnabled: body.postmarketReviewEnabled ?? false,
      },
      update: {
        coachingTone: body.coachingTone ?? null,
        wantsMidSessionCheckIns: body.wantsMidSessionCheckIns ?? false,
        wantsGoalReminders: body.wantsGoalReminders ?? true,
        wantsToughInterventionWhenTilting: body.wantsToughInterventionWhenTilting ?? true,
        premarketCheckinEnabled: body.premarketCheckinEnabled ?? false,
        postmarketReviewEnabled: body.postmarketReviewEnabled ?? false,
      },
    }),
  ]);

  return NextResponse.json({ mentalProfile, coachingPrefs });
}
