import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getGuardianSnapshot } from "@/lib/guardian";
import { RulesForm, type RulesFormValues } from "./_components/rules-form";
import { GuardianToggle } from "./_components/guardian-toggle";

export const metadata: Metadata = {
  title: "Trading Plan — Guardrail",
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

  const [riskRules, brokerCount, guardian] = await Promise.all([
    prisma.riskRules.findUnique({ where: { userId: user.id } }),
    prisma.connectedAccount.count({ where: { userId: user.id, isActive: true } }),
    getGuardianSnapshot(user.id),
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
      eyebrow="Trading Plan"
      title="Set your trading plan."
      description="Choose the limits Guardrail monitors during each session."
      actions={
        <Link
          href="/guardian"
          className="inline-flex rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
        >
          View status
        </Link>
      }
    >
      <div className="grid gap-6">
        <SectionCard
          title="Your trading plan"
          description="These limits decide when your session is Allowed, Warning, or Locked."
        >
          <div id="guardian-toggle" className="mb-5 scroll-mt-20">
            <GuardianToggle initialEnabled={guardian.profile.guardianEnabled} />
          </div>
          <RulesForm initial={initial} hasBroker={hasBroker} />
        </SectionCard>
      </div>
    </AppShell>
  );
}
