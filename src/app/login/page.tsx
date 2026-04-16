import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AuthCard } from "@/components/ui/auth-card";
import { AppShell } from "@/components/ui/app-shell";
import { getCurrentUser } from "@/lib/auth";

import { LoginForm } from "./_components/login-form";

export const metadata: Metadata = {
  title: "Login",
};

export default async function LoginPage() {
  const user = await getCurrentUser();

  if (user) {
    redirect("/onboarding");
  }

  return (
    <AppShell
      eyebrow="Auth"
      title="Log back into your coaching account."
      description="Resume onboarding, review your setup, and reconnect with the Telegram coach from the same account."
    >
      <AuthCard
        title="Log in"
        description="Enter your email and password to continue."
      >
        <LoginForm />
      </AuthCard>
    </AppShell>
  );
}
