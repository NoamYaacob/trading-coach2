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
        dailyProfitTarget: true,
        newsLockoutEnabled: true,
      },
    }),
  ]);

  const telegramReady = Boolean(telegramConnection?.telegramChatId);

  const channels = [
    {
      label: "In-app",
      status: "Available",
      statusCls: "text-emerald-700",
      badgeCls: "bg-emerald-100 text-emerald-800",
      detail: "Alert banners on the Dashboard and Guardian pages. Always active — no configuration needed.",
      enabled: true,
      accent: false,
      action: null as { href: string; label: string } | null,
    },
    {
      label: "Telegram",
      status: telegramReady ? "Connected" : "Not connected",
      statusCls: telegramReady ? "text-emerald-700" : "text-amber-700",
      badgeCls: telegramReady ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800",
      detail: telegramReady
        ? `Connected as @${telegramConnection?.telegramUsername ?? "unknown"}. Guardian lockout alerts and state-change notifications are active.`
        : "Connect Telegram to receive Guardian lockout alerts and state-change notifications.",
      enabled: telegramReady,
      accent: telegramReady,
      action: telegramReady ? null : { href: "/settings", label: "Set up in Settings" },
    },
    {
      label: "Email",
      status: "Coming soon",
      statusCls: "text-stone-400",
      badgeCls: "bg-stone-100 text-stone-500",
      detail: "Email alerts for lockout events and daily summaries. Not yet available.",
      enabled: false,
      accent: false,
      action: null as { href: string; label: string } | null,
    },
  ];

  const triggers = [
    {
      label: "Daily loss limit reached",
      description: "You get an alert when your daily P&L crosses the loss limit. The session is marked stopped.",
      active: riskRules?.maxDailyLoss != null,
      requires: "Daily loss limit",
    },
    {
      label: "Max trades reached",
      description: "You get an alert when you hit your maximum trades-per-day limit.",
      active: riskRules?.maxTradesPerDay != null,
      requires: "Max trades per day",
    },
    {
      label: "Consecutive losses",
      description: "You get an alert after the configured number of back-to-back losses.",
      active: riskRules?.stopAfterLosses != null,
      requires: "Stop after losses",
    },
    {
      label: "Daily profit target hit",
      description: "You get an alert when your session P&L reaches the configured profit target.",
      active: riskRules?.dailyProfitTarget != null,
      requires: "Daily profit target",
    },
    {
      label: "Approaching loss limit (80%)",
      description: "You get an early warning when P&L reaches 80% of the daily loss limit.",
      active: riskRules?.maxDailyLoss != null,
      requires: "Daily loss limit",
    },
    {
      label: "Pre-news window",
      description: "You get an alert before high-impact economic events based on your news policy.",
      active: riskRules?.newsLockoutEnabled ?? false,
      requires: "News lockout",
    },
  ];

  return (
    <AppShell
      eyebrow="Alerts"
      title="How will I be notified?"
      description="Where Guardrail sends alerts when rules trigger."
      actions={
        !telegramReady ? (
          <a
            href="/settings"
            className="inline-flex rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
          >
            Set up in Settings
          </a>
        ) : null
      }
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

        {/* Alert triggers — compact list, details collapsed */}
        <SectionCard
          title="Triggers"
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
            {triggers.map((t) => (
              <div key={t.label} className="flex items-center justify-between gap-4 py-2.5">
                <p className="text-sm font-medium text-stone-950">{t.label}</p>
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
          <details className="group mt-4 border-t border-stone-100 pt-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-stone-950">
              Details
              <span className="text-xs font-normal text-stone-400 transition-transform group-open:rotate-45">+</span>
            </summary>
            <div className="mt-4 grid gap-3">
              {triggers.map((t) => (
                <div key={t.label} className="rounded-xl border border-stone-100 bg-stone-50 px-4 py-3 text-sm">
                  <p className="font-medium text-stone-950">{t.label}</p>
                  <p className="mt-1 text-stone-600">{t.description}</p>
                  {!t.active && (
                    <p className="mt-1 text-xs text-stone-500">
                      Set <span className="font-medium">{t.requires}</span> in{" "}
                      <a href="/rules" className="font-medium text-stone-700 underline-offset-2 hover:underline">Rules</a> to enable.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </details>
        </SectionCard>

      </div>
    </AppShell>
  );
}
