import type { Metadata } from "next";

import { AuthLayout } from "@/components/ui/auth-layout";

import { ResetPasswordForm } from "./_components/reset-password-form";

export const metadata: Metadata = {
  title: "Set a new password — Guardrail",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <AuthLayout>
        <div>
          <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.04em] text-stone-950">
            Invalid reset link.
          </h1>
          <p className="mt-2.5 text-sm leading-6 text-stone-500">
            This password reset link is invalid or has expired. Request a new one from the login page.
          </p>
          <p className="mt-6 text-center text-sm text-stone-500">
            <a
              href="/forgot-password"
              className="font-medium text-stone-950 underline-offset-2 hover:underline"
            >
              Request a new link
            </a>
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <ResetPasswordForm token={token} />
    </AuthLayout>
  );
}
