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
      title="Manage your account."
      description="Update sign-in, connected services, and account settings."
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
        <SectionCard title="Account">
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
              <dd className="text-stone-950">
                {user.subscriptionStatus === "TRIALING" ? "Trial active" : user.subscriptionStatus.toLowerCase()}
              </dd>
            </div>
          </dl>
        </SectionCard>

        {/* Security: sign-in methods */}
        <SectionCard
          title="Security"
          description="How you sign in to Guardrail."
        >
          <SignInMethods
            hasPassword={hasPassword}
            googleConnected={googleConnected}
            googleEmail={googleConnection?.email ?? null}
          />
        </SectionCard>

        {/* Connections: Telegram */}
        <SectionCard
          title="Connections"
          description="Optional services connected to your account."
        >
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-stone-500">Telegram</p>
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
          </div>
          <details className="group mt-4 rounded-xl border border-stone-100 bg-stone-50/50 px-4 py-3">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-stone-950">
              Product status
              <span className="text-xs font-normal text-stone-400 transition-transform group-open:rotate-45">+</span>
            </summary>
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-stone-500">Product status</p>
              <ProductStatusPanel variant="compact" />
            </div>
          </details>
        </SectionCard>

        {/* Danger zone */}
        <section className="rounded-[1.75rem] border border-red-200 bg-white/90 p-6 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.35)]">
          <h2 className="text-xl font-semibold tracking-[-0.03em] text-red-900">Danger zone</h2>
          <p className="mt-2 text-sm leading-6 text-stone-600">Irreversible actions that affect your entire account.</p>
          <div className="mt-5 rounded-xl border border-red-100 bg-red-50/50 p-5">
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
