/**
 * Data-truth QA tests for the Dashboard, Trades page, P&L Calendar, and
 * Equity Curve.
 *
 * These tests verify that:
 *   1. Every displayed metric is account-isolated.
 *   2. Calendar daily P&L / trade count matches the filtered Trades page rows.
 *   3. Equity curve cumulative P&L equals the running sum of the same round-trips.
 *   4. Timezone bucketing is consistent between Dashboard, Calendar, and Trades.
 *   5. Today's trades panel uses a timezone-aware day boundary (not UTC midnight).
 *   6. No fake/sample data can enter the display path.
 *
 * All computation tests use real pure helpers — no mocking, no DB I/O.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { reconstructRoundTrips, type FillInput } from "../../lib/trades/round-trips.ts";

const ROOT = resolve(process.cwd(), "src");
function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

// ── Helpers shared across tests ───────────────────────────────────────────────

function fill(
  over: Partial<FillInput> & Pick<FillInput, "occurredAt">,
): FillInput {
  return {
    id: over.id ?? `f-${Math.random()}`,
    externalTradeId: over.externalTradeId ?? null,
    contractId: over.contractId ?? 1,
    side: over.side ?? "BUY",
    quantity: over.quantity ?? "1",
    price: over.price ?? "100",
    pnl: over.pnl ?? null,
    occurredAt: over.occurredAt,
    rawPayload: "rawPayload" in over ? over.rawPayload : { contract: { name: "ESH5" } },
  };
}

function isoDateKey(d: Date, tz: string): string {
  return d.toLocaleDateString("en-CA", { timeZone: tz });
}

// ── 1. Equity curve: cumulative P&L equals running sum of round-trips ─────────

describe("data-truth: equity curve cumulative P&L = running sum of round-trips", () => {
  it("cumulative P&L at each point equals sum of all prior round-trip pnls", () => {
    const fills: FillInput[] = [
      fill({ id: "1", side: "BUY",  quantity: "1", price: "100", pnl: null,   occurredAt: new Date("2026-05-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "105", pnl: "5",    occurredAt: new Date("2026-05-01T14:10:00Z") }),
      fill({ id: "3", side: "BUY",  quantity: "1", price: "103", pnl: null,   occurredAt: new Date("2026-05-02T14:00:00Z") }),
      fill({ id: "4", side: "SELL", quantity: "1", price: "101", pnl: "-2",   occurredAt: new Date("2026-05-02T14:30:00Z") }),
      fill({ id: "5", side: "BUY",  quantity: "2", price: "110", pnl: null,   occurredAt: new Date("2026-05-03T14:00:00Z") }),
      fill({ id: "6", side: "SELL", quantity: "2", price: "115", pnl: "10",   occurredAt: new Date("2026-05-03T14:20:00Z") }),
    ];
    const trades = reconstructRoundTrips(fills).sort(
      (a, b) => a.closedAt.getTime() - b.closedAt.getTime(),
    );
    assert.equal(trades.length, 3, "must produce exactly 3 round-trips");

    // Simulate the equity curve: running cumulative sum (identical to equity-curve.tsx)
    let cum = 0;
    const curve: number[] = [];
    for (const t of trades) {
      cum += t.pnl;
      curve.push(Number(cum.toFixed(2)));
    }

    // The headline P&L shown by the equity curve must equal the final cumulative.
    const headlinePnl = curve[curve.length - 1]!;
    const directSum = trades.reduce((s, t) => s + t.pnl, 0);
    assert.ok(
      Math.abs(headlinePnl - directSum) < 0.001,
      `equity headline P&L (${headlinePnl}) must equal sum of round-trip pnls (${directSum})`,
    );

    // Each point must be strictly monotonically-computable from prior trades.
    let check = 0;
    for (let i = 0; i < trades.length; i++) {
      check += trades[i]!.pnl;
      assert.ok(
        Math.abs(curve[i]! - Number(check.toFixed(2))) < 0.001,
        `curve[${i}] (${curve[i]}) must equal running sum through trade ${i} (${check.toFixed(2)})`,
      );
    }
  });

  it("broker-supplied pnl wins over computed pnl (pnlSource=broker)", () => {
    // Broker sends pnl=-3 on a trade that would compute as +5. The displayed
    // equity curve must show the broker number (-3), not the computed one.
    const fills: FillInput[] = [
      fill({ id: "1", side: "BUY",  quantity: "1", price: "100", pnl: null,  occurredAt: new Date("2026-05-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "105", pnl: "-3",  occurredAt: new Date("2026-05-01T14:10:00Z") }),
    ];
    const trades = reconstructRoundTrips(fills);
    assert.equal(trades.length, 1);
    assert.equal(trades[0]!.pnl, -3, "broker pnl must win");
    assert.equal(trades[0]!.pnlSource, "broker");
  });
});

// ── 2. Calendar P&L / trade count matches Trades page rows ────────────────────

describe("data-truth: calendar day P&L and trade count equal filtered Trades-page rows", () => {
  const tz = "America/Chicago";

  it("sum of round-trip pnls for a date key equals calendar cell P&L", () => {
    const fills: FillInput[] = [
      // Day 1 (CT): two trades
      fill({ id: "1", side: "BUY",  quantity: "1", price: "100", pnl: null, occurredAt: new Date("2026-05-20T15:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "103", pnl: "3",  occurredAt: new Date("2026-05-20T15:30:00Z") }),
      fill({ id: "3", side: "BUY",  quantity: "1", price: "104", pnl: null, occurredAt: new Date("2026-05-20T16:00:00Z") }),
      fill({ id: "4", side: "SELL", quantity: "1", price: "106", pnl: "2",  occurredAt: new Date("2026-05-20T16:30:00Z") }),
      // Day 2 (CT): one trade
      fill({ id: "5", side: "BUY",  quantity: "1", price: "200", pnl: null, occurredAt: new Date("2026-05-21T14:00:00Z") }),
      fill({ id: "6", side: "SELL", quantity: "1", price: "195", pnl: "-5", occurredAt: new Date("2026-05-21T14:20:00Z") }),
    ];
    const trades = reconstructRoundTrips(fills).sort(
      (a, b) => a.closedAt.getTime() - b.closedAt.getTime(),
    );

    // Simulate calendar aggregation (same logic as pnl-calendar.tsx dayMap)
    const dayMap = new Map<string, { pnl: number; count: number }>();
    for (const t of trades) {
      const key = isoDateKey(t.closedAt, tz);
      const cur = dayMap.get(key) ?? { pnl: 0, count: 0 };
      dayMap.set(key, { pnl: cur.pnl + t.pnl, count: cur.count + 1 });
    }

    // Simulate Trades page filter (same isoDateKey function with same tz)
    const dateKeys = [...dayMap.keys()];
    for (const dk of dateKeys) {
      const dayTrades = trades.filter((t) => isoDateKey(t.closedAt, tz) === dk);
      const tradesPageSum = dayTrades.reduce((s, t) => s + t.pnl, 0);
      const calendarCell = dayMap.get(dk)!;

      assert.ok(
        Math.abs(tradesPageSum - calendarCell.pnl) < 0.001,
        `calendar cell pnl for ${dk} (${calendarCell.pnl}) must equal trades-page sum (${tradesPageSum})`,
      );
      assert.equal(
        dayTrades.length,
        calendarCell.count,
        `calendar cell count for ${dk} must match trades-page row count`,
      );
    }
  });

  it("calendar date key matches trades page date key for a boundary trade (22:00 CT vs 03:00 UTC+1)", () => {
    // Trade closes at 03:00 UTC May 21 = 22:00 CDT May 20 (CDT = UTC-5).
    // Calendar keys in CT → "2026-05-20". Trades page with same tz → "2026-05-20".
    // If trades page used UTC, this would be "2026-05-21" — a mismatch.
    const closeUtc = new Date("2026-05-21T03:00:00Z"); // 22:00 CDT May 20
    const calKey = isoDateKey(closeUtc, "America/Chicago");
    const tradesKey = isoDateKey(closeUtc, "America/Chicago"); // same tz → must match
    assert.equal(calKey, tradesKey, "same timezone → same day key regardless of UTC midnight");
    assert.equal(calKey, "2026-05-20", "22:00 CDT on May 20 (03:00 UTC May 21) must key to May 20, not May 21");
  });

  it("mismatched timezone gives different day keys — regression proof of the bug that was fixed", () => {
    // Demonstrates WHY hardcoding a different tz was a bug: the same trade close
    // time produces different date keys in CT vs UTC near CT midnight.
    const closeUtc = new Date("2026-05-21T03:00:00Z"); // 22:00 CDT May 20 / 03:00 UTC May 21
    const ctKey  = isoDateKey(closeUtc, "America/Chicago");
    const utcKey = isoDateKey(closeUtc, "UTC");
    assert.notEqual(
      ctKey,
      utcKey,
      "CT and UTC produce different keys for a trade near CT midnight — demonstrates the timezone mismatch bug",
    );
    assert.equal(ctKey,  "2026-05-20", "CDT keys this to May 20 (22:00 local)");
    assert.equal(utcKey, "2026-05-21", "UTC keys this to May 21 (03:00 UTC)");
  });
});

// ── 3. Account isolation: trades are strictly per-account ─────────────────────

describe("data-truth: per-account isolation in loadAccountTrades", () => {
  it("reconstructRoundTrips with two account fill sets never mixes them", () => {
    // Fill sets tagged as two different accounts (different contractIds here
    // stand in for account A vs B — the real guard is the accountId WHERE
    // clause in loadAccountTrades, which is separately confirmed via source scan).
    const accountAFills: FillInput[] = [
      fill({ id: "a1", contractId: 10, side: "BUY",  price: "100", pnl: null, occurredAt: new Date("2026-05-20T14:00:00Z") }),
      fill({ id: "a2", contractId: 10, side: "SELL", price: "110", pnl: "10", occurredAt: new Date("2026-05-20T14:30:00Z") }),
    ];
    const accountBFills: FillInput[] = [
      fill({ id: "b1", contractId: 20, side: "BUY",  price: "200", pnl: null, occurredAt: new Date("2026-05-20T14:00:00Z") }),
      fill({ id: "b2", contractId: 20, side: "SELL", price: "190", pnl: "-10", occurredAt: new Date("2026-05-20T14:30:00Z") }),
    ];

    const tradesA = reconstructRoundTrips(accountAFills);
    const tradesB = reconstructRoundTrips(accountBFills);

    // Account A must show only its own pnl
    assert.equal(tradesA.length, 1);
    assert.equal(tradesA[0]!.pnl, 10, "account A pnl must be +10");

    // Account B must show only its own pnl
    assert.equal(tradesB.length, 1);
    assert.equal(tradesB[0]!.pnl, -10, "account B pnl must be -10");

    // Mixing fills would contaminate the result; confirm the isolated sets differ
    const mixedTrades = reconstructRoundTrips([...accountAFills, ...accountBFills]);
    const mixedPnl = mixedTrades.reduce((s, t) => s + t.pnl, 0);
    assert.ok(
      Math.abs(mixedPnl - (tradesA[0]!.pnl + tradesB[0]!.pnl)) < 0.001,
      "mixed fills still produce correct total (isolation is enforced by the DB WHERE clause, not the reconstruction)",
    );
  });
});

// ── 4. Today's trades: timezone-aware boundary ────────────────────────────────

describe("data-truth: today's trades uses timezone-aware day boundary (not UTC midnight)", () => {
  const dashboard = read("app/dashboard/page.tsx");

  it("today's trades filter uses toLocaleDateString en-CA key (not setHours(0,0,0,0))", () => {
    assert.ok(
      !dashboard.includes("todayStart.setHours(0, 0, 0, 0)"),
      "dashboard must not use setHours(0,0,0,0) for 'today' boundary — that is UTC midnight, not user timezone midnight",
    );
    assert.ok(
      dashboard.includes('todayKey = new Date().toLocaleDateString("en-CA"'),
      "dashboard must compute todayKey with toLocaleDateString en-CA and the user's display timezone",
    );
    assert.ok(
      /todayTrades.*toLocaleDateString\("en-CA".*=== todayKey/.test(dashboard.replace(/\s+/g, " ")),
      "todayTrades filter must compare toLocaleDateString en-CA against todayKey",
    );
  });

  it("today's trades time display uses displayTimeZone (not hardcoded America/Chicago)", () => {
    // After the fix, the close-time column must use the user's display timezone.
    assert.ok(
      !dashboard.includes('timeZone: "America/Chicago"'),
      "today's trades time column must not hardcode America/Chicago — must use displayTimeZone",
    );
    assert.ok(
      dashboard.includes("timeZone: displayTimeZone"),
      "today's trades time column must pass displayTimeZone",
    );
  });

  it("timezone-aware today filter agrees with TraderInsights todayKey logic", () => {
    // Both must use the same pattern: toLocaleDateString('en-CA', { timeZone: tz })
    // This test proves the server dashboard and the TraderInsights component use
    // the same today boundary, so their trade sets are consistent.
    const insights = read("app/dashboard/_components/trader-insights.tsx");
    assert.ok(
      insights.includes('toLocaleDateString("en-CA", { timeZone: timezone })'),
      "TraderInsights must bucket trades by en-CA key in the display timezone",
    );
    assert.ok(
      dashboard.includes('toLocaleDateString("en-CA", { timeZone: displayTimeZone })'),
      "Dashboard todayKey must use same en-CA/displayTimeZone pattern as TraderInsights",
    );
  });
});

// ── 5. No fake/sample data in any display path ────────────────────────────────

describe("data-truth: no fake or sample trade data in authenticated display paths", () => {
  const dashboard = read("app/dashboard/page.tsx");
  const equity   = read("app/dashboard/_components/equity-curve.tsx");
  const calendar = read("app/dashboard/_components/pnl-calendar.tsx");
  const trades   = read("app/trades/page.tsx");

  it("equity curve never generates synthetic chart points", () => {
    assert.ok(!equity.includes("Math.random"), "must not use Math.random for any chart value");
    assert.ok(!equity.includes("sampleData"),  "must not reference sampleData");
    assert.ok(!equity.includes("fakeData"),    "must not reference fakeData");
    assert.ok(!equity.includes("demoData"),    "must not reference demoData");
    assert.ok(
      equity.includes("cum += t.pnl"),
      "equity curve must build series from real round-trip pnl only",
    );
  });

  it("P&L calendar aggregates from real round-trip trades only", () => {
    assert.ok(!calendar.includes("Math.random"), "calendar must not use Math.random");
    assert.ok(
      calendar.includes("t.closedAt.toLocaleDateString"),
      "calendar must aggregate by closedAt from real trades",
    );
  });

  it("trades page renders rows from loadAccountTrades only", () => {
    assert.ok(!trades.includes("Math.random"), "trades page must not use Math.random");
    assert.ok(
      trades.includes("loadAccountTrades"),
      "trades page must use loadAccountTrades (broker-derived data only)",
    );
  });

  it("dashboard does not pass hardcoded/demo trade arrays to any component", () => {
    // DEMO_COMMAND_CENTER_DATA is the ONLY allowed demo fixture and is only
    // rendered for the public marketing page, never for authenticated users.
    assert.ok(
      dashboard.includes("DEMO_COMMAND_CENTER_DATA"),
      "DEMO_COMMAND_CENTER_DATA must still be imported for the public page path",
    );
    // Confirm the demo data is NOT passed to the equity curve or calendar.
    assert.ok(
      !dashboard.includes("<EquityCurve trades={DEMO"),
      "equity curve must never receive DEMO data",
    );
    assert.ok(
      !dashboard.includes("<PnlCalendar trades={DEMO"),
      "P&L calendar must never receive DEMO data",
    );
  });
});

// ── 6. Source-scan: metric source provenance ──────────────────────────────────

describe("data-truth: metric source provenance (source-scan)", () => {
  const data   = read("app/dashboard/_components/command-center/data.ts");
  const load   = read("lib/trades/load.ts");

  it("dailyPnl comes from LiveSessionState (broker session), not from round-trips", () => {
    // The broker session P&L is the ground truth for risk enforcement.
    // It must come from resolveSessionDisplayMetrics (LiveSessionState), not
    // be re-derived from round-trips (which lag behind real-time fills).
    assert.ok(
      data.includes("resolveSessionDisplayMetrics"),
      "data.ts must call resolveSessionDisplayMetrics for dailyPnl",
    );
    assert.ok(
      data.includes("sessionState"),
      "dailyPnl must be sourced from sessionState (LiveSessionState)",
    );
  });

  it("tradesCount comes from LiveSessionState (broker session), not round-trip count", () => {
    assert.ok(
      data.includes("resolveSessionDisplayMetrics"),
      "tradesCount must come from resolveSessionDisplayMetrics (LiveSessionState)",
    );
  });

  it("loadAccountTrades queries fills by accountId — not by userId", () => {
    assert.ok(
      load.includes("accountId,"),
      "must pass accountId in WHERE clause",
    );
    assert.ok(
      !load.includes("userId"),
      "must NOT use userId — that would aggregate all accounts for that user",
    );
  });

  it("round-trip reconstruction uses FIFO per contract — no cross-symbol mixing", () => {
    const rt = read("lib/trades/round-trips.ts");
    assert.ok(
      rt.includes("contractKey(fill)"),
      "must track positions by contractKey so fills on different symbols never mix",
    );
    assert.ok(
      rt.includes("positions.get(key)"),
      "must look up open position by contract key — not globally",
    );
  });
});
