import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Rules — Guardrail",
};

function ruleRow(label: string, value: string | null, placeholder = "Not set") {
  return { label, value: value ?? placeholder };
}

export default async function RulesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [riskRules, connectedAccounts] = await Promise.all([
    prisma.riskRules.findUnique({ where: { userId: user.id } }),
    prisma.connectedAccount.findMany({
      where: { userId: user.id, isActive: true },
      select: { id: true, platform: true, label: true },
    }),
  ]);

  const hasBroker = connectedAccounts.length > 0;

  const riskRows = [
    ruleRow("Account size", riskRules?.accountSize ? `$${riskRules.accountSize}` : null),
    ruleRow(
      "Daily loss limit",
      riskRules?.maxDailyLoss ? `$${riskRules.maxDailyLoss}` : null,
    ),
    ruleRow(
      "Max risk per trade",
      riskRules?.maxRiskPerTrade ? `$${riskRules.maxRiskPerTrade}` : null,
    ),
    ruleRow("Max trades per day", riskRules?.maxTradesPerDay?.toString() ?? null),
    ruleRow(
      "Stop after consecutive losses",
      riskRules?.stopAfterLosses?.toString() ?? null,
    ),
  ];

  return (
    <AppShell
      eyebrow="Risk Rules"
      title="Your protection rules."
      description="Define the hard limits that Guardrail enforces every session. Rules are evaluated on every trade event — the session locks automatically when a limit is crossed."
      actions={
        <Link
          href="/guardian"
          className="inline-flex rounded-full bg-stone-950 px-5 py-3 text-sm font-medium text-stone-50 transition hover:bg-stone-800"
        >
          Edit in Guardian
        </Link>
      }
    >
      <div className="grid gap-6">

        {/* Enforcement mode */}
        <SectionCard
          title="Enforcement mode"
          description="How Guardrail responds when a rule is crossed."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={`rounded-2xl border px-5 py-4 ${hasBroker ? "border-emerald-200 bg-emerald-50" : "border-stone-200 bg-stone-50"}`}>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                App-level lockout
              </p>
              <p className={`mt-1 text-sm font-medium ${hasBroker ? "text-emerald-800" : "text-stone-700"}`}>
                {hasBroker ? "Active" : "Active (manual mode)"}
              </p>
              <p className="mt-2 text-sm text-stone-600">
                Guardrail marks the session stopped and warns you through Telegram. You stop
                trading voluntarily — or connect a broker for automatic enforcement.
              </p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-5 py-4 opacity-60">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                Broker-level order blocking
              </p>
              <p className="mt-1 text-sm font-medium text-stone-500">
                Coming soon
              </p>
              <p className="mt-2 text-sm text-stone-600">
                Auto-cancellation of open orders and position flattening via broker API. Not yet
                implemented — enforcement is currently app-level only.
              </p>
              <Link
                href="/accounts"
                className="mt-3 inline-block text-xs font-medium text-stone-700 underline-offset-2 hover:underline"
              >
                View broker capabilities →
              </Link>
            </div>
          </div>
        </SectionCard>

        {/* Risk limits */}
        <SectionCard
          title="Risk limits"
          description="Numeric thresholds evaluated on every trade event."
        >
          {riskRules ? (
            <div className="divide-y divide-stone-100">
              {riskRows.map(({ label, value }) => (
                <div
                  key={label}
                  className="flex items-center justify-between py-3 text-sm"
                >
                  <span className="text-stone-600">{label}</span>
                  <span
                    className={
                      value === "Not set"
                        ? "text-stone-400"
                        : "font-medium text-stone-950"
                    }
                  >
                    {value}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-5 py-4">
              <p className="text-sm text-stone-600">
                No rules configured.{" "}
                <Link
                  href="/onboarding"
                  className="font-medium text-stone-950 underline-offset-2 hover:underline"
                >
                  Complete onboarding
                </Link>{" "}
                to set your daily limits.
              </p>
            </div>
          )}
        </SectionCard>

        {/* On-breach behaviour */}
        <SectionCard
          title="On breach"
          description="What happens the moment a rule is crossed."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-stone-50 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                Session status
              </p>
              <p className="mt-2 text-sm font-medium text-stone-950">
                Locked
              </p>
              <p className="mt-1 text-sm text-stone-600">
                The session is marked stopped. No new trades are counted toward limits.
              </p>
            </div>
            <div className="rounded-2xl bg-stone-50 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                Telegram alert
              </p>
              <p className="mt-2 text-sm font-medium text-stone-950">
                Sent immediately
              </p>
              <p className="mt-1 text-sm text-stone-600">
                You receive the reason, rule that triggered, and your reset window.
              </p>
            </div>
            <div className="rounded-2xl border border-dashed border-stone-200 bg-white px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">
                Kill switch
              </p>
              <p className="mt-2 text-sm font-medium text-stone-400">
                Coming soon
              </p>
              <p className="mt-1 text-sm text-stone-600">
                Automatic order cancellation and position flattening via broker API. Not yet
                implemented — session lock is app-level only.
              </p>
            </div>
          </div>
        </SectionCard>

        {/* Rule protection notice */}
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm">
          <p className="font-medium text-amber-900">Rule change protection</p>
          <p className="mt-1 text-stone-700">
            Rule changes during an active session are intentionally limited. To prevent mid-session
            edits under pressure, use{" "}
            <Link
              href="/guardian"
              className="font-medium text-stone-950 underline-offset-2 hover:underline"
            >
              Guardian
            </Link>{" "}
            to manage your session state before editing limits.
          </p>
        </div>

      </div>
    </AppShell>
  );
}
