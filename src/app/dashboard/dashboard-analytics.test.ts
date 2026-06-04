/**
 * Source-scan contract tests for the dashboard analytics components added in
 * PR B (chart timeframes, calendar improvements, expanded trader insights).
 *
 * These tests do not import the React components themselves — they read the
 * source files and assert that the expected behaviours are wired in.  Pairs
 * with the unit tests in `_components/insights.test.ts` which exercise the
 * pure helpers behind the trader insights.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), "src");
function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

describe("EquityCurve client island", () => {
  const file = read("app/dashboard/_components/equity-curve.tsx");

  it("declares itself a client component", () => {
    assert.ok(
      file.startsWith('"use client"') || file.includes('"use client";'),
      "equity-curve.tsx must opt into the client runtime with \"use client\"",
    );
  });

  it("exposes 7D / 30D / All timeframe toggles", () => {
    assert.ok(file.includes("\"7d\""), "must support a 7d timeframe state");
    assert.ok(file.includes("\"30d\""), "must support a 30d timeframe state");
    assert.ok(file.includes("\"all\""), "must support an all timeframe state");
    // The visible toggle labels:
    assert.ok(file.includes("\"7D\""), "must render a 7D toggle label");
    assert.ok(file.includes("\"30D\""), "must render a 30D toggle label");
    assert.ok(file.includes("\"All\""), "must render an All toggle label");
  });

  it("uses React state for the timeframe selection", () => {
    assert.ok(
      file.includes("useState"),
      "timeframe toggle must be backed by React.useState (not derived prop)",
    );
  });

  it("renders honest 'no data' fallback below 2 trading days", () => {
    assert.ok(
      file.includes("series.points.length < 2"),
      "must short-circuit to the empty-state placeholder when fewer than 2 trading days are in the window",
    );
    assert.ok(
      file.includes("No closed round-trips"),
      "empty-state copy must be honest about there being no trades",
    );
  });
});

describe("PnlCalendar client island", () => {
  const file = read("app/dashboard/_components/pnl-calendar.tsx");

  it("declares itself a client component", () => {
    assert.ok(
      file.startsWith('"use client"') || file.includes('"use client";'),
      "pnl-calendar.tsx must opt into the client runtime with \"use client\"",
    );
  });

  it("supports month navigation via monthOffset state", () => {
    assert.ok(
      file.includes("monthOffset"),
      "calendar must track a monthOffset state",
    );
    assert.ok(
      file.includes("setMonthOffset"),
      "calendar must expose a setMonthOffset updater",
    );
    // Prev/next buttons:
    assert.ok(
      file.includes("Previous month") || file.includes("◀"),
      "calendar must include a previous-month button",
    );
    assert.ok(
      file.includes("Next month") || file.includes("▶"),
      "calendar must include a next-month button",
    );
  });

  it("disables the next-month button when viewing the current month", () => {
    assert.ok(
      file.includes("isCurrentMonth"),
      "calendar must compute an isCurrentMonth flag",
    );
    assert.ok(
      /disabled=\{isCurrentMonth\}/.test(file),
      "next-month button must be disabled at monthOffset 0",
    );
  });

  it("shows the historical-data caveat when viewing a past month", () => {
    assert.ok(
      file.includes("Broker Account Balance History is temporarily unavailable"),
      "calendar must show the honest ABH-unavailable caveat when viewing past months in a degraded state",
    );
    assert.ok(
      file.includes("isViewingPast"),
      "calendar must compute an isViewingPast flag to gate the caveat",
    );
    assert.ok(
      /brokerSource !== "account-balance-history"/.test(file),
      "caveat must be suppressed when ABH is the source (full broker-net coverage)",
    );
  });

  it("aggregates trades into a per-day dayMap using en-CA timezone keys", () => {
    assert.ok(file.includes("dayMap"), "calendar must build a dayMap of trades");
    assert.ok(
      file.includes('"en-CA"'),
      "calendar must use en-CA timezone-aware date keys for bucketing",
    );
  });
});

describe("TraderInsights server panel", () => {
  const file = read("app/dashboard/_components/trader-insights.tsx");

  it("is NOT a client component (renders on the server)", () => {
    assert.ok(
      !file.startsWith('"use client"') && !file.includes('"use client";'),
      "trader-insights.tsx must remain a server component (no 'use client')",
    );
  });

  it("renders profit factor and max drawdown labels", () => {
    assert.ok(
      file.includes("Profit factor (30d)"),
      "must render a 'Profit factor (30d)' card label",
    );
    assert.ok(
      file.includes("Max drawdown (30d)"),
      "must render a 'Max drawdown (30d)' card label",
    );
  });

  it("renders biggest win / biggest loss labels", () => {
    assert.ok(
      file.includes("Biggest win this session"),
      "must render a 'Biggest win this session' card label",
    );
    assert.ok(
      file.includes("Biggest loss this session"),
      "must render a 'Biggest loss this session' card label",
    );
  });

  it("uses the pure insights + daily-pnl helpers", () => {
    assert.ok(
      file.includes("profitFactor") && file.includes("dailyMaxDrawdown"),
      "must call profitFactor (fill-based) + dailyMaxDrawdown (broker-net-aware) helpers",
    );
    assert.ok(
      file.includes("biggestWin") && file.includes("biggestLoss"),
      "must call the biggestWin + biggestLoss helpers from ./insights",
    );
  });

  it("renders empty-state copy when stats lack data", () => {
    assert.ok(
      file.includes("No daily-loss rule configured"),
      "must show honest empty state for daily loss when no rule is set",
    );
    assert.ok(
      file.includes("No round-trips in window"),
      "must show honest empty state for 30d stats when there are no trades",
    );
  });
});

describe("/dashboard page wires the new analytics components", () => {
  const page = read("app/dashboard/page.tsx");
  // The ABH-dependent widgets now load OFF the blocking render path: the page
  // renders async Suspense section wrappers, and the wrappers (broker-sections)
  // render the underlying client components with the resolved ABH data.
  const sections = read("app/dashboard/_components/broker-sections.tsx");

  it("renders the ABH-streaming sections (EquityCurve/PnlCalendar/TraderInsights wrappers)", () => {
    assert.ok(page.includes("EquityCurveSection"), "dashboard must render <EquityCurveSection /> behind Suspense");
    assert.ok(page.includes("PnlCalendarSection"), "dashboard must render <PnlCalendarSection /> behind Suspense");
    assert.ok(page.includes("TraderInsightsSection"), "dashboard must render <TraderInsightsSection /> behind Suspense");
    assert.ok(page.includes("<Suspense"), "dashboard must wrap ABH widgets in <Suspense> so the shell paints first");
    assert.ok(
      sections.includes("EquityCurve") && sections.includes("PnlCalendar") && sections.includes("TraderInsights"),
      "broker-sections must render the underlying EquityCurve / PnlCalendar / TraderInsights",
    );
  });

  it("passes the per-account recentTrades through the sections into all three components", () => {
    assert.ok(
      /recentTrades=\{recentTrades\}/.test(page),
      "page must pass the per-account recentTrades into the ABH sections",
    );
    assert.ok(
      /<EquityCurve[^>]*trades=\{recentTrades\}/s.test(sections),
      "EquityCurve must receive the per-account recentTrades array",
    );
    assert.ok(
      /<PnlCalendar[^>]*trades=\{recentTrades\}/s.test(sections),
      "PnlCalendar must receive the per-account recentTrades array",
    );
    assert.ok(
      /<TraderInsights[^>]*recentTrades=\{recentTrades\}/s.test(sections),
      "TraderInsights must receive the per-account recentTrades array",
    );
  });
});

describe("Dashboard profit factor KPI — source-aware label", () => {
  // Moved into the streamed ABH KPI cards section.
  const sections = read("app/dashboard/_components/broker-sections.tsx");

  it("imports brokerSourceLabel from broker-account-performance", () => {
    assert.ok(
      sections.includes("brokerSourceLabel"),
      "broker-sections must import brokerSourceLabel for source-aware profit factor sub-label",
    );
  });

  it("profit factor sub does NOT hardcode 'broker Cash History'", () => {
    assert.ok(
      !sections.includes("broker Cash History"),
      "profit factor sub must not hardcode 'broker Cash History' — use brokerSourceLabel()",
    );
  });

  it("profit factor sub uses brokerSourceLabel(brokerPerformance.source) for honest wording", () => {
    assert.ok(
      sections.includes("brokerSourceLabel(brokerPerformance.source)"),
      "profit factor sub must call brokerSourceLabel(brokerPerformance.source) to get source-aware label",
    );
  });
});

describe("Equity curve — single broker day empty state", () => {
  const src = read("app/dashboard/_components/equity-curve.tsx");

  it("broker-native single-day state guides user toward a wider window", () => {
    assert.ok(
      src.includes("Only") && (src.includes("30D") || src.includes("All")),
      "single broker-day empty state must mention 30D or All to guide the user",
    );
    assert.ok(
      src.includes("broker day"),
      "single broker-day empty state must mention 'broker day' so it is clearly source-aware",
    );
  });

  it("fill-based curve still shows the old 'at least 2 trading days' message", () => {
    assert.ok(
      src.includes("Curve appears once at least 2 trading days have closed in this window"),
      "fill-based empty state must still show the 'at least 2 trading days' message",
    );
  });

  it("broker-native zero-day state says 'No broker days' (not 'cash history days')", () => {
    assert.ok(
      src.includes("No broker days in this window for this account yet"),
      "zero-day broker-native state must say 'No broker days' — not hardcode 'cash history'",
    );
    assert.ok(
      !src.includes("No broker cash history days"),
      "must not say 'No broker cash history days' — 'Cash History' is a specific source, not all broker sources",
    );
  });
});
