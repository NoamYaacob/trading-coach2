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

  // Monotone cubic interpolation (Fritsch–Carlson).  Unlike a naive bezier
  // smoothing, this guarantees the curve never overshoots the data: between
  // any two real points the line stays within their value range, so it can
  // never imply a P&L direction the trades didn't actually take.  Where the
  // slope reverses (a peak or trough) the tangent is flattened, and for two
  // points or a flat run it degrades to a clean straight segment.  No
  // intermediate values are invented — the curve only passes through the real
  // cumulative-P&L points computed above.
  const monotonePath = (pts: typeof points): string => {
    const c = pts.map((p) => ({ x: sx(p.x), y: sy(p.y) }));
    const n = c.length;
    if (n === 0) return "";
    if (n === 1) return `M${c[0]!.x.toFixed(1)},${c[0]!.y.toFixed(1)}`;

    // Secant slopes between consecutive points (in screen space).
    const dxs: number[] = [];
    const slope: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const ddx = c[i + 1]!.x - c[i]!.x;
      const ddy = c[i + 1]!.y - c[i]!.y;
      dxs.push(ddx);
      slope.push(ddx === 0 ? 0 : ddy / ddx);
    }

    // Tangents per point: average of neighbouring slopes, flattened to zero
    // wherever the direction reverses so the curve cannot bulge past a peak.
    const m: number[] = new Array(n).fill(0);
    m[0] = slope[0]!;
    m[n - 1] = slope[n - 2]!;
    for (let i = 1; i < n - 1; i++) {
      const s0 = slope[i - 1]!;
      const s1 = slope[i]!;
      m[i] = s0 * s1 <= 0 ? 0 : (s0 + s1) / 2;
    }

    // Fritsch–Carlson clamp: keep each segment monotone (no overshoot).
    for (let i = 0; i < n - 1; i++) {
      if (slope[i] === 0) {
        m[i] = 0;
        m[i + 1] = 0;
        continue;
      }
      const a = m[i]! / slope[i]!;
      const b = m[i + 1]! / slope[i]!;
      const h = a * a + b * b;
      if (h > 9) {
        const t = 3 / Math.sqrt(h);
        m[i] = t * a * slope[i]!;
        m[i + 1] = t * b * slope[i]!;
      }
    }

    // Emit cubic bezier segments from the Hermite tangents.
    let d = `M${c[0]!.x.toFixed(1)},${c[0]!.y.toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const cp1x = c[i]!.x + dxs[i]! / 3;
      const cp1y = c[i]!.y + (m[i]! * dxs[i]!) / 3;
      const cp2x = c[i + 1]!.x - dxs[i]! / 3;
      const cp2y = c[i + 1]!.y - (m[i + 1]! * dxs[i]!) / 3;
      d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${c[i + 1]!.x.toFixed(1)},${c[i + 1]!.y.toFixed(1)}`;
    }
    return d;
  };

  const linePath = monotonePath(points);
  const fillPath = `${linePath} L${sx(points[points.length - 1]!.x).toFixed(1)},${H} L${sx(points[0]!.x).toFixed(1)},${H} Z`;
  const finalY = points[points.length - 1]!.y;
  const lineColor = finalY >= 0 ? "var(--gr-ok)" : "var(--gr-bad)";

  // Honest date-axis labels derived from the real first/last trade timestamps
  // in this window (axis ticks, not invented data points).  Collapses to a
  // single centred label when every trade closed on the same calendar day.
  const fmtAxisDate = (ts: number) =>
    new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const axisTicks = Array.from(
    new Set([fmtAxisDate(tMin), fmtAxisDate((tMin + tMax) / 2), fmtAxisDate(tMax)]),
  );

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
        style={{ width: "100%", height: 120 }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="equityGradFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={finalY >= 0 ? "var(--gr-ok)" : "var(--gr-bad)"} stopOpacity="0.12" />
            <stop offset="100%" stopColor={finalY >= 0 ? "var(--gr-ok)" : "var(--gr-bad)"} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Very faint horizontal guide lines */}
        {[0.25, 0.5, 0.75].map((frac) => (
          <line
            key={frac}
            x1={0} x2={W}
            y1={frac * H} y2={frac * H}
            stroke="var(--gr-border)"
            strokeWidth="0.3"
            strokeDasharray="2 5"
          />
        ))}
        {/* Zero baseline when curve crosses zero */}
        {cumMin < 0 && cumMax > 0 && (
          <line
            x1={0} x2={W}
            y1={sy(0)} y2={sy(0)}
            stroke="var(--gr-border)"
            strokeWidth="0.6"
            strokeDasharray="3 2"
          />
        )}
        {/* Soft fill under the smooth curve */}
        <path d={fillPath} fill="url(#equityGradFill)" />
        {/* Smooth main line — thin and calm */}
        <path
          d={linePath}
          stroke={lineColor}
          strokeWidth="1.5"
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Subtle endpoint dot */}
        <circle
          cx={sx(points[points.length - 1]!.x)}
          cy={sy(points[points.length - 1]!.y)}
          r="1.8"
          fill={lineColor}
          stroke="var(--gr-surface)"
          strokeWidth="1.2"
        />
      </svg>
      {/* Honest date axis from the real trade timestamps in this window. */}
      <div
        style={{
          display: "flex",
          justifyContent: axisTicks.length === 1 ? "center" : "space-between",
          fontSize: 10,
          color: "var(--gr-text-faint)",
          letterSpacing: "0.02em",
          marginTop: -2,
        }}
      >
        {axisTicks.map((label, i) => (
          <span key={`${label}-${i}`}>{label}</span>
        ))}
      </div>
    </div>
  );
}
