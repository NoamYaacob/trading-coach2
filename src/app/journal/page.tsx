import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { cookies } from "next/headers";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { computeManualRiskState } from "@/lib/manual-risk-state";
import { getTradingDayWindow } from "@/lib/trading-day";
import { DISPLAY_TIME_ZONE_COOKIE, resolveDisplayTimeZone } from "@/lib/timezone";
import { NextActionBanner } from "@/components/ui/next-action-banner";
import { JournalClientArea } from "./_components/journal-client-area";
import type { TradeEntry } from "./_components/types";

export const metadata: Metadata = {
  title: "Journal — Guardrail",
};

type DecimalLike = { toNumber?: () => number } | string | number | null;

function toNum(val: DecimalLike): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val);
  if (typeof val === "object" && typeof val.toNumber === "function") return val.toNumber();
  return null;
}

function fmtMoney(n: number): string {
  return `${n >= 0 ? "" : "−"}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default async function JournalPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [profile, riskRules, hasBroker] = await Promise.all([
    prisma.traderProfile.findUnique({
      where: { userId: user.id },
      select: { timezone: true },
    }),
    prisma.riskRules.findUnique({ where: { userId: user.id } }),
    prisma.connectedAccount
      .count({ where: { userId: user.id, isActive: true } })
      .then((c) => c > 0),
  ]);

  const cookieStore = await cookies();
  const tz = resolveDisplayTimeZone({
    onboardingTimeZone: profile?.timezone,
    browserTimeZone: cookieStore.get(DISPLAY_TIME_ZONE_COOKIE)?.value,
  });

  const window = getTradingDayWindow({
    timezone: tz,
    sessionStartHour: riskRules?.sessionStartHour ?? null,
    sessionEndHour: riskRules?.sessionEndHour ?? null,
  });

  const shortWindow = (() => {
    const fmtHM = (d: Date) =>
      new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: tz,
      }).format(d);

    return `${fmtHM(window.start)}–${fmtHM(window.end)}`;
  })();

  // Cap both queries at the current instant so future-dated rows are excluded
  // from both the history display and today's metrics.
  const now = new Date();
  const effectiveWindowEnd = window.end < now ? window.end : now;

  const [allEntries, todayEntries] = await Promise.all([
    prisma.manualTradeEntry.findMany({
      where: { userId: user.id, tradedAt: { lte: now } },
      orderBy: { tradedAt: "desc" },
      take: 100,
    }),
    prisma.manualTradeEntry.findMany({
      where: { userId: user.id, tradedAt: { gte: window.start, lt: effectiveWindowEnd } },
      orderBy: { tradedAt: "asc" },
    }),
  ]);

  const risk = computeManualRiskState({ rules: riskRules, todayTrades: todayEntries });

  // Serialize Prisma Decimal + Date values to plain JS types for client components.
  const serializedEntries: TradeEntry[] = allEntries.map((e) => ({
    id: e.id,
    symbol: e.symbol,
    direction: e.direction,
    tradedAt: e.tradedAt.toISOString(),
    entryPrice: toNum(e.entryPrice),
    exitPrice: toNum(e.exitPrice),
    stopPrice: toNum(e.stopPrice),
    targetPrice: toNum(e.targetPrice),
    quantity: toNum(e.quantity),
    pnl: toNum(e.pnl),
    fees: toNum(e.fees),
    grossPnl: toNum(e.grossPnl),
    pnlSource: e.pnlSource ?? null,
    riskAmount: toNum(e.riskAmount),
    rMultiple: toNum(e.rMultiple),
    strategy: e.strategy ?? null,
    notes: e.notes ?? null,
    ruleBreached: e.ruleBreached,
    breachReason: e.breachReason ?? null,
  }));

  const summaryTiles: Array<{ label: string; value: string; cls?: string }> = [
    {
      label: "Today's P&L",
      value: fmtMoney(risk.todayPnL),
      cls:
        risk.todayPnL > 0
          ? "text-emerald-700"
          : risk.todayPnL < 0
            ? "text-red-700"
            : "text-stone-950",
    },
    { label: "Trades today", value: String(risk.todayTradesCount) },
    { label: "Wins", value: String(risk.winCount), cls: "text-emerald-700" },
    { label: "Losses", value: String(risk.lossCount), cls: "text-red-700" },
    { label: "Loss streak", value: String(risk.consecutiveLosses) },
    { label: "Largest loss", value: risk.largestLoss > 0 ? `−$${risk.largestLoss.toFixed(2)}` : "—" },
    { label: "Rule breaches today", value: String(risk.ruleBreachesToday) },
  ];

  return (
    <AppShell
      eyebrow="Journal"
      title="What happened today?"
      description="Manual trade log — demo and pre-connection testing. Connect Tradovate for automatic trade tracking."
    >
      <div className="grid gap-6">
        {!riskRules && (
          <NextActionBanner
            variant="warning"
            message="No risk rules configured — risk state cannot be evaluated."
            cta={{ label: "Set rules", href: "/rules" }}
          />
        )}

        {risk.permission === "LOCKED" && (
          <NextActionBanner
            variant="locked"
            message={
              <>
                <span className="font-semibold">Session locked.</span>{" "}
                {risk.lastBreach?.detail ?? "A daily limit was reached."} Stop trading until the session resets.
              </>
            }
            cta={{ label: "View status", href: "/guardian" }}
          />
        )}

        <SectionCard
          title="Today"
          description={
            <>
              <span className="md:hidden">Today · {shortWindow}</span>
              <span className="hidden md:inline">Trading day: {window.label}.</span>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4 xl:grid-cols-7">
            {summaryTiles.map((t) => (
              <div
                key={t.label}
                className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2.5 sm:px-4 sm:py-3"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                  {t.label}
                </p>
                <p className={`mt-1 text-base font-semibold tabular-nums sm:mt-1.5 sm:text-lg ${t.cls ?? "text-stone-950"}`}>
                  {t.value}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>

        <JournalClientArea
          entries={serializedEntries}
          tz={tz}
          windowStartIso={window.start.toISOString()}
        />

        <p className="text-xs text-stone-500">
          {hasBroker ? (
            <>
              <span className="md:hidden">Manual journal is used until Tradovate is connected.</span>
              <span className="hidden md:inline">
                Running in demo mode — broker connection is pending verification. Risk state will switch to live broker data once verified.
              </span>
            </>
          ) : (
            <>
              <span className="md:hidden">
                Manual journal is used until Tradovate is connected.{" "}
                <a href="/accounts" className="font-medium text-stone-700 underline-offset-2 hover:underline">
                  Connect →
                </a>
              </span>
              <span className="hidden md:inline">
                Demo mode — risk state is evaluated from manual entries, not live broker data.{" "}
                <a href="/accounts" className="font-medium text-stone-700 underline-offset-2 hover:underline">
                  Connect Tradovate for live enforcement →
                </a>
              </span>
            </>
          )}
        </p>
      </div>
    </AppShell>
  );
}