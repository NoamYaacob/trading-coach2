import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { getCurrentUser } from "@/lib/auth";

import { OnboardingForm } from "./_components/onboarding-form";

export const metadata: Metadata = {
  title: "Onboarding",
};

export default async function OnboardingPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <AppShell
      eyebrow="Onboarding"
      title="Set up the coaching profile."
      description="Complete the core trading, risk, and mindset setup so the platform can create the first coaching profile and prepare Telegram connection."
    >
      <div className="mx-auto w-full max-w-3xl">
        <OnboardingForm userEmail={user.email} />
      </div>
    </AppShell>
  );
}
