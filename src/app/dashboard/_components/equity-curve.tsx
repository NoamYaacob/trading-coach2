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

type Timeframe = "7d" | "30d" | "all";

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
  const days = tf === "7d" ? 7 : 30;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return trades.filter((t) => t.closedAt.getTime() >= cutoff);
}

export function EquityCurve({ trades, tradesHref, dataSourceLabel }: Props) {
  const [timeframe, setTimeframe] = React.useState<Timeframe>("30d");
  const windowTrades = React.useMemo(
    () => filterByTimeframe(trades, timeframe),
    [trades, timeframe],
  );

  const toggleButton = (tf: Timeframe, label: string) => {
    const active = tf === timeframe;
    return (
      <button
        key={tf}
        type="button"
        onClick={() => setTimeframe(tf)}
        aria-pressed={active}
        style={{
          padding: "3px 9px",
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 600,
          border: `1px solid ${active ? "var(--gr-copper)" : "var(--gr-border)"}`,
          background: active ? "var(--gr-copper-bg)" : "transparent",
          color: active ? "var(--gr-copper)" : "var(--gr-text-mid)",
          cursor: "pointer",
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <div
      style={{
        background: "var(--gr-bg-elev)",
        border: "1px solid var(--gr-border)",
        borderRadius: 14,
        padding: 22,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 12,
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <div>
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--gr-ink)" }}>
            Equity curve
          </span>
          <div
            style={{
              fontSize: 11.5,
              color: "var(--gr-text-mute)",
              marginTop: 2,
            }}
          >
            Cumulative realized P&amp;L · {dataSourceLabel}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {toggleButton("7d", "7D")}
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
              marginLeft: 4,
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
          minHeight: 100,
          borderRadius: 8,
          border: "1px dashed var(--gr-border)",
          background: "var(--gr-surface)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          padding: 24,
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
        minHeight: 100,
        display: "flex",
        flexDirection: "column",
        gap: 8,
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
            fontSize: 22,
            fontWeight: 600,
            fontFamily: "var(--font-ibm-plex-mono, monospace)",
            color: finalY >= 0 ? "var(--gr-ok)" : "var(--gr-bad)",
          }}
        >
          {fmt$(finalY)}
        </span>
        <span style={{ fontSize: 11, color: "var(--gr-text-mute)" }}>
          {trades.length} trade{trades.length !== 1 ? "s" : ""}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: 80 }}
        aria-hidden="true"
      >
        {cumMin < 0 && cumMax > 0 && (
          <line
            x1={0}
            x2={W}
            y1={sy(0)}
            y2={sy(0)}
            stroke="var(--gr-border)"
            strokeWidth="0.5"
            strokeDasharray="2 2"
          />
        )}
        <path
          d={pathPoints}
          stroke={lineColor}
          strokeWidth="1.2"
          fill="none"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
