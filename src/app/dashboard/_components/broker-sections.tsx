/**
 * Async server components that load broker Account-Balance-History (ABH) data
 * OFF the page's blocking render path.
 *
 * Each section awaits the shared, per-request-cached `loadBrokerPerformance`
 * loader and renders its ABH-dependent widget. They are meant to be wrapped in
 * `<Suspense>` by the page so the static shell (header, account cards, rules,
 * session trades) paints instantly while ABH (which can take 3–8s) streams in.
 *
 * Contract:
 *  - while ABH is loading  → the page's Suspense fallback ("Loading broker
 *    performance…") shows. These components never render during that window.
 *  - ABH failed            → an honest "temporarily unavailable" panel. We do
 *    NOT silently fall back to wrong fill-only numbers.
 *  - ABH ok                → the real widget, with ABH as the source of truth.
 */

import type { ComponentProps } from "react";

import { EquityCurve } from "./equity-curve";
import { PnlCalendar } from "./pnl-calendar";
import { TraderInsights } from "./trader-insights";
import { profitFactor } from "./insights";
import {
  computeBrokerWindowStats,
  brokerSourceLabel,
} from "@/lib/trades/broker-account-performance";
import type { RoundTripTrade } from "@/lib/trades/round-trips";
import { loadBrokerPerformance } from "@/lib/brokers/broker-performance-loader";

const LOADING_MSG = "Loading broker performance…";
const UNAVAILABLE_MSG = "Broker performance temporarily unavailable";

// ── Shared presentational pieces ────────────────────────────────────────────

const KPI_CARD_STYLE = {
  background: "var(--gr-surface)",
  border: "1px solid var(--gr-border)",
  borderRadius: 12,
  padding: "14px 16px",
} as const;

function KpiCard({
  label,
  value,
  sub,
  toneColor,
}: {
  label: string;
  value: string;
  sub: string;
  toneColor: string;
}) {
  return (
    <div style={KPI_CARD_STYLE}>
      <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--gr-text-mute)" }}>
        {label}
      </span>
      <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, letterSpacing: "-0.02em", marginTop: 7, fontFamily: "var(--font-ibm-plex-mono, monospace)", color: toneColor }}>
        {value}
      </div>
      <span style={{ fontSize: 11, marginTop: 6, display: "inline-block", color: "var(--gr-text-mute)" }}>
        {sub}
      </span>
    </div>
  );
}

/** Panel-sized fallback/unavailable box for the larger widgets (equity,
 *  calendar, insights), with a reserved min-height to limit layout shift. */
function BrokerPanel({
  title,
  message,
  minHeight,
}: {
  title: string;
  message: string;
  minHeight: number;
}) {
  return (
    <div
      style={{
        background: "var(--gr-surface)",
        border: "1px solid var(--gr-border)",
        borderRadius: 14,
        padding: "18px 20px",
        minHeight,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <span style={{ fontSize: 15, fontWeight: 600, color: "var(--gr-ink)" }}>{title}</span>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 12.5, color: "var(--gr-text-mute)" }}>{message}</span>
      </div>
    </div>
  );
}

// ── Win rate / Profit factor KPI cards (two grid cells) ─────────────────────

export function BrokerKpiCardsLoading() {
  return (
    <>
      <KpiCard label="Win rate · 30D" value="…" sub={LOADING_MSG} toneColor="var(--gr-text-faint)" />
      <KpiCard label="Profit factor · 30D" value="…" sub={LOADING_MSG} toneColor="var(--gr-text-faint)" />
    </>
  );
}

export async function BrokerKpiCards({
  accountId,
  userId,
  recentTrades,
  since30dKey,
  recentTradesFeesAvailable,
}: {
  accountId: string;
  userId: string;
  recentTrades: RoundTripTrade[];
  since30dKey: string;
  recentTradesFeesAvailable: boolean;
}) {
  const res = await loadBrokerPerformance("dashboard", accountId, userId);
  if (res.status === "error") {
    return (
      <>
        <KpiCard label="Win rate · 30D" value="—" sub={UNAVAILABLE_MSG} toneColor="var(--gr-text-faint)" />
        <KpiCard label="Profit factor · 30D" value="—" sub={UNAVAILABLE_MSG} toneColor="var(--gr-text-faint)" />
      </>
    );
  }

  const brokerPerformance = res.perf;
  const brokerWindow30d = brokerPerformance.hasBrokerHistory
    ? computeBrokerWindowStats(brokerPerformance, since30dKey)
    : null;
  const wins30d = brokerWindow30d != null
    ? brokerWindow30d.winCount
    : recentTrades.filter((t) => t.netPnl > 0).length;
  const total30d = brokerWindow30d != null ? brokerWindow30d.dayCount : recentTrades.length;
  const winRate30d = total30d > 0 ? wins30d / total30d : null;
  const pf30d = brokerWindow30d?.profitFactor ?? profitFactor(recentTrades);

  return (
    <>
      <KpiCard
        label="Win rate · 30D"
        value={winRate30d != null ? `${Math.round(winRate30d * 100)}%` : "—"}
        sub={
          winRate30d != null
            ? brokerWindow30d != null
              ? `${wins30d}W · ${brokerWindow30d.lossCount}L · ${total30d} days · broker net days`
              : `${wins30d}W · ${recentTrades.length - wins30d}L · ${recentTrades.length} trades`
            : "No broker trades in last 30 days"
        }
        toneColor={winRate30d != null && winRate30d >= 0.5 ? "var(--gr-ink)" : "var(--gr-warn)"}
      />
      <KpiCard
        label="Profit factor · 30D"
        value={pf30d != null ? pf30d.toFixed(2) : "—"}
        sub={
          pf30d != null
            ? brokerWindow30d != null
              ? pf30d >= 1
                ? `Net wins exceed losses · ${brokerSourceLabel(brokerPerformance.source)}`
                : `Net losses exceed wins · ${brokerSourceLabel(brokerPerformance.source)}`
              : recentTradesFeesAvailable
                ? pf30d >= 1 ? "Net wins exceed losses" : "Net losses exceed wins"
                : pf30d >= 1 ? "Wins exceed losses · before fees" : "Losses exceed wins · before fees"
            : total30d === 0 ? "No broker days in window" : "No losing days yet"
        }
        toneColor={pf30d != null && pf30d >= 1 ? "var(--gr-ink)" : pf30d != null ? "var(--gr-warn)" : "var(--gr-ink)"}
      />
    </>
  );
}

