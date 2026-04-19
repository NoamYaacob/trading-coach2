import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AuthLayout } from "@/components/ui/auth-layout";
import { getCurrentUser } from "@/lib/auth";
import { LoginForm } from "./_components/login-form";

export const metadata: Metadata = {
  title: "Log in — Guardrail",
};

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect("/onboarding");

  return (
    <AuthLayout>
      <LoginForm />
    </AuthLayout>
  );
}
