"use client";

/**
 * Equity-curve client island.
 *
 * Renders cumulative realized P&L over a user-selected timeframe (7D / 14D /
 * 30D / All) as a Recharts area chart.  The component is intentionally
 * client-only because the timeframe toggle is local UI state that must not
 * round-trip to the server (and must not invalidate the dashboard's data).
 * The dashboard already loads the last 30 days of round-trips for the selected
 * account; this component just filters that array down further per the toggle.
 *
 * Honest empty-state behaviour:
 *   - fewer than 2 trades in the selected window → designed empty state
 *   - no trades at all → "No closed round-trips" copy
 * No fake, demo, or generated curves are ever drawn — every point on the chart
 * is a real closed round-trip's running cumulative P&L.
 *
 * Colour conventions match the Guardrail design tokens:
 *   - var(--gr-ok) when ending cumulative ≥ 0
 *   - var(--gr-bad) when ending cumulative < 0
 */

import * as React from "react";
import Link from "next/link";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";

import type { RoundTripTrade } from "@/lib/trades/round-trips";

type Timeframe = "7d" | "14d" | "30d" | "all";

type Props = {
  /** Round-trip trades for the selected account (already <= 30d). */
  trades: RoundTripTrade[];
  /** Destination for the "Open →" link in the panel header. */
  tradesHref: string;
  /** Honest provenance label, e.g. "From broker fills". */
  dataSourceLabel: string;
};

function fmt$(v: number): string {
  const abs = Math.abs(v);
  const sign = v >= 0 ? "+" : "−";
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function filterByTimeframe(
  trades: RoundTripTrade[],
  tf: Timeframe,
): RoundTripTrade[] {
  if (tf === "all") return trades;
  const days = tf === "7d" ? 7 : tf === "14d" ? 14 : 30;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return trades.filter((t) => t.closedAt.getTime() >= cutoff);
}

// Guardrail design tokens resolved to concrete colours for Recharts.  CSS
// var() is not honoured inside SVG presentation attributes (stroke / fill on
// the rendered chart elements), so we read the computed values from :root on
// mount, with the globals.css hex values as the first-paint / SSR fallback.
const TOKEN_FALLBACKS = {
  ok: "#3f7c2a",
  bad: "#a72d1f",
  border: "#dcd0b7",
  surface: "#ffffff",
  ink: "#1b1812",
  textMute: "#8b8270",
  textFaint: "#b6ab94",
};
type TokenColors = typeof TOKEN_FALLBACKS;

// Resolves design-token colours and signals when the component has mounted on
// the client.  Recharts' ResponsiveContainer measures its parent at runtime, so
// the chart is only rendered after mount — this avoids the SSR "width(-1)"
// warning and any hydration mismatch, while a same-height placeholder keeps the
// card layout stable (no content shift).
function useTokenColors(): { colors: TokenColors; mounted: boolean } {
  const [colors, setColors] = React.useState<TokenColors>(TOKEN_FALLBACKS);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    const cs = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) =>
      cs.getPropertyValue(name).trim() || fallback;
    setColors({
      ok: read("--gr-ok", TOKEN_FALLBACKS.ok),
      bad: read("--gr-bad", TOKEN_FALLBACKS.bad),
      border: read("--gr-border", TOKEN_FALLBACKS.border),
      surface: read("--gr-surface", TOKEN_FALLBACKS.surface),
      ink: read("--gr-ink", TOKEN_FALLBACKS.ink),
      textMute: read("--gr-text-mute", TOKEN_FALLBACKS.textMute),
      textFaint: read("--gr-text-faint", TOKEN_FALLBACKS.textFaint),
    });
    setMounted(true);
  }, []);
  return { colors, mounted };
}

export function EquityCurve({ trades, tradesHref, dataSourceLabel }: Props) {
  const [timeframe, setTimeframe] = React.useState<Timeframe>("30d");
  const windowTrades = React.useMemo(
    () => filterByTimeframe(trades, timeframe),
    [trades, timeframe],
  );

  const rangeLabel =
    timeframe === "7d" ? "last 7 days"
    : timeframe === "14d" ? "last 14 days"
    : timeframe === "30d" ? "last 30 days"
    : "all time";

  const toggleButton = (tf: Timeframe, label: string) => {
    const active = tf === timeframe;
    return (
      <button
        key={tf}
        type="button"
        onClick={() => setTimeframe(tf)}
        aria-pressed={active}
        style={{
          padding: "4px 11px",
          borderRadius: 7,
          fontSize: 11,
          fontWeight: active ? 700 : 500,
          border: active ? "1px solid var(--gr-border)" : "1px solid transparent",
          background: active ? "var(--gr-surface)" : "transparent",
          color: active ? "var(--gr-ink)" : "var(--gr-text-mute)",
          cursor: "pointer",
          letterSpacing: "0.04em",
          transition: "background 0.1s, color 0.1s",
          boxShadow: active ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div
      style={{
        background: "var(--gr-surface)",
        border: "1px solid var(--gr-border)",
        borderRadius: 14,
        padding: "18px 20px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 12,
          alignItems: "flex-start",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--gr-ink)" }}>
              Equity curve
            </span>
            <span style={{ fontSize: 12, color: "var(--gr-text-mute)" }}>
              · {rangeLabel}
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--gr-text-mute)", marginTop: 2 }}>
            Cumulative realized P&amp;L · {dataSourceLabel}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 1, background: "var(--gr-bg-elev)", borderRadius: 9, padding: 3 }}>
            {toggleButton("7d", "7D")}
            {toggleButton("14d", "14D")}
            {toggleButton("30d", "30D")}
            {toggleButton("all", "All")}
          </div>
          <Link
            href={tradesHref}
            className="btn-compact"
            style={{
              fontSize: 12,
              padding: "4px 10px",
              borderRadius: 7,
              border: "none",
              background: "transparent",
              color: "var(--gr-copper)",
              textDecoration: "none",
              marginLeft: 2,
            }}
          >
            Open →
          </Link>
        </div>
      </div>

      <EquityCurveBody trades={windowTrades} />
    </div>
  );
}

type ChartPoint = { t: number; pnl: number };

function fmtTooltipDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function EquityTooltip({
  active,
  payload,
  colors,
}: {
  active?: boolean;
  payload?: Array<{ value?: number; payload?: ChartPoint }>;
  colors: TokenColors;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  const pnl = payload[0]?.value;
  if (point == null || pnl == null) return null;
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: "8px 10px",
        boxShadow: "0 4px 14px rgba(0,0,0,0.10)",
        fontSize: 12,
        lineHeight: 1.4,
      }}
    >
      <div style={{ color: colors.textMute, marginBottom: 3 }}>
        {fmtTooltipDate(point.t)}
      </div>
      <div
        style={{
          fontFamily: "var(--font-ibm-plex-mono, monospace)",
          fontWeight: 600,
          color: pnl >= 0 ? colors.ok : colors.bad,
        }}
      >
        {fmt$(pnl)}
      </div>
      <div style={{ color: colors.textFaint, fontSize: 10.5, marginTop: 2 }}>
        Cumulative realized P&amp;L
      </div>
    </div>
  );
}

