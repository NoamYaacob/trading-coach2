import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";

import { PasswordForm } from "./_components/password-form";
import { DeleteAccount } from "./_components/delete-account";

export const metadata: Metadata = {
  title: "Settings — Guardrail",
};

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [dbUser, telegramConnection] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    }),
    prisma.telegramConnection.findUnique({
      where: { userId: user.id },
      select: { telegramUsername: true, connectedAt: true },
    }),
  ]);

  const hasPassword = Boolean(dbUser?.passwordHash);

  return (
    <AppShell
      eyebrow="Settings"
      title="Account settings"
      description="Manage your account, security, and connected services."
    >
      <div className="grid gap-6">
        {/* Account info */}
        <SectionCard title="Account" description="Basic information about your account.">
          <dl className="grid gap-3 text-sm">
            <div className="flex items-center justify-between rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
              <dt className="font-medium text-stone-500">Email</dt>
              <dd className="text-stone-950">{user.email}</dd>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
              <dt className="font-medium text-stone-500">Member since</dt>
              <dd className="text-stone-950">
                {user.createdAt.toLocaleDateString("en-US", {
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
              </dd>
            </div>
            <div className="flex items-center justify-between rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
              <dt className="font-medium text-stone-500">Plan</dt>
              <dd className="capitalize text-stone-950">
                {user.subscriptionStatus.toLowerCase()}
              </dd>
            </div>
          </dl>
        </SectionCard>

        {/* Password */}
        {hasPassword && (
          <SectionCard
            title="Password"
            description="Update the password you use to sign in."
          >
            <PasswordForm />
          </SectionCard>
        )}

        {/* Telegram */}
        <SectionCard
          title="Telegram"
          description="Guardrail sends coaching messages and trade alerts via Telegram."
        >
          {telegramConnection ? (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3">
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
              <div className="text-sm">
                <p className="font-medium text-emerald-900">Connected</p>
                {telegramConnection.telegramUsername && (
                  <p className="text-emerald-700">@{telegramConnection.telegramUsername}</p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
              <span className="h-2 w-2 shrink-0 rounded-full bg-stone-300" />
              <div className="text-sm">
                <p className="font-medium text-stone-700">Not connected</p>
                <p className="text-stone-500">
                  Go to{" "}
                  <a href="/onboarding" className="underline underline-offset-2 hover:text-stone-700">
                    onboarding
                  </a>{" "}
                  to connect Telegram.
                </p>
              </div>
            </div>
          )}
        </SectionCard>

        {/* Danger zone */}
        <SectionCard
          title="Danger zone"
          description="Irreversible actions that affect your entire account."
        >
          <div className="rounded-xl border border-red-100 bg-red-50/50 p-5">
            <h3 className="text-sm font-semibold text-red-900">Delete account</h3>
            <div className="mt-3">
              <DeleteAccount />
            </div>
          </div>
        </SectionCard>
      </div>
    </AppShell>
  );
}
