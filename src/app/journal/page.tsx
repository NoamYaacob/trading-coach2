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
import { TradeEntryForm } from "./_components/trade-entry-form";

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

function fmt(val: DecimalLike): string {
  const n = toNum(val);
  if (n === null) return "—";
  return `${n >= 0 ? "" : "−"}${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtPnl(val: DecimalLike): { text: string; cls: string } {
  const n = toNum(val);
  if (n === null) return { text: "—", cls: "text-stone-400" };
  if (n > 0) return { text: `+$${n.toFixed(2)}`, cls: "text-emerald-700 font-medium" };
  if (n < 0) return { text: `−$${Math.abs(n).toFixed(2)}`, cls: "text-red-700 font-medium" };
  return { text: "$0.00", cls: "text-stone-500" };
}

function fmtR(val: DecimalLike): string {
  const n = toNum(val);
  if (n === null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
}

function fmtMoney(n: number): string {
  return `${n >= 0 ? "" : "−"}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function JournalPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Resolve the user's display timezone first so the trading-day window is
  // bucketed correctly. We need traderProfile.timezone before we know which
  // window to query against.
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

  const [allEntries, todayEntries] = await Promise.all([
    prisma.manualTradeEntry.findMany({
      where: { userId: user.id },
      orderBy: { tradedAt: "desc" },
      take: 100,
    }),
    prisma.manualTradeEntry.findMany({
      where: { userId: user.id, tradedAt: { gte: window.start, lt: window.end } },
      orderBy: { tradedAt: "asc" },
    }),
  ]);

  const risk = computeManualRiskState({ rules: riskRules, todayTrades: todayEntries });

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

        {/* No-rules warning */}
        {!riskRules && (
          <NextActionBanner
            variant="warning"
            message="No risk rules configured — risk state cannot be evaluated."
            cta={{ label: "Set rules", href: "/rules" }}
          />
        )}

        {/* Locked warning */}
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

        {/* Today summary */}
        <SectionCard
          title="Today"
          description={
            <>
              <span className="md:hidden">Today · {shortWindow}</span>
              <span className="hidden md:inline">Trading day: {window.label}.</span>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-2 sm:gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            {summaryTiles.map((t) => (
              <div key={t.label} className="rounded-2xl border border-stone-200 bg-stone-50 px-3 py-2.5 sm:px-4 sm:py-3">
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

        {/* Trade history */}
        <SectionCard
          title="Trade history"
          description={
            allEntries.length > 0
              ? `${allEntries.length} trade${allEntries.length === 1 ? "" : "s"} logged. Newest first.`
              : "No trades logged for this session."
          }
        >
          {allEntries.length === 0 ? (
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-6 py-8 text-center">
              <p className="text-base font-semibold text-stone-800">No trades logged for this session</p>
              <p className="mt-2 text-sm text-stone-600">Add a manual trade below to track risk state.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 text-left text-xs font-semibold uppercase tracking-[0.18em] text-stone-400">
                    <th className="pb-3 pr-4">Date</th>
                    <th className="pb-3 pr-4">Symbol</th>
                    <th className="pb-3 pr-4">Dir</th>
                    <th className="pb-3 pr-4">Entry</th>
                    <th className="pb-3 pr-4">Exit</th>
                    <th className="pb-3 pr-4">Qty</th>
                    <th className="pb-3 pr-4">P&L</th>
                    <th className="pb-3 pr-4">Risk</th>
                    <th className="pb-3 pr-4">R</th>
                    <th className="pb-3 pr-4">Strategy</th>
                    <th className="pb-3">Breach</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {allEntries.map((e) => {
                    const pnl = fmtPnl(e.pnl);
                    return (
                      <tr key={e.id} className="text-stone-700">
                        <td className="py-3 pr-4 font-mono text-xs text-stone-400">
                          {new Intl.DateTimeFormat("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                            timeZone: tz,
                          }).format(e.tradedAt)}
                        </td>
                        <td className="py-3 pr-4 font-medium text-stone-950">{e.symbol}</td>
                        <td className="py-3 pr-4">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                              e.direction === "LONG"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-red-100 text-red-800"
                            }`}
                          >
                            {e.direction}
                          </span>
                        </td>
                        <td className="py-3 pr-4 font-mono">{fmt(e.entryPrice)}</td>
                        <td className="py-3 pr-4 font-mono">{fmt(e.exitPrice)}</td>
                        <td className="py-3 pr-4 font-mono">{fmt(e.quantity)}</td>
                        <td className={`py-3 pr-4 font-mono ${pnl.cls}`}>{pnl.text}</td>
                        <td className="py-3 pr-4 font-mono text-stone-500">{fmt(e.riskAmount)}</td>
                        <td className="py-3 pr-4 font-mono text-stone-500">{fmtR(e.rMultiple)}</td>
                        <td className="py-3 pr-4 text-stone-500">{e.strategy ?? "—"}</td>
                        <td className="py-3">
                          {e.ruleBreached ? (
                            <span
                              className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700"
                              title={e.breachReason ?? undefined}
                            >
                              Yes
                            </span>
                          ) : (
                            <span className="text-stone-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>

        {/* Add manual trade — collapsed by default */}
        <details className="group rounded-2xl border border-stone-200 bg-white/90 px-5 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-stone-950">
            Add manual trade
            <span className="text-xs font-normal text-stone-400 transition-transform group-open:rotate-45">+</span>
          </summary>
          <div className="mt-5">
            <TradeEntryForm />
          </div>
        </details>

        {/* Mode footer — small, single line */}
        <p className="text-xs text-stone-500">
          {hasBroker ? (
            <>
              <span className="md:hidden">Manual journal is used until Tradovate is connected.</span>
              <span className="hidden md:inline">Running in demo mode — broker connection is pending verification. Risk state will switch to live broker data once verified.</span>
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
