import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { ProductStatusPanel } from "@/components/ui/product-status-panel";

import { DeleteAccount } from "./_components/delete-account";
import { SignInMethods } from "./_components/sign-in-methods";

export const metadata: Metadata = {
  title: "Settings — Guardrail",
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ oauth_error?: string; google_connected?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;

  const [dbUser, telegramConnection, googleConnection] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    }),
    prisma.telegramConnection.findUnique({
      where: { userId: user.id },
      select: { telegramUsername: true, connectedAt: true },
    }),
    prisma.oAuthConnection.findFirst({
      where: { userId: user.id, provider: "google" },
      select: { email: true },
    }),
  ]);

  const hasPassword = Boolean(dbUser?.passwordHash);
  const googleConnected = Boolean(googleConnection);

  return (
    <AppShell
      eyebrow="Settings"
      title="Account settings"
      description="Manage your account, security, and connected services."
    >
      <div className="grid gap-6">
        {/* OAuth error / success banners */}
        {params.oauth_error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {params.oauth_error === "google_already_linked_to_another_account"
              ? "This Google account is already linked to a different Guardrail account."
              : params.oauth_error === "google_not_configured"
                ? "Google sign-in is not configured yet."
                : "Something went wrong connecting Google. Please try again."}
          </div>
        )}
        {params.google_connected === "1" && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Google account connected successfully.
          </div>
        )}

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

        {/* Sign-in methods */}
        <SectionCard
          title="Sign-in methods"
          description="Choose how you sign in to Guardrail."
        >
          <SignInMethods
            hasPassword={hasPassword}
            googleConnected={googleConnected}
            googleEmail={googleConnection?.email ?? null}
          />
        </SectionCard>

        {/* Product status (compact) */}
        <SectionCard
          title="Product status"
          description="What's available, prepared, and pending API access. Full details on the Accounts page."
        >
          <ProductStatusPanel variant="compact" />
        </SectionCard>

        {/* Telegram */}
        <SectionCard
          title="Telegram alerts"
          description="Optional. Receive Guardian state and lockout messages in Telegram."
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
                  Connect from the{" "}
                  <a href="/alerts" className="font-medium text-stone-950 underline underline-offset-2 hover:text-stone-700">
                    Alerts
                  </a>{" "}
                  page.
                </p>
              </div>
            </div>
          )}
        </SectionCard>

        {/* Danger zone */}
        <section className="rounded-[1.75rem] border border-red-200 bg-white/90 p-6 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.35)]">
          <div className="mb-5 flex items-start gap-3">
            <div className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-red-100 flex items-center justify-center">
              <span className="h-2 w-2 rounded-full bg-red-500" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-red-900">Danger zone</h2>
              <p className="mt-2 text-sm leading-6 text-stone-600">Irreversible actions that affect your entire account.</p>
            </div>
          </div>
          <div className="rounded-xl border border-red-100 bg-red-50/50 p-5">
            <h3 className="text-sm font-semibold text-red-900">Delete account</h3>
            <div className="mt-3">
              <DeleteAccount />
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
