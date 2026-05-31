"use client";

/**
 * Equity-curve client island.
 *
 * Renders cumulative realized P&L over a user-selected timeframe (7D / 14D /
 * 30D / All) as a TradingView Lightweight Charts area series.  The component is
 * intentionally client-only: the chart needs the DOM (canvas + measured width)
 * and the timeframe toggle is local UI state that must not round-trip to the
 * server (and must not invalidate the dashboard's data).  The dashboard already
 * loads the last 30 days of round-trips for the selected account; this component
 * just filters that array down further per the toggle.
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
  createChart,
  AreaSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type AreaData,
} from "lightweight-charts";

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

// Guardrail design tokens resolved to concrete colours for the chart canvas.
// CSS var() is not honoured inside the chart's canvas drawing, so we read the
// computed values from :root on mount, with the globals.css hex values as the
// first-paint / SSR fallback.
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
// the client.  Lightweight Charts measures its container at runtime and draws to
// a canvas, so the chart is only created after mount — this guarantees we never
// SSR-render the canvas, while a same-height placeholder keeps the card layout
// stable (no content shift).
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

// Converts a #rrggbb token to an rgba() string at the requested alpha so the
// area gradient can fade the same hue as the line.
function rgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full =
    h.length === 3
      ? h.split("").map((c) => c + c).join("")
      : h.padEnd(6, "0").slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
      <LightweightEquityChart data={data} colors={colors} positive={positive} mounted={mounted} />
    </div>
  );
}

// Renders the cumulative-P&L series with TradingView Lightweight Charts.  The
// chart is created inside useEffect (client only — never SSR) against a ref'd
// container, sized via ResizeObserver, and torn down on unmount / data change.
function LightweightEquityChart({
  data,
  colors,
  positive,
  mounted,
}: {
  data: ChartPoint[];
  colors: TokenColors;
  positive: boolean;
  mounted: boolean;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const tooltipRef = React.useRef<HTMLDivElement | null>(null);
  const CHART_HEIGHT = 230;

  React.useEffect(() => {
    const container = containerRef.current;
    const tooltipEl = tooltipRef.current;
    if (!container || !mounted) return;

    const lineColor = positive ? colors.ok : colors.bad;

    const chart: IChartApi = createChart(container, {
      width: container.clientWidth,
      height: CHART_HEIGHT,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: colors.textMute,
        fontFamily:
          "var(--font-inter, system-ui, -apple-system, sans-serif)",
        attributionLogo: false,
      },
      // Soft horizontal grid only — no vertical clutter.
      grid: {
        horzLines: { color: colors.border, style: LineStyle.Dotted, visible: true },
        vertLines: { visible: false },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.18, bottom: 0.12 },
      },
      leftPriceScale: { visible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: false,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: {
          color: colors.border,
          width: 1,
          style: LineStyle.Solid,
          labelVisible: false,
        },
        horzLine: {
          color: colors.border,
          width: 1,
          style: LineStyle.Dashed,
          labelVisible: false,
        },
      },
      handleScroll: false,
      handleScale: false,
    });

    const series: ISeriesApi<"Area"> = chart.addSeries(AreaSeries, {
      lineColor,
      topColor: rgba(lineColor, 0.18),
      bottomColor: rgba(lineColor, 0),
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerRadius: 3,
      crosshairMarkerBorderWidth: 0,
      crosshairMarkerBackgroundColor: lineColor,
    });

    // Convert to Lightweight Charts area data.  Times must be unique and
    // strictly ascending: collapse any trades that close within the same second
    // to that second's final cumulative value (last write wins, chronological).
    const bySecond = new Map<number, number>();
    for (const p of data) {
      bySecond.set(Math.floor(p.t / 1000), p.pnl);
    }
    const chartData: AreaData<UTCTimestamp>[] = [...bySecond.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([sec, value]) => ({ time: sec as UTCTimestamp, value }));

    series.setData(chartData);
    chart.timeScale().fitContent();

    // Minimal crosshair tooltip: date + cumulative realized P&L.
    const fmtTip = (v: number) =>
      `${v >= 0 ? "+" : "−"}$${Math.abs(v).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    chart.subscribeCrosshairMove((param) => {
      if (!tooltipEl) return;
      const point = param.point;
      if (
        !point ||
        param.time === undefined ||
        point.x < 0 ||
        point.x > container.clientWidth ||
        point.y < 0 ||
        point.y > CHART_HEIGHT
      ) {
        tooltipEl.style.opacity = "0";
        return;
      }
      const priceData = param.seriesData.get(series) as
        | { value?: number }
        | undefined;
      const value = priceData?.value;
      if (value === undefined) {
        tooltipEl.style.opacity = "0";
        return;
      }
      const ts = (param.time as number) * 1000;
      tooltipEl.innerHTML = `<div style="color:${colors.textMute};margin-bottom:3px">${fmtTooltipDate(
        ts,
      )}</div><div style="font-family:var(--font-ibm-plex-mono, monospace);font-weight:600;color:${
        value >= 0 ? colors.ok : colors.bad
      }">${fmtTip(value)}</div><div style="color:${colors.textFaint};font-size:10.5px;margin-top:2px">Cumulative realized P&amp;L</div>`;
      tooltipEl.style.opacity = "1";
      // Keep the tooltip inside the container horizontally.
      const tipW = 150;
      let left = point.x + 14;
      if (left + tipW > container.clientWidth) left = point.x - tipW - 14;
      if (left < 0) left = 4;
      tooltipEl.style.left = `${left}px`;
      tooltipEl.style.top = `8px`;
    });

    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) {
        chart.applyOptions({ width: Math.floor(w) });
        chart.timeScale().fitContent();
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data, colors, positive, mounted]);

  return (
    <div style={{ position: "relative", width: "100%", height: CHART_HEIGHT }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      <div
        ref={tooltipRef}
        style={{
          position: "absolute",
          opacity: 0,
          pointerEvents: "none",
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 8,
          padding: "8px 10px",
          boxShadow: "0 4px 14px rgba(0,0,0,0.10)",
          fontSize: 12,
          lineHeight: 1.4,
          transition: "opacity 0.08s",
          zIndex: 3,
          whiteSpace: "nowrap",
        }}
      />
    </div>
  );
}
