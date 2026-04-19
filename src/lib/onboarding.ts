import { prisma } from "@/lib/db";

/**
 * A user has completed onboarding when they have saved a TraderProfile.
 * The onboarding wizard saves all profile records together in one shot on the
 * final step, so the presence of TraderProfile is a reliable completion signal.
 */
export async function hasCompletedOnboarding(userId: string): Promise<boolean> {
  const profile = await prisma.traderProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  return profile !== null;
}
