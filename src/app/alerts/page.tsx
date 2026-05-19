import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Alerts — Guardrail",
};

export default async function AlertsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

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
        riskPerTrade: true,
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
        ? `Connected as @${telegramConnection?.telegramUsername ?? "unknown"}. Sends alerts for rule breaches (daily loss, max trades, loss streak) and behavioral patterns (revenge entry, rapid trading, size increase after a loss).`
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
      description: "Fires when your daily P&L crosses the configured loss limit.",
      active: riskRules?.maxDailyLoss != null,
      requires: "Daily loss limit",
    },
    {
      label: "Max trades reached",
      description: "Fires when you hit your maximum trades-per-day limit.",
      active: riskRules?.maxTradesPerDay != null,
      requires: "Max trades per day",
    },
    {
      label: "Consecutive losses",
      description: "Fires after the configured number of back-to-back losses.",
      active: riskRules?.stopAfterLosses != null,
      requires: "Stop after losses",
    },
    {
      label: "Outside trading hours",
      description: "Fires when a trade is placed outside your configured session window.",
      active: riskRules?.sessionStartHour != null && riskRules?.sessionEndHour != null,
      requires: "Session hours",
    },
    {
      label: "Unrealized drawdown",
      description: "Fires when an open position's unrealized P&L exceeds your per-trade risk limit.",
      active: riskRules?.riskPerTrade != null,
      requires: "Risk per trade",
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
    { label: "Approaching loss limit (80%)", description: "Early warning when P&L reaches 80% of your daily loss limit." },
    { label: "Pre-news window", description: "Alert before high-impact economic events." },
    { label: "News lockout", description: "Warns on trades placed around scheduled news releases." },
    { label: "Session start & end reminders", description: "Reminders when your trading session opens and closes." },
    { label: "In-app notification center", description: "A central feed to browse and revisit past alerts." },
  ];

  return (
    <AppShell
      eyebrow="Alerts"
      title="How will I be notified?"
      description="Where Guardrail sends alerts when rules trigger."
      actions={null}
    >
      <div className="grid gap-6">

        {/* Channel status */}
        <SectionCard title="Channels">
          <div className="grid gap-3 sm:grid-cols-3">
            {channels.map((ch) => (
              <div
                key={ch.label}
                className={`rounded-2xl border px-4 py-3 ${
                  ch.accent
                    ? "border-emerald-200 bg-emerald-50"
                    : ch.enabled
                      ? "border-stone-200 bg-white"
                      : "border-stone-200 bg-stone-50 opacity-70"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-stone-950">{ch.label}</p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${ch.badgeCls}`}>
                    {ch.status}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-stone-600">{ch.detail}</p>
                {ch.future && (
                  <p className="mt-1 text-xs italic text-stone-400">{ch.future}</p>
                )}
                {ch.action && (
                  <a
                    href={ch.action.href}
                    className="mt-2 inline-block text-xs font-medium text-stone-950 underline-offset-2 hover:underline"
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
              className="text-xs font-medium text-stone-500 underline-offset-2 transition hover:text-stone-950 hover:underline"
            >
              Set rules →
            </a>
          }
        >
          <div className="divide-y divide-stone-100">
            {ruleTriggers.map((t) => (
              <div key={t.label} className="flex items-center justify-between gap-4 py-2.5">
                <div>
                  <p className="text-sm font-medium text-stone-950">{t.label}</p>
                  <p className="text-xs text-stone-500">{t.description}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    t.active
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-stone-100 text-stone-500"
                  }`}
                >
                  {t.active ? "Active" : "Off"}
                </span>
              </div>
            ))}
          </div>
          {ruleTriggers.some((t) => !t.active) && (
            <div className="mt-4 space-y-1 border-t border-stone-100 pt-4">
              {ruleTriggers.filter((t) => !t.active).map((t) => (
                <p key={t.label} className="text-xs text-stone-500">
                  Set <span className="font-medium">{t.requires}</span> in{" "}
                  <a href="/rules" className="font-medium text-stone-700 underline-offset-2 hover:underline">Rules</a>{" "}
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
          <div className="divide-y divide-stone-100">
            {behavioralTriggers.map((t) => (
              <div key={t.label} className="flex items-center justify-between gap-4 py-2.5">
                <div>
                  <p className="text-sm font-medium text-stone-950">{t.label}</p>
                  <p className="text-xs text-stone-500">{t.description}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    telegramReady
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-stone-100 text-stone-500"
                  }`}
                >
                  {telegramReady ? "Active" : "Needs Telegram"}
                </span>
              </div>
            ))}
          </div>
          {!telegramReady && (
            <p className="mt-4 border-t border-stone-100 pt-4 text-xs text-stone-500">
              <a href="/settings" className="font-medium text-stone-700 underline-offset-2 hover:underline">Set up Telegram</a>{" "}
              to receive behavioral alerts.
            </p>
          )}
        </SectionCard>

        {/* Coming soon / Planned */}
        <SectionCard
          title="Coming soon / Planned"
          description="On the roadmap — not sending alerts yet."
        >
          <div className="divide-y divide-stone-100">
            {comingSoon.map((t) => (
              <div key={t.label} className="flex items-center justify-between gap-4 py-2.5">
                <div>
                  <p className="text-sm font-medium text-stone-500">{t.label}</p>
                  <p className="text-xs text-stone-400">{t.description}</p>
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
              <p className="text-sm font-semibold text-stone-950">Per-alert preferences</p>
              <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
                Planned
              </span>
            </div>
            <p className="mt-1.5 text-xs text-stone-600">
              Alert preferences are planned. Today, Guardrail sends core safety alerts based on your active rules.
            </p>
          </div>
        </SectionCard>

      </div>
    </AppShell>
  );
}
