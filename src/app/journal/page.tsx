import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { cookies } from "next/headers";

import { AppShell } from "@/components/ui/app-shell";
import { SectionCard } from "@/components/ui/section-card";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTradingDayWindow } from "@/lib/trading-day";
import { DISPLAY_TIME_ZONE_COOKIE, resolveDisplayTimeZone } from "@/lib/timezone";
import { NextActionBanner } from "@/components/ui/next-action-banner";
import { JournalClientArea } from "./_components/journal-client-area";
import type { TradeEntry } from "./_components/types";

export const metadata: Metadata = {
  title: "Trade Review — Guardrail",
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

  // Compute session metrics from today's trade entries.
  const sortedToday = [...todayEntries].sort((a, b) => a.tradedAt.getTime() - b.tradedAt.getTime());
  let todayPnL = 0, winCount = 0, lossCount = 0, largestLoss = 0, ruleBreachesToday = 0;
  for (const t of sortedToday) {
    const pnl = toNum(t.pnl);
    if (pnl !== null) {
      todayPnL += pnl;
      if (pnl > 0) winCount++;
      else if (pnl < 0) { lossCount++; if (Math.abs(pnl) > largestLoss) largestLoss = Math.abs(pnl); }
    }
    if (t.ruleBreached) ruleBreachesToday++;
  }
  let consecutiveLosses = 0;
  for (let i = sortedToday.length - 1; i >= 0; i--) {
    const pnl = toNum(sortedToday[i].pnl);
    if (pnl !== null && pnl < 0) consecutiveLosses++;
    else if (pnl !== null) break;
  }
  const todayTradesCount = sortedToday.length;

  // Check hard breach limits to surface a locked-session banner.
  const maxDailyLoss = toNum(riskRules?.maxDailyLoss ?? null);
  const lossUsed = todayPnL < 0 ? Math.abs(todayPnL) : 0;
  const dailyLossLimitHit = maxDailyLoss !== null && lossUsed >= maxDailyLoss && lossUsed > 0;
  const dailyProfitTarget = toNum(riskRules?.dailyProfitTarget ?? null);
  const dailyProfitTargetHit = dailyProfitTarget !== null && dailyProfitTarget > 0 && todayPnL >= dailyProfitTarget;
  const maxTradesPerDay = riskRules?.maxTradesPerDay ?? null;
  const maxTradesHit = maxTradesPerDay !== null && todayTradesCount >= maxTradesPerDay;
  const stopAfterLosses = riskRules?.stopAfterLosses ?? null;
  const stopAfterLossesHit = stopAfterLosses !== null && stopAfterLosses > 0 && consecutiveLosses >= stopAfterLosses;
  const sessionLocked = dailyLossLimitHit || dailyProfitTargetHit || maxTradesHit || stopAfterLossesHit;
  const lockDetail = dailyLossLimitHit ? "Your P&L crossed the daily loss limit you set in Rules."
    : dailyProfitTargetHit ? "Your P&L reached the daily profit target. Session is locked to protect the win."
    : stopAfterLossesHit ? "You hit your consecutive-loss stop. Session is locked."
    : maxTradesHit ? "You've hit the maximum number of trades you allow yourself per day."
    : null;

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
      value: fmtMoney(todayPnL),
      cls: todayPnL > 0 ? "text-emerald-700" : todayPnL < 0 ? "text-red-700" : "text-stone-950",
    },
    { label: "Trades today", value: String(todayTradesCount) },
    { label: "Wins", value: String(winCount), cls: "text-emerald-700" },
    { label: "Losses", value: String(lossCount), cls: "text-red-700" },
    { label: "Loss streak", value: String(consecutiveLosses) },
    { label: "Largest loss", value: largestLoss > 0 ? `−$${largestLoss.toFixed(2)}` : "—" },
    { label: "Rule breaches today", value: String(ruleBreachesToday) },
  ];

  return (
    <AppShell
      eyebrow="Trade Review"
      title="Trade history."
      description="Trades sync automatically from your connected broker account. Rule violations are flagged by the Guardrail engine."
      note="Broker-side order blocking is not enabled yet."
    >
      <div className="grid gap-6">
        {!hasBroker && (
          <NextActionBanner
            variant="warning"
            message="No broker connected — trade data is not yet syncing."
            cta={{ label: "Connect broker", href: "/accounts" }}
          />
        )}

        {!riskRules && (
          <NextActionBanner
            variant="warning"
            message="No risk rules configured — risk state cannot be evaluated."
            cta={{ label: "Set rules", href: "/rules" }}
          />
        )}

        {sessionLocked && (
          <NextActionBanner
            variant="locked"
            message={
              <>
                <span className="font-semibold">Session locked.</span>{" "}
                {lockDetail ?? "A daily limit was reached."} Stop trading until the session resets.
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

      </div>
    </AppShell>
  );
}
