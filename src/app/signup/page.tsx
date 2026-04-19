import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AuthLayout } from "@/components/ui/auth-layout";
import { getCurrentUser } from "@/lib/auth";
import { SignupForm } from "./_components/signup-form";

export const metadata: Metadata = {
  title: "Sign up — Guardrail",
};

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ oauth_error?: string }> }) {
  const user = await getCurrentUser();
  if (user) redirect("/onboarding");

  const params = await searchParams;

  return (
    <AuthLayout>
      <SignupForm oauthError={params.oauth_error} />
    </AuthLayout>
  );
}
