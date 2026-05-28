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

  it("renders honest 'no data' fallback below 2 trades", () => {
    assert.ok(
      file.includes("trades.length < 2"),
      "must short-circuit to the empty-state placeholder when fewer than 2 trades are in the window",
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
      file.includes("Showing only the last 30 days of synced fills"),
      "calendar must show the honest 30-day-window caveat when viewing past months",
    );
    assert.ok(
      file.includes("isViewingPast"),
      "calendar must compute an isViewingPast flag to gate the caveat",
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
      file.includes("Biggest win today"),
      "must render a 'Biggest win today' card label",
    );
    assert.ok(
      file.includes("Biggest loss today"),
      "must render a 'Biggest loss today' card label",
    );
  });

  it("uses the pure insights helpers", () => {
    assert.ok(
      file.includes("profitFactor") && file.includes("maxDrawdown"),
      "must call the profitFactor + maxDrawdown helpers from ./insights",
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

  it("imports EquityCurve, PnlCalendar, and TraderInsights", () => {
    assert.ok(
      page.includes("EquityCurve"),
      "dashboard must import + render <EquityCurve />",
    );
    assert.ok(
      page.includes("PnlCalendar"),
      "dashboard must import + render <PnlCalendar />",
    );
    assert.ok(
      page.includes("TraderInsights"),
      "dashboard must import + render <TraderInsights />",
    );
  });

  it("passes the per-account recentTrades into all three components", () => {
    assert.ok(
      /<EquityCurve[^>]*trades=\{recentTrades\}/s.test(page),
      "EquityCurve must receive the per-account recentTrades array",
    );
    assert.ok(
      /<PnlCalendar[^>]*trades=\{recentTrades\}/s.test(page),
      "PnlCalendar must receive the per-account recentTrades array",
    );
    assert.ok(
      /<TraderInsights[^>]*recentTrades=\{recentTrades\}/s.test(page),
      "TraderInsights must receive the per-account recentTrades array",
    );
  });
});
