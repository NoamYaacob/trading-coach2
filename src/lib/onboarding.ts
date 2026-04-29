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

/**
 * Returns the appropriate post-login redirect:
 *  - No TraderProfile → /onboarding/profile  (collect trading identity first)
 *  - Has TraderProfile but no RiskRules → /onboarding  (show setup checklist)
 *  - Otherwise → /dashboard
 */
export async function getOnboardingRedirect(userId: string): Promise<string> {
  const [profile, rules] = await Promise.all([
    prisma.traderProfile.findUnique({ where: { userId }, select: { id: true } }),
    prisma.riskRules.findUnique({ where: { userId }, select: { id: true } }),
  ]);
  if (!profile) return "/onboarding/profile";
  if (!rules) return "/onboarding";
  return "/dashboard";
}