// ── Equity curve ────────────────────────────────────────────────────────────

export function EquityCurveLoading() {
  return <BrokerPanel title="Equity curve" message={LOADING_MSG} minHeight={260} />;
}

export async function EquityCurveSection({
  accountId,
  userId,
  recentTrades,
  tradesHref,
  timezone,
  recentTradesFeesAvailable,
}: {
  accountId: string;
  userId: string;
  recentTrades: RoundTripTrade[];
  tradesHref: string;
  timezone: string;
  recentTradesFeesAvailable: boolean;
}) {
  const res = await loadBrokerPerformance("dashboard", accountId, userId);
  if (res.status === "error") {
    return <BrokerPanel title="Equity curve" message={UNAVAILABLE_MSG} minHeight={260} />;
  }
  const perf = res.perf;
  return (
    <EquityCurve
      trades={recentTrades}
      tradesHref={tradesHref}
      dataSourceLabel={recentTradesFeesAvailable ? "Net P&L · broker per-fill fees" : "Fill P&L · before fees"}
      timezone={timezone}
      feesAvailable={recentTradesFeesAvailable}
      brokerDayNet={perf.dayNet}
      brokerSource={perf.source}
    />
  );
}

// ── P&L calendar ────────────────────────────────────────────────────────────

export function PnlCalendarLoading() {
  return <BrokerPanel title="P&L calendar" message={LOADING_MSG} minHeight={320} />;
}

export async function PnlCalendarSection({
  accountId,
  userId,
  recentTrades,
  timezone,
  accountLabel,
  tradesHref,
}: {
  accountId: string;
  userId: string;
  recentTrades: RoundTripTrade[];
  timezone: string;
  accountLabel: string;
  tradesHref: string;
}) {
  const res = await loadBrokerPerformance("dashboard", accountId, userId);
  if (res.status === "error") {
    return <BrokerPanel title="P&L calendar" message={UNAVAILABLE_MSG} minHeight={320} />;
  }
  const perf = res.perf;
  return (
    <PnlCalendar
      trades={recentTrades}
      timezone={timezone}
      accountLabel={accountLabel}
      tradesHref={tradesHref}
      accountId={accountId}
      brokerDayNet={perf.dayNet}
      brokerSource={perf.source}
    />
  );
}

// ── Trader insights ─────────────────────────────────────────────────────────

export function TraderInsightsLoading() {
  return <BrokerPanel title="Trader insights" message={LOADING_MSG} minHeight={200} />;
}

type TraderInsightsProps = ComponentProps<typeof TraderInsights>;

export async function TraderInsightsSection({
  accountId,
  userId,
  selectedAccount,
  guardian,
  riskRules,
  recentTrades,
  timezone,
  recentTradesFeesAvailable,
}: {
  accountId: string;
  userId: string;
  selectedAccount: TraderInsightsProps["selectedAccount"];
  guardian: TraderInsightsProps["guardian"];
  riskRules: TraderInsightsProps["riskRules"];
  recentTrades: RoundTripTrade[];
  timezone: string;
  recentTradesFeesAvailable: boolean;
}) {
  const res = await loadBrokerPerformance("dashboard", accountId, userId);
  if (res.status === "error") {
    return <BrokerPanel title="Trader insights" message={UNAVAILABLE_MSG} minHeight={200} />;
  }
  const perf = res.perf;
  return (
    <TraderInsights
      selectedAccount={selectedAccount}
      guardian={guardian}
      riskRules={riskRules}
      recentTrades={recentTrades}
      timezone={timezone}
      feesAvailable={recentTradesFeesAvailable}
      brokerDayNet={perf.dayNet}
      brokerPerformance={perf}
    />
  );
}
