import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AuthCard } from "@/components/ui/auth-card";
import { AppShell } from "@/components/ui/app-shell";
import { getCurrentUser } from "@/lib/auth";

import { SignupForm } from "./_components/signup-form";

export const metadata: Metadata = {
  title: "Sign Up",
};

export default async function SignupPage() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/onboarding");
  }

  return (
    <AppShell
      eyebrow="Auth"
      title="Create your trading coach account."
      description="Start a real 7-day trial and tie your onboarding, dashboard, and Telegram access to one authenticated account."
    >
      <AuthCard
        title="Sign up"
        description="Use email and password to create your account and start the trial."
      >
        <SignupForm />
      </AuthCard>
    </AppShell>
  );
}