function EquityCurveBody({ trades }: { trades: RoundTripTrade[] }) {
  const { colors, mounted } = useTokenColors();

  if (trades.length < 2) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 150,
          borderRadius: 10,
          border: "1px dashed var(--gr-border)",
          background: "var(--gr-bg-elev)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: "28px 24px",
        }}
      >
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 11,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--gr-surface)",
            border: "1px solid var(--gr-border)",
          }}
        >
          <svg width="22" height="14" viewBox="0 0 22 14" fill="none" aria-hidden="true">
            <polyline
              points="1,11 6,7 11,9 16,3 21,5"
              stroke="var(--gr-text-faint)"
              strokeWidth="1.3"
              strokeLinejoin="round"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </div>
        <p
          style={{
            fontSize: 12.5,
            color: "var(--gr-text-mute)",
            textAlign: "center",
            lineHeight: 1.55,
            margin: 0,
            maxWidth: 240,
          }}
        >
          {trades.length === 0
            ? "No closed round-trips in this window for this account yet."
            : "Curve appears once at least 2 round-trips have closed in this window."}
        </p>
      </div>
    );
  }

  // Build the cumulative realized-P&L series from real trades only.  The
  // source array is newest-first, so sort chronologically and accumulate.
  // Every chart point is a real closed round-trip — no values are invented.
  const chrono = [...trades].sort(
    (a, b) => a.closedAt.getTime() - b.closedAt.getTime(),
  );
  let cum = 0;
  const data: ChartPoint[] = chrono.map((t) => {
    cum += t.pnl;
    return { t: t.closedAt.getTime(), pnl: Number(cum.toFixed(2)) };
  });

  const finalY = data[data.length - 1]!.pnl;
  const positive = finalY >= 0;
  const lineColor = positive ? colors.ok : colors.bad;

  // Minimal date ticks: first / middle / last (deduped when the window spans a
  // single day).  These are axis labels derived from real trade timestamps.
  const tickVals = Array.from(
    new Set([
      data[0]!.t,
      data[Math.floor((data.length - 1) / 2)]!.t,
      data[data.length - 1]!.t,
    ]),
  );
  const fmtTick = (ts: number) =>
    new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const minPnl = Math.min(...data.map((d) => d.pnl));
  const maxPnl = Math.max(...data.map((d) => d.pnl));
  const crossesZero = minPnl < 0 && maxPnl > 0;

  return (
    <div
      style={{
        flex: 1,
        minHeight: 110,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <span
          style={{
            fontSize: 26,
            fontWeight: 600,
            fontFamily: "var(--font-ibm-plex-mono, monospace)",
            color: positive ? "var(--gr-ok)" : "var(--gr-bad)",
            letterSpacing: "-0.02em",
          }}
        >
          {fmt$(finalY)}
        </span>
        <span style={{ fontSize: 11.5, color: "var(--gr-text-mute)" }}>
          {trades.length} trade{trades.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div style={{ width: "100%", height: 140 }}>
        {mounted && (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 6 }}>
            <defs>
              <linearGradient id="equityAreaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={lineColor} stopOpacity={0.18} />
                <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              stroke={colors.border}
              strokeOpacity={0.5}
              strokeDasharray="2 5"
            />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              ticks={tickVals}
              tickFormatter={fmtTick}
              tick={{ fontSize: 10, fill: colors.textFaint }}
              tickLine={false}
              axisLine={false}
              minTickGap={20}
            />
            <YAxis hide domain={["auto", "auto"]} />
            {crossesZero && (
              <ReferenceLine y={0} stroke={colors.border} strokeDasharray="3 2" />
            )}
            <Tooltip
              content={<EquityTooltip colors={colors} />}
              cursor={{ stroke: colors.border, strokeWidth: 1 }}
            />
            <Area
              type="monotone"
              dataKey="pnl"
              stroke={lineColor}
              strokeWidth={2}
              fill="url(#equityAreaFill)"
              dot={false}
              activeDot={{ r: 3, strokeWidth: 0, fill: lineColor }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
