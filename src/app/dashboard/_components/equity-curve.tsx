"use client";

/**
 * Equity-curve client island.
 *
 * Renders cumulative realized P&L over a user-selected timeframe (7D / 30D /
 * All).  The component is intentionally client-only because the timeframe
 * toggle is local UI state that must not round-trip to the server (and must
 * not invalidate the dashboard's data).  The dashboard already loads the
 * last 30 days of round-trips for the selected account; this component just
 * filters that array down further per the toggle.
 *
 * Honest empty-state behaviour:
 *   - fewer than 2 trades in the selected window → faint baseline + message
 *   - no trades at all → "No closed round-trips" copy
 * No fake or generated curves are ever drawn.
 *
 * Visual conventions match the previous inline equity panel exactly:
 *   - var(--gr-ok) when ending cumulative ≥ 0
 *   - var(--gr-bad) when ending cumulative < 0
 *   - dashed zero baseline when the curve crosses zero
 */

import * as React from "react";
import Link from "next/link";

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

function EquityCurveBody({ trades }: { trades: RoundTripTrade[] }) {
  if (trades.length < 2) {
    return (
      <div
        style={{
          flex: 1,
          minHeight: 80,
          borderRadius: 8,
          border: "1px dashed var(--gr-border)",
          background: "var(--gr-surface)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: "16px 24px",
        }}
      >
        <svg width="64" height="28" viewBox="0 0 64 28" fill="none" aria-hidden="true">
          <polyline
            points="0,22 10,18 20,20 30,12 38,14 50,6 64,10"
            stroke="var(--gr-border)"
            strokeWidth="1.5"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
        <p
          style={{
            fontSize: 12.5,
            color: "var(--gr-text-mute)",
            textAlign: "center",
            lineHeight: 1.5,
            margin: 0,
          }}
        >
          {trades.length === 0
            ? "No closed round-trips in this window for this account."
            : "Curve appears once at least 2 round-trips have closed in the window."}
        </p>
      </div>
    );
  }

  // Sort chronologically (the source array is newest-first).
  const chrono = [...trades].sort(
    (a, b) => a.closedAt.getTime() - b.closedAt.getTime(),
  );
  let cum = 0;
  const points: { x: number; y: number }[] = [];
  const tMin = chrono[0]!.closedAt.getTime();
  const tMax = chrono[chrono.length - 1]!.closedAt.getTime();
  const tRange = Math.max(1, tMax - tMin);
  for (const t of chrono) {
    cum += t.pnl;
    points.push({ x: (t.closedAt.getTime() - tMin) / tRange, y: cum });
  }
  const cumMin = Math.min(0, ...points.map((p) => p.y));
  const cumMax = Math.max(0, ...points.map((p) => p.y));
  const yRange = Math.max(1, cumMax - cumMin);
  const W = 100;
  const H = 40;
  const sx = (x: number) => x * W;
  const sy = (y: number) => H - ((y - cumMin) / yRange) * H;
  const pathPoints = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(2)},${sy(p.y).toFixed(2)}`)
    .join(" ");
  const finalY = points[points.length - 1]!.y;
  const lineColor = finalY >= 0 ? "var(--gr-ok)" : "var(--gr-bad)";

  return (
    <div
      style={{
        flex: 1,
        minHeight: 120,
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
            fontWeight: 700,
            fontFamily: "var(--font-ibm-plex-mono, monospace)",
            color: finalY >= 0 ? "var(--gr-ok)" : "var(--gr-bad)",
            letterSpacing: "-0.02em",
          }}
        >
          {fmt$(finalY)}
        </span>
        <span style={{ fontSize: 11.5, color: "var(--gr-text-mute)" }}>
          {trades.length} trade{trades.length !== 1 ? "s" : ""}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: 130 }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="equityGradFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={finalY >= 0 ? "var(--gr-ok)" : "var(--gr-bad)"} stopOpacity="0.25" />
            <stop offset="100%" stopColor={finalY >= 0 ? "var(--gr-ok)" : "var(--gr-bad)"} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Faint horizontal grid lines */}
        {[0.25, 0.5, 0.75].map((frac) => (
          <line
            key={frac}
            x1={0} x2={W}
            y1={frac * H} y2={frac * H}
            stroke="var(--gr-border)"
            strokeWidth="0.5"
            strokeDasharray="2 4"
          />
        ))}
        {/* Zero baseline when curve crosses zero */}
        {cumMin < 0 && cumMax > 0 && (
          <line
            x1={0} x2={W}
            y1={sy(0)} y2={sy(0)}
            stroke="var(--gr-border)"
            strokeWidth="0.9"
            strokeDasharray="3 2"
          />
        )}
        {/* Fill under the line */}
        <path
          d={`${pathPoints} L${sx(points[points.length - 1]!.x).toFixed(2)},${H} L${sx(points[0]!.x).toFixed(2)},${H} Z`}
          fill="url(#equityGradFill)"
        />
        {/* Main line */}
        <path
          d={pathPoints}
          stroke={lineColor}
          strokeWidth="2.5"
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Endpoint dot */}
        <circle
          cx={sx(points[points.length - 1]!.x)}
          cy={sy(points[points.length - 1]!.y)}
          r="2.5"
          fill={lineColor}
          stroke="var(--gr-surface)"
          strokeWidth="1.5"
        />
      </svg>
    </div>
  );
}
