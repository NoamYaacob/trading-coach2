import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { getBrokerDisconnectWindow } from "@/lib/broker-disconnect-window";

import { getCurrentUser } from "@/lib/auth";

function normalizeDisplay(raw: string | null | undefined, canonical: readonly string[]): string | null {
  if (!raw) return null;
  const lc = raw.toLowerCase().trim();
  return (
    canonical.find((c) => c.toLowerCase() === lc) ??
    canonical.find((c) => c.toLowerCase() === lc.replace(/_/g, " ")) ??
    null
  );
}

const MARKETS = ["Futures", "Forex", "Stocks", "Crypto"] as const;
const STYLES = ["Scalping", "Intraday", "Swing", "Momentum"] as const;
const SESSIONS = ["NY Open", "London Open", "Morning", "Afternoon", "Full Day"] as const;

function humanizeExperience(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const years = parseInt(raw);
  if (isNaN(years)) return raw;
  if (years <= 1) return "Beginner";
  if (years <= 4) return "Intermediate";
  return "Advanced";
}
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { ProductStatusPanel } from "@/components/ui/product-status-panel";

import { DeleteAccount } from "./_components/delete-account";
import { SignInMethods } from "./_components/sign-in-methods";
import { DisconnectButton } from "@/app/accounts/_components/disconnect-button";

export const metadata: Metadata = {
  title: "Settings — Guardrail",
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ oauth_error?: string; google_connected?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;

  const [dbUser, telegramConnection, googleConnection, traderProfile, connectedAccounts] = await Promise.all([
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
    prisma.traderProfile.findUnique({
      where: { userId: user.id },
      select: {
        primaryMarket: true,
        tradingStyle: true,
        tradingSession: true,
        tradingExperience: true,
        timezone: true,
      },
    }),
    prisma.connectedAccount.findMany({
      where: { userId: user.id, isActive: true, protectionStatus: { not: "archived" } },
      select: {
        id: true,
        label: true,
        platform: true,
        connectionStatus: true,
        connectedAt: true,
        protectionStatus: true,
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const disconnectWindow = getBrokerDisconnectWindow();

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

        {/* Trading profile */}
        {traderProfile && (
          <details className="group rounded-[1.75rem] border border-stone-200 bg-white/90 p-6 shadow-[0_20px_60px_-40px_rgba(28,25,23,0.25)]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-xl font-semibold tracking-[-0.03em] text-stone-950">
              Trading profile
              <span className="text-xs font-normal text-stone-400 transition-transform group-open:rotate-45">+</span>
            </summary>
            <dl className="mt-5 grid gap-3 text-sm">
              {normalizeDisplay(traderProfile.primaryMarket, MARKETS) && (
                <div className="flex items-center justify-between rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
                  <dt className="font-medium text-stone-500">Market</dt>
                  <dd className="text-stone-950">{normalizeDisplay(traderProfile.primaryMarket, MARKETS)}</dd>
                </div>
              )}
              {normalizeDisplay(traderProfile.tradingStyle, STYLES) && (
                <div className="flex items-center justify-between rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
                  <dt className="font-medium text-stone-500">Style</dt>
                  <dd className="text-stone-950">{normalizeDisplay(traderProfile.tradingStyle, STYLES)}</dd>
                </div>
              )}
              {normalizeDisplay(traderProfile.tradingSession, SESSIONS) && (
                <div className="flex items-center justify-between rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
                  <dt className="font-medium text-stone-500">Session</dt>
                  <dd className="text-stone-950">{normalizeDisplay(traderProfile.tradingSession, SESSIONS)}</dd>
                </div>
              )}
              {humanizeExperience(traderProfile.tradingExperience) && (
                <div className="flex items-center justify-between rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
                  <dt className="font-medium text-stone-500">Experience</dt>
                  <dd className="text-stone-950">{humanizeExperience(traderProfile.tradingExperience)}</dd>
                </div>
              )}
            </dl>
            <div className="mt-4">
              <a
                href="/onboarding/profile?edit=1"
                className="inline-flex h-9 items-center justify-center rounded-full border border-stone-200 px-5 text-xs font-medium text-stone-700 transition hover:border-stone-400 hover:bg-stone-50"
              >
                Edit trading profile
              </a>
            </div>
          </details>
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
                {user.subscriptionStatus === "TRIALING"
                  ? "Trial active"
                  : user.subscriptionStatus.charAt(0).toUpperCase() + user.subscriptionStatus.slice(1).toLowerCase()}
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
                    Telegram alerts are not connected yet. Setup is not available in this demo build.
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

        {/* Broker connections */}
        {connectedAccounts.length > 0 && (
          <SectionCard
            title="Broker connections"
            description="Manage your connected broker accounts."
          >
            <div className="grid gap-3">
              {connectedAccounts.map((acct) => {
                const platformLabel =
                  acct.platform === "tradovate"
                    ? "Tradovate"
                    : acct.platform === "tradingview"
                      ? "TradingView"
                      : acct.platform === "manual"
                        ? "Manual"
                        : acct.platform;
                const statusLabel =
                  acct.connectionStatus === "connected_live"
                    ? "Live"
                    : acct.connectionStatus === "connected_readonly"
                      ? "Read-only"
                      : acct.connectionStatus === "pending_webhook"
                        ? "Pending sync"
                        : acct.connectionStatus === "expired"
                          ? "Expired"
                          : acct.connectionStatus === "connection_error"
                            ? "Connection error"
                            : "Not connected";
                const isConnected =
                  acct.connectionStatus === "connected_live" ||
                  acct.connectionStatus === "connected_readonly";
                return (
                  <div
                    key={acct.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-100 bg-stone-50 px-4 py-3"
                  >
                    <div className="text-sm">
                      <p className="font-medium text-stone-900">{acct.label}</p>
                      <p className="text-stone-500">
                        {platformLabel} · {statusLabel}
                        {isConnected && acct.connectedAt
                          ? ` · since ${acct.connectedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                          : ""}
                      </p>
                    </div>
                    <DisconnectButton
                      accountId={acct.id}
                      providerLabel={platformLabel}
                      redirectTo="/settings"
                      isBlocked={disconnectWindow.isBlocked}
                      windowStartMs={disconnectWindow.nextWindowStart.getTime()}
                      windowEndMs={disconnectWindow.nextWindowEnd.getTime()}
                      userTz={traderProfile?.timezone ?? null}
                    />
                  </div>
                );
              })}
            </div>
          </SectionCard>
        )}

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
