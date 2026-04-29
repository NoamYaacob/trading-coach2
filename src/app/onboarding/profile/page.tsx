import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LogoutButton } from "@/components/ui/logout-button";
import { TradingProfileForm } from "./_components/trading-profile-form";

export const metadata: Metadata = {
  title: "Trading profile — Guardrail",
};

export default async function TradingProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const editMode = params.edit === "1";

  const [traderProfile, mentalProfile] = await Promise.all([
    prisma.traderProfile.findUnique({
      where: { userId: user.id },
      select: {
        primaryMarket: true,
        tradingStyle: true,
        experienceYears: true,
        tradingSession: true,
      },
    }),
    prisma.mentalProfile.findUnique({
      where: { userId: user.id },
      select: { primaryChallenge: true },
    }),
  ]);

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

      <main className="mx-auto w-full max-w-xl px-4 py-10 sm:px-6 sm:py-16">
        <div className="mb-8">
          <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-amber-600">
            {editMode ? "Edit profile" : "Trading profile"}
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-stone-950">
            {editMode ? "Update your trading profile." : "Tell Guardrail how you trade."}
          </h1>
          <p className="mt-1.5 text-sm leading-6 text-stone-500">
            These details help Guardrail understand your market, session, and risk workflow.
          </p>
        </div>

        <TradingProfileForm
          initialMarket={traderProfile?.primaryMarket}
          initialStyle={traderProfile?.tradingStyle}
          initialExperienceYears={traderProfile?.experienceYears}
          initialSession={traderProfile?.tradingSession}
          initialChallenge={mentalProfile?.primaryChallenge}
          editMode={editMode}
        />
      </main>
    </div>
  );
}
