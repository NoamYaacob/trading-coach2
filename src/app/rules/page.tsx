import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { RulesForm, type RulesFormValues } from "./_components/rules-form";

export const metadata: Metadata = {
  title: "Rules — Guardrail",
};

function decToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && v !== null && "toString" in v) {
    return (v as { toString: () => string }).toString();
  }
  return String(v);
}

function intToString(v: number | null | undefined): string {
  return v === null || v === undefined ? "" : String(v);
}

function parseTradingDays(v: string | null | undefined): string[] {
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
}

export default async function RulesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [riskRules, brokerCount] = await Promise.all([
    prisma.riskRules.findUnique({ where: { userId: user.id } }),
    prisma.connectedAccount.count({ where: { userId: user.id, isActive: true } }),
  ]);
  const hasBroker = brokerCount > 0;

  const initial: RulesFormValues = {
    accountSize: decToString(riskRules?.accountSize),
    maxDailyLoss: decToString(riskRules?.maxDailyLoss),
    dailyProfitTarget: decToString(riskRules?.dailyProfitTarget),
    maxRiskPerTrade: decToString(riskRules?.maxRiskPerTrade ?? riskRules?.riskPerTrade),
    maxTradesPerDay: intToString(riskRules?.maxTradesPerDay),
    stopAfterLosses: intToString(riskRules?.stopAfterLosses),
    maxContracts: intToString(riskRules?.maxContracts),
    allowedSymbols: riskRules?.allowedSymbols ?? "",
    sessionStartHour: intToString(riskRules?.sessionStartHour),
    sessionEndHour: intToString(riskRules?.sessionEndHour),
    tradingDays: parseTradingDays(riskRules?.tradingDays),
    newsLockoutEnabled: riskRules?.newsLockoutEnabled ?? false,
    onBreachWarn: riskRules?.onBreachWarn ?? true,
    onBreachAppLock: riskRules?.onBreachAppLock ?? true,
    onBreachCancelOrders: riskRules?.onBreachCancelOrders ?? false,
    onBreachFlatten: riskRules?.onBreachFlatten ?? false,
  };

  return (
    <AppShell
      eyebrow="Risk Rules"
      title="Edit your protection rules."
      description="Define the limits Guardrail enforces. Rules are evaluated on every trade event the system sees. Changes save immediately and apply to the next event."
      actions={
        <Link
          href="/guardian"
          className="inline-flex rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
        >
          View enforcement status
        </Link>
      }
    >
      <div className="grid gap-6">

        {/* Mode banner */}
        <div className={`rounded-2xl border px-5 py-4 text-sm ${hasBroker ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
          <p className={`font-semibold ${hasBroker ? "text-emerald-900" : "text-amber-900"}`}>
            {hasBroker ? "Broker connected · App-level enforcement" : "Manual mode · App-level enforcement only"}
          </p>
          <p className="mt-0.5 text-stone-700">
            Manual mode helps you follow your rules inside this app — Guardrail tracks, warns, and locks the session. Broker-level enforcement (cancel orders, flatten positions) requires a future broker integration phase.
          </p>
        </div>

        {/* Edit form */}
        <SectionCard
          title="Rule configuration"
          description="All fields are optional. Empty values mean no enforcement for that rule."
        >
          <RulesForm initial={initial} hasBroker={hasBroker} />
        </SectionCard>

      </div>
    </AppShell>
  );
}
