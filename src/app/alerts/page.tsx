import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { GrShell, type GrNavItem } from "@/components/ui/gr-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Alerts — Guardrail",
};

const ALERTS_NAV: GrNavItem[] = [
  { id: "home",     label: "Dashboard",    icon: "home",     href: "/dashboard" },
  { id: "rules",    label: "Trading Plan", icon: "shield",   href: "/rules" },
  { id: "accounts", label: "Accounts",     icon: "user",     href: "/accounts" },
  { id: "alerts",   label: "Alerts",       icon: "bell",     href: "/alerts",   active: true },
  { id: "settings", label: "Settings",     icon: "settings", href: "/settings" },
];

export default async function AlertsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const userInitials = user.email
    ? user.email.slice(0, 2).toUpperCase()
    : "??";

  const [telegramConnection, riskRules] = await Promise.all([
    prisma.telegramConnection.findUnique({
      where: { userId: user.id },
      select: { telegramUsername: true, telegramChatId: true },
    }),
    prisma.riskRules.findUnique({
      where: { userId: user.id },
      select: {
        maxDailyLoss: true,
        maxTradesPerDay: true,
        stopAfterLosses: true,
        sessionStartHour: true,
        sessionEndHour: true,
      },
    }),
  ]);

  const telegramReady = Boolean(telegramConnection?.telegramChatId);

  const channels = [
    {
      label: "In-app",
      status: "Available",
      badgeCls: "bg-emerald-100 text-emerald-800",
      detail: "Alert banners on the Dashboard and Guardian pages. Always active — no configuration needed.",
      future: null as string | null,
      enabled: true,
      accent: false,
      action: null as { href: string; label: string } | null,
    },
    {
      label: "Telegram",
      status: telegramReady ? "Connected" : "Not connected",
      badgeCls: telegramReady ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-500",
      detail: telegramReady
        ? `Connected as @${telegramConnection?.telegramUsername ?? "unknown"}. Sends alerts for rule breaches (daily loss, loss streak) and behavioral patterns (revenge entry, rapid trading, size increase after a loss).`
        : "Telegram alerts are not connected yet. Once connected, Guardrail sends rule-breach and behavioral alerts straight to your chat.",
      future: "Planned: per-alert preferences and a daily digest summary.",
      enabled: telegramReady,
      accent: telegramReady,
      action: telegramReady ? null : ({ href: "/settings", label: "Set up Telegram" } as { href: string; label: string }),
    },
    {
      label: "Email",
      status: "Coming soon",
      badgeCls: "bg-amber-100 text-amber-800",
      detail: "Email alerts for lockout events and daily summaries. Not yet available.",
      future: null as string | null,
      enabled: false,
      accent: false,
      action: null as { href: string; label: string } | null,
    },
  ];

  const ruleTriggers = [
    {
      label: "Daily loss limit reached",
      description:
        "An in-app notice when your daily P&L hits the loss limit, plus a Telegram early warning at 80% of the limit.",
      active: riskRules?.maxDailyLoss != null,
      requires: "Daily loss limit",
    },
    {
      label: "Max trades exceeded",
      description: "An in-app notice when you exceed your maximum trades-per-day limit (the next trade after your allowance triggers the lock).",
      active: riskRules?.maxTradesPerDay != null,
      requires: "Max trades per day",
    },
    {
      label: "Consecutive losses",
      description:
        "An in-app notice at your loss-streak limit, plus a Telegram warning one loss before it.",
      active: riskRules?.stopAfterLosses != null,
      requires: "Stop after losses",
    },
    {
      label: "Outside trading hours",
      description: "An in-app notice when the market is closed or your session window has ended.",
      active: riskRules?.sessionStartHour != null && riskRules?.sessionEndHour != null,
      requires: "Session hours",
    },
  ];

  const behavioralTriggers = [
    {
      label: "Revenge entry",
      description: "Fires when you re-enter a position within 2 minutes of a loss.",
    },
    {
      label: "Rapid trading",
      description: "Fires when 3 or more trades are placed within a 5-minute window.",
    },
    {
      label: "Size increase after loss",
      description: "Fires when a position is more than 25% larger than your previous losing trade.",
    },
  ];

  const comingSoon = [
    { label: "Daily profit target hit", description: "Alert when session P&L reaches your profit target." },
    { label: "Unrealized drawdown", description: "Alert when an open position's unrealized loss exceeds your per-trade risk limit." },
    { label: "Pre-news window", description: "Alert before high-impact economic events." },
    { label: "News lockout", description: "Warns on trades placed around scheduled news releases." },
    { label: "Session start & end reminders", description: "Reminders when your trading session opens and closes." },
    { label: "In-app notification center", description: "A central feed to browse and revisit past alerts." },
  ];

  return (
    <GrShell
      breadcrumb={["Alerts"]}
      sidebarContent={null}
      sidebarLabel="Alerts"
      navItems={ALERTS_NAV}
      userInitials={userInitials}
      hideApiStatus
    >
      <div style={{ overflowY: "auto", height: "100%" }}>
        {/* ── Page heading ──────────────────────────────────────── */}
        <section style={{ padding: "28px 36px 20px" }}>
          <span style={{ fontSize: 11.5, fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--gr-text-mute)" }}>
            Alerts
          </span>
          <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.2, color: "var(--gr-ink)", margin: "6px 0 6px" }}>
            How will I be notified?
          </h1>
          <p style={{ fontSize: 14, color: "var(--gr-text-mid)", margin: 0 }}>
            Where Guardrail sends alerts when rules trigger.
          </p>
        </section>

        {/* ── Content ───────────────────────────────────────────── */}
        <section style={{ padding: "0 36px 36px" }}>
          <div className="grid gap-6">

            {/* Channel status */}
            <SectionCard title="Channels">
              <div className="grid gap-3 sm:grid-cols-3">
                {channels.map((ch) => (
                  <div
                    key={ch.label}
                    className={`rounded-2xl border px-4 py-3 ${!ch.enabled ? "opacity-70" : ""}`}
                    style={{
                      borderColor: ch.accent ? undefined : "var(--gr-border)",
                      background: ch.accent ? undefined : ch.enabled ? "var(--gr-surface)" : "var(--gr-bg-elev)",
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold" style={{ color: "var(--gr-ink)" }}>{ch.label}</p>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${ch.badgeCls}`}>
                        {ch.status}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs" style={{ color: "var(--gr-text-mid)" }}>{ch.detail}</p>
                    {ch.future && (
                      <p className="mt-1 text-xs italic" style={{ color: "var(--gr-text-mute)" }}>{ch.future}</p>
                    )}
                    {ch.action && (
                      <a
                        href={ch.action.href}
                        className="mt-2 inline-block text-xs font-medium underline-offset-2 hover:underline"
                        style={{ color: "var(--gr-ink)" }}
                      >
                        {ch.action.label} →
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* Active today — rule-based triggers */}
            <SectionCard
              title="Rule-based alerts — active today"
              description="Active when the matching rule is configured."
              actions={
                <a
                  href="/rules"
                  className="text-xs font-medium underline-offset-2 transition hover:underline"
                  style={{ color: "var(--gr-text-mute)" }}
                >
                  Set rules →
                </a>
              }
            >
              <div className="divide-y" style={{ borderColor: "var(--gr-border-sub)" }}>
                {ruleTriggers.map((t) => (
                  <div key={t.label} className="flex items-center justify-between gap-4 py-2.5">
                    <div>
                      <p className="text-sm font-medium" style={{ color: "var(--gr-ink)" }}>{t.label}</p>
                      <p className="text-xs" style={{ color: "var(--gr-text-mute)" }}>{t.description}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        t.active ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-500"
                      }`}
                    >
                      {t.active ? "Active" : "Off"}
                    </span>
                  </div>
                ))}
              </div>
              {ruleTriggers.some((t) => !t.active) && (
                <div className="mt-4 space-y-1 border-t pt-4" style={{ borderColor: "var(--gr-border-sub)" }}>
                  {ruleTriggers.filter((t) => !t.active).map((t) => (
                    <p key={t.label} className="text-xs" style={{ color: "var(--gr-text-mute)" }}>
                      Set <span className="font-medium">{t.requires}</span> in{" "}
                      <a href="/rules" className="font-medium underline-offset-2 hover:underline" style={{ color: "var(--gr-text-mid)" }}>Rules</a>{" "}
                      to enable <span className="font-medium">{t.label}</span>.
                    </p>
                  ))}
                </div>
              )}
            </SectionCard>

            {/* Active today — behavioral triggers */}
            <SectionCard
              title="Behavioral alerts — active today"
              description="Always active when Telegram is connected — no rule configuration needed."
            >
              <div className="divide-y" style={{ borderColor: "var(--gr-border-sub)" }}>
                {behavioralTriggers.map((t) => (
                  <div key={t.label} className="flex items-center justify-between gap-4 py-2.5">
                    <div>
                      <p className="text-sm font-medium" style={{ color: "var(--gr-ink)" }}>{t.label}</p>
                      <p className="text-xs" style={{ color: "var(--gr-text-mute)" }}>{t.description}</p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        telegramReady ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-500"
                      }`}
                    >
                      {telegramReady ? "Active" : "Needs Telegram"}
                    </span>
                  </div>
                ))}
              </div>
              {!telegramReady && (
                <p className="mt-4 border-t pt-4 text-xs" style={{ borderColor: "var(--gr-border-sub)", color: "var(--gr-text-mute)" }}>
                  <a href="/settings" className="font-medium underline-offset-2 hover:underline" style={{ color: "var(--gr-text-mid)" }}>Set up Telegram</a>{" "}
                  to receive behavioral alerts.
                </p>
              )}
            </SectionCard>

            {/* Coming soon / Planned */}
            <SectionCard
              title="Coming soon / Planned"
              description="On the roadmap — not sending alerts yet."
            >
              <div className="divide-y" style={{ borderColor: "var(--gr-border-sub)" }}>
                {comingSoon.map((t) => (
                  <div key={t.label} className="flex items-center justify-between gap-4 py-2.5">
                    <div>
                      <p className="text-sm font-medium" style={{ color: "var(--gr-text-mute)" }}>{t.label}</p>
                      <p className="text-xs" style={{ color: "var(--gr-text-faint)" }}>{t.description}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                      Planned
                    </span>
                  </div>
                ))}
              </div>
            </SectionCard>

            {/* Alert preferences — roadmap card, not functional toggles */}
            <SectionCard title="Alert preferences">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold" style={{ color: "var(--gr-ink)" }}>Per-alert preferences</p>
                  <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                    Planned
                  </span>
                </div>
                <p className="mt-1.5 text-xs" style={{ color: "var(--gr-text-mid)" }}>
                  Alert preferences are planned. Today, Guardrail sends core safety alerts based on your active rules.
                </p>
              </div>
            </SectionCard>

          </div>
        </section>
      </div>
    </GrShell>
  );
}
