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

  const [alertPrefs, telegramConnection] = await Promise.all([
    prisma.alertPreferences.findUnique({ where: { userId: user.id } }),
    prisma.telegramConnection.findUnique({
      where: { userId: user.id },
      select: { telegramUsername: true, telegramChatId: true },
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
    },
    {
      label: "Telegram",
      status: telegramReady ? "Connected" : "Not connected",
      statusCls: telegramReady ? "text-emerald-700" : "text-amber-700",
      badgeCls: telegramReady ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800",
      detail: telegramReady
        ? `Connected as @${telegramConnection?.telegramUsername ?? "unknown"}. Guardian events, lockout messages, and Telegram coaching are active.`
        : "Connect Telegram to receive Guardian alerts and lockout notifications directly in Telegram.",
      enabled: telegramReady,
      action: telegramReady ? null : { href: "/onboarding", label: "Connect Telegram" },
    },
    {
      label: "Email",
      status: "Coming soon",
      statusCls: "text-stone-400",
      badgeCls: "bg-stone-100 text-stone-500",
      detail: "Email alerts for lockout events and daily summaries. Not yet available.",
      enabled: false,
    },
  ];

  const triggers = [
    {
      label: "Daily loss limit reached",
      description: "Fires when your daily P&L crosses the loss limit. Session is marked stopped.",
      active: true,
    },
    {
      label: "Max trades reached",
      description: "Fires when you've hit your maximum trades-per-day limit.",
      active: true,
    },
    {
      label: "Consecutive losses",
      description: "Fires after the configured number of back-to-back losses.",
      active: true,
    },
    {
      label: "Daily profit target hit",
      description: "Fires when your session P&L reaches the configured profit target.",
      active: alertPrefs?.onProfitTarget ?? false,
    },
    {
      label: "Approaching loss limit (80%)",
      description: "Early warning when P&L reaches 80% of the daily loss limit.",
      active: true,
    },
    {
      label: "Pre-news window",
      description: "Fires before high-impact economic events based on your news policy.",
      active: true,
    },
  ];

  return (
    <AppShell
      eyebrow="Alerts"
      title="Notification channels."
      description="Choose where Guardrail sends alerts. In-app alerts are always on. Telegram is the primary enforcement channel — connect it to receive Guardian lockout messages."
    >
      <div className="grid gap-6">

        {/* Channel status */}
        <SectionCard
          title="Channels"
          description="Alert delivery channels and their current status."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {channels.map((ch) => (
              <div
                key={ch.label}
                className={`rounded-2xl border px-5 py-4 ${ch.enabled ? "border-stone-200 bg-white" : "border-stone-200 bg-stone-50 opacity-70"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-stone-950">{ch.label}</p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${ch.badgeCls}`}>
                    {ch.status}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-5 text-stone-600">{ch.detail}</p>
                {ch.action && (
                  <a
                    href={ch.action.href}
                    className="mt-3 inline-block text-xs font-medium text-stone-950 underline-offset-2 hover:underline"
                  >
                    {ch.action.label} →
                  </a>
                )}
              </div>
            ))}
          </div>
        </SectionCard>

        {/* Alert triggers */}
        <SectionCard
          title="Alert triggers"
          description="Events that generate alerts. Core enforcement triggers are always active."
        >
          <div className="divide-y divide-stone-100">
            {triggers.map((t) => (
              <div key={t.label} className="flex items-start justify-between gap-4 py-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-stone-950">{t.label}</p>
                  <p className="mt-0.5 text-sm text-stone-500">{t.description}</p>
                </div>
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
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
          <p className="mt-4 text-xs text-stone-400">
            Granular trigger configuration is coming in a future update. Core enforcement events
            cannot be disabled — they are the enforcement mechanism.
          </p>
        </SectionCard>

      </div>
    </AppShell>
  );
}
