import { redirect } from "next/navigation";
import Link from "next/link";
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
import { GrShell, type GrNavItem } from "@/components/ui/gr-shell";
import { SectionCard } from "@/components/ui/section-card";
import { ProductStatusPanel } from "@/components/ui/product-status-panel";

import { DeleteAccount } from "./_components/delete-account";
import { SignInMethods } from "./_components/sign-in-methods";
import { BrokerConnectionsSection } from "./_components/broker-connections-section";
import { TelegramConnection } from "./_components/telegram-connection";

export const metadata: Metadata = {
  title: "Settings — Guardrail",
};

const SETTINGS_NAV: GrNavItem[] = [
  { id: "home",     label: "Dashboard",    icon: "home",     href: "/dashboard" },
  { id: "rules",    label: "Trading Plan", icon: "shield",   href: "/rules" },
  { id: "trades",   label: "Trades",       icon: "chart",    href: "/trades" },
  { id: "alerts",   label: "Alerts",       icon: "bell",     href: "/alerts" },
  { id: "settings", label: "Settings",     icon: "settings", href: "/settings", active: true },
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ oauth_error?: string; google_connected?: string; tradovate_reconnected?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;

  const userInitials = user.email
    ? user.email.slice(0, 2).toUpperCase()
    : "??";

  const [dbUser, telegramConnection, googleConnection, traderProfile, connectedAccounts, brokerConnections] = await Promise.all([
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
        missingFromBrokerSince: true,
        lastSyncAt: true,
        brokerConnectionId: true,
        brokerConnection: {
          select: {
            id: true,
            env: true,
            connectionStatus: true,
            permissionLevel: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.brokerConnection.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        platform: true,
        env: true,
        connectionStatus: true,
        permissionLevel: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const disconnectWindow = getBrokerDisconnectWindow();

  const hasPassword = Boolean(dbUser?.passwordHash);
  const googleConnected = Boolean(googleConnection);

  // ── Sidebar: compact account list (same style as dashboard) ──────────────
  const SidebarAccountList = connectedAccounts.length > 0 ? (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {connectedAccounts.slice(0, 5).map((acc) => {
        const dot = acc.connectionStatus === "connection_error"
          ? "var(--gr-bad)"
          : acc.connectionStatus?.startsWith("connected")
            ? "var(--gr-ok)"
            : "var(--gr-text-faint)";
        return (
          <div key={acc.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flexShrink: 0 }} />
            <span style={{ fontSize: 12.5, color: "var(--gr-ink)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {acc.label}
            </span>
          </div>
        );
      })}
    </div>
  ) : (
    <Link
      href="/accounts/connect/tradovate"
      style={{ fontSize: 12.5, color: "var(--gr-copper)", textDecoration: "none" }}
    >
      Connect first account →
    </Link>
  );

  return (
    <GrShell
      breadcrumb={["Settings"]}
      sidebarContent={SidebarAccountList}
      sidebarLabel="Accounts"
      navItems={SETTINGS_NAV}
      userInitials={userInitials}
      hideApiStatus
    >
      <div style={{ overflowY: "auto", height: "100%" }}>
        {/* ── Page heading ──────────────────────────────────────── */}
        <section style={{ padding: "28px 36px 20px" }}>
          <span style={{ fontSize: 11.5, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--gr-text-mute)" }}>
            Settings
          </span>
          <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.2, color: "var(--gr-ink)", margin: "6px 0 6px" }}>
            Manage your account.
          </h1>
          <p style={{ fontSize: 14, color: "var(--gr-text-mid)", margin: 0 }}>
            Update sign-in, connected services, and account settings.
          </p>
        </section>

        {/* ── Content ───────────────────────────────────────────── */}
        <section style={{ padding: "0 36px 36px" }}>
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
            {params.tradovate_reconnected === "1" && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                Tradovate reconnected. Live sync will resume shortly.
              </div>
            )}

            {/* Trading profile */}
            {traderProfile && (
              <details
                className="group rounded-[14px] border p-6"
                style={{ borderColor: "var(--gr-border)", background: "var(--gr-surface)" }}
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-xl font-semibold tracking-[-0.03em]" style={{ color: "var(--gr-ink)" }}>
                  Trading profile
                  <span className="text-xs font-normal transition-transform group-open:rotate-45" style={{ color: "var(--gr-text-mute)" }}>+</span>
                </summary>
                <dl className="mt-5 grid gap-3 text-sm">
                  {normalizeDisplay(traderProfile.primaryMarket, MARKETS) && (
                    <div className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: "var(--gr-border-sub)", background: "var(--gr-bg-elev)" }}>
                      <dt className="font-medium" style={{ color: "var(--gr-text-mute)" }}>Market</dt>
                      <dd style={{ color: "var(--gr-ink)" }}>{normalizeDisplay(traderProfile.primaryMarket, MARKETS)}</dd>
                    </div>
                  )}
                  {normalizeDisplay(traderProfile.tradingStyle, STYLES) && (
                    <div className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: "var(--gr-border-sub)", background: "var(--gr-bg-elev)" }}>
                      <dt className="font-medium" style={{ color: "var(--gr-text-mute)" }}>Style</dt>
                      <dd style={{ color: "var(--gr-ink)" }}>{normalizeDisplay(traderProfile.tradingStyle, STYLES)}</dd>
                    </div>
                  )}
                  {normalizeDisplay(traderProfile.tradingSession, SESSIONS) && (
                    <div className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: "var(--gr-border-sub)", background: "var(--gr-bg-elev)" }}>
                      <dt className="font-medium" style={{ color: "var(--gr-text-mute)" }}>Session</dt>
                      <dd style={{ color: "var(--gr-ink)" }}>{normalizeDisplay(traderProfile.tradingSession, SESSIONS)}</dd>
                    </div>
                  )}
                  {humanizeExperience(traderProfile.tradingExperience) && (
                    <div className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: "var(--gr-border-sub)", background: "var(--gr-bg-elev)" }}>
                      <dt className="font-medium" style={{ color: "var(--gr-text-mute)" }}>Experience</dt>
                      <dd style={{ color: "var(--gr-ink)" }}>{humanizeExperience(traderProfile.tradingExperience)}</dd>
                    </div>
                  )}
                </dl>
                <div className="mt-4">
                  <a
                    href="/onboarding/profile?edit=1"
                    className="inline-flex h-9 items-center justify-center rounded-full border px-5 text-xs font-medium transition hover:opacity-80"
                    style={{ borderColor: "var(--gr-border)", color: "var(--gr-text-mid)" }}
                  >
                    Edit trading profile
                  </a>
                </div>
              </details>
            )}

            {/* Account info */}
            <SectionCard title="Account">
              <dl className="grid gap-3 text-sm">
                <div className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: "var(--gr-border-sub)", background: "var(--gr-bg-elev)" }}>
                  <dt className="font-medium" style={{ color: "var(--gr-text-mute)" }}>Email</dt>
                  <dd style={{ color: "var(--gr-ink)" }}>{user.email}</dd>
                </div>
                <div className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: "var(--gr-border-sub)", background: "var(--gr-bg-elev)" }}>
                  <dt className="font-medium" style={{ color: "var(--gr-text-mute)" }}>Member since</dt>
                  <dd style={{ color: "var(--gr-ink)" }}>
                    {user.createdAt.toLocaleDateString("en-US", {
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </dd>
                </div>
                <div className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ borderColor: "var(--gr-border-sub)", background: "var(--gr-bg-elev)" }}>
                  <dt className="font-medium" style={{ color: "var(--gr-text-mute)" }}>Plan</dt>
                  <dd style={{ color: "var(--gr-ink)" }}>
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
                <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em]" style={{ color: "var(--gr-text-mute)" }}>Telegram</p>
                <TelegramConnection
                  connected={Boolean(telegramConnection)}
                  username={telegramConnection?.telegramUsername ?? null}
                  botConfigured={!!(process.env.TELEGRAM_BOT_USERNAME ?? process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME)}
                />
              </div>
              <details className="group mt-4 rounded-xl border px-4 py-3" style={{ borderColor: "var(--gr-border-sub)", background: "var(--gr-bg-elev)" }}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold" style={{ color: "var(--gr-ink)" }}>
                  Product status
                  <span className="text-xs font-normal transition-transform group-open:rotate-45" style={{ color: "var(--gr-text-mute)" }}>+</span>
                </summary>
                <div className="mt-4">
                  <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em]" style={{ color: "var(--gr-text-mute)" }}>Product status</p>
                  <ProductStatusPanel variant="compact" />
                </div>
              </details>
            </SectionCard>

            {/* Broker connections — grouped by status */}
            <SectionCard
              title="Broker connections"
              description="Connect, disconnect, and reconnect your broker accounts."
            >
              <BrokerConnectionsSection
                accounts={connectedAccounts}
                brokerConnections={brokerConnections}
                disconnectWindow={disconnectWindow}
                userTz={traderProfile?.timezone ?? null}
              />

              {/* Add / connect action — always visible at the bottom */}
              <div className="mt-5 flex items-center gap-3">
                <Link
                  href="/accounts/connect/tradovate"
                  className="inline-flex h-9 items-center rounded-full px-5 text-sm font-medium text-white transition hover:opacity-90"
                  style={{ background: "var(--gr-ink)" }}
                >
                  Connect Tradovate
                </Link>
                <Link
                  href="/dashboard"
                  className="text-sm underline-offset-2 hover:underline"
                  style={{ color: "var(--gr-text-mute)" }}
                >
                  Manage accounts on Dashboard
                </Link>
              </div>
            </SectionCard>

            {/* Danger zone */}
            <section className="rounded-[14px] border border-red-200 p-6" style={{ background: "var(--gr-surface)" }}>
              <h2 className="text-xl font-semibold tracking-[-0.03em] text-red-900">Danger zone</h2>
              <p className="mt-2 text-sm leading-6" style={{ color: "var(--gr-text-mid)" }}>Irreversible actions that affect your entire account.</p>
              <div className="mt-5 rounded-xl border border-red-100 bg-red-50/50 p-5">
                <h3 className="text-sm font-semibold text-red-900">Delete account</h3>
                <div className="mt-3">
                  <DeleteAccount />
                </div>
              </div>
            </section>
          </div>
        </section>
      </div>
    </GrShell>
  );
}
