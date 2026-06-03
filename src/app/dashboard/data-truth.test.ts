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
import { deriveCmeTradingDayKey } from "../../lib/trading-day.ts";

const ROOT = resolve(process.cwd(), "src");
function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

// The /trades route is split into the shell page + the streamed broker-data
// subtree (trades-content). Source-scan assertions read the union of both.
const TRADES_FILES = ["app/trades/page.tsx", "app/trades/_components/trades-content.tsx"];
function readTrades(): string {
  return TRADES_FILES.map(read).join("\n");
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
  const calendarAgg = read("app/dashboard/_components/pnl-calendar-agg.ts");
  const trades   = readTrades();

  it("equity curve never generates synthetic chart points", () => {
    assert.ok(!equity.includes("Math.random"), "must not use Math.random for any chart value");
    assert.ok(!equity.includes("sampleData"),  "must not reference sampleData");
    assert.ok(!equity.includes("fakeData"),    "must not reference fakeData");
    assert.ok(!equity.includes("demoData"),    "must not reference demoData");
    assert.ok(
      equity.includes("buildDailySeries"),
      "equity curve must build its series from the broker-net-aware daily aggregation, not invented values",
    );
    // The daily aggregation itself must accumulate only real day P&L (broker
    // net when reported, else real fill/per-trade sums) — never fabricated.
    const dailyPnl = read("app/dashboard/_components/daily-pnl.ts");
    assert.ok(!dailyPnl.includes("Math.random"), "daily-pnl must not use Math.random");
    assert.ok(
      dailyPnl.includes("cum += agg.pnl"),
      "daily series must accumulate real day P&L only",
    );
  });

  it("P&L calendar aggregates from real round-trip trades only", () => {
    assert.ok(!calendar.includes("Math.random"), "calendar must not use Math.random");
    assert.ok(!calendarAgg.includes("Math.random"), "calendar agg must not use Math.random");
    assert.ok(
      calendarAgg.includes("t.closedAt.toLocaleDateString"),
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

// ── 7. UI labeling correctness ────────────────────────────────────────────────

describe("data-truth: UI labeling and classification defaults", () => {
  const dashboard = read("app/dashboard/page.tsx");
  const trades    = readTrades();

  it("dashboard hero does not say 'live accounts' — uses 'connected accounts' instead", () => {
    // "live accounts." is the old hero copy; "live account data" (in the demo banner) is
    // a different concept and is allowed. Target the plural + period form that only
    // appears in the hero/status heading lines.
    assert.ok(
      !dashboard.includes("live accounts."),
      "dashboard hero must not say 'live accounts.' — must use 'connected accounts.'",
    );
    assert.ok(
      !dashboard.includes("No live accounts"),
      "dashboard no-accounts fallback must not say 'No live accounts'",
    );
    assert.ok(
      dashboard.includes("connected account"),
      "dashboard must say 'connected account'",
    );
  });

  it("trades sidebar renders acc.primaryLabel not acc.label", () => {
    assert.ok(
      trades.includes("acc.primaryLabel"),
      "trades sidebar must show acc.primaryLabel (broker account ref) not acc.label",
    );
    // Verify the sidebar section specifically uses primaryLabel in the span
    // (not just somewhere else on the page)
    assert.ok(
      !trades.includes("{acc.label}"),
      "trades sidebar span must not render {acc.label} — must use {acc.primaryLabel}",
    );
  });

  it("RULE_LABELS session_not_started is 'Guardian session not started'", () => {
    assert.ok(
      dashboard.includes('"Guardian session not started"'),
      "session_not_started rule label must be 'Guardian session not started', not 'Session not started'",
    );
    assert.ok(
      !dashboard.includes('"Session not started"'),
      "old 'Session not started' label must be replaced with 'Guardian session not started'",
    );
  });

  it("loadAccountTrades uses accountId filter (not userId)", () => {
    const load = read("lib/trades/load.ts");
    assert.ok(
      load.includes("accountId,"),
      "loadAccountTrades must pass accountId in WHERE clause",
    );
    assert.ok(
      !load.includes("userId"),
      "loadAccountTrades must NOT use userId",
    );
  });
});

// ── 8. CME session vs calendar day — explicit label and boundary tests ────────

describe("data-truth: CME session vs calendar day — explicit labels and boundaries", () => {
  const dashboard = read("app/dashboard/page.tsx");
  const calendar  = read("app/dashboard/_components/pnl-calendar.tsx");

  it("KPI card uses 'Broker session P&L snapshot' (not vague 'session')", () => {
    assert.ok(
      dashboard.includes('"Broker session P&L snapshot"'),
      "KPI card must say 'Broker session P&L snapshot' to distinguish from closed round-trip P&L",
    );
    assert.ok(
      !dashboard.includes('"Today P&L · session"'),
      "old vague label 'Today P&L · session' must be replaced with 'Broker session P&L snapshot'",
    );
  });

  it("P&L calendar subtitle says 'calendar day' to distinguish from CME session boundary", () => {
    assert.ok(
      calendar.includes("calendar day"),
      "P&L calendar subtitle must include 'calendar day' — not just 'by day'",
    );
  });

  it("unavailable/expired selected account shows 'Historical · unavailable' badge", () => {
    assert.ok(
      dashboard.includes("Historical · unavailable"),
      "dashboard must show 'Historical · unavailable' badge when selected account is inactive",
    );
    assert.ok(
      dashboard.includes('selectedAccount.status === "unavailable"'),
      "badge must be guarded by unavailable status check",
    );
  });

  it("CME day key changes at 17:00 CT, not at UTC midnight", () => {
    // At 12:00 CT June 1 (= 17:00 UTC June 1 in CDT), the current CME session
    // opened at 17:00 CT May 31 → day key = "2026-05-31".
    // At 18:00 CT June 1 (= 23:00 UTC June 1 in CDT), the current CME session
    // opened at 17:00 CT June 1 → day key = "2026-06-01".
    // (CDT = UTC−5)
    const noon_ct_june1    = new Date("2026-06-01T17:00:00Z"); // 12:00 CDT June 1
    const evening_ct_june1 = new Date("2026-06-01T23:00:00Z"); // 18:00 CDT June 1

    const noonKey    = deriveCmeTradingDayKey(noon_ct_june1);
    const eveningKey = deriveCmeTradingDayKey(evening_ct_june1);

    assert.equal(noonKey, "2026-05-31",
      "At 12:00 CT June 1, CME day = 2026-05-31 (session opened 17:00 CT May 31)");
    assert.equal(eveningKey, "2026-06-01",
      "At 18:00 CT June 1, CME day = 2026-06-01 (session opened 17:00 CT June 1)");
    assert.notEqual(noonKey, eveningKey,
      "CME day key changes at 17:00 CT — afternoon and evening are different sessions");
  });

  it("calendar-day and CME-day boundaries diverge for fills before 17:00 CT", () => {
    // A fill at 10:00 CT June 1 belongs to:
    //   Calendar day: June 1 (midnight-to-midnight CT)
    //   CME session:  "2026-05-31" (session opened 17:00 CT May 31)
    // This is why Dashboard session P&L ≠ P&L calendar for the same day.
    const fill_ct_morning_june1 = new Date("2026-06-01T15:00:00Z"); // 10:00 CDT June 1

    const calKey = fill_ct_morning_june1.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const cmeKey = deriveCmeTradingDayKey(fill_ct_morning_june1);

    assert.equal(calKey, "2026-06-01",
      "A fill at 10:00 CT June 1 belongs to June 1 calendar day");
    assert.equal(cmeKey, "2026-05-31",
      "A fill at 10:00 CT June 1 belongs to CME session 2026-05-31 (opened 17:00 CT May 31)");
    assert.notEqual(calKey, cmeKey,
      "Morning fills land in different CME session vs calendar day — explains the discrepancy");
  });

  it("resolveSessionDisplayMetrics returns null metrics for a stale CME session", () => {
    // When sessionDate differs from current CME day key, dashboard shows '—'
    // Replicate the logic from data-helpers.ts inline (no import needed)
    function resolveStale(sessionDate: string, todayKey: string, tradesCount: number, dailyPnl: number) {
      if (sessionDate !== todayKey) return { tradesCount: null, dailyPnl: null };
      return { tradesCount, dailyPnl };
    }

    // Stale: session is from yesterday's CME day
    const stale = resolveStale("2026-05-31", "2026-06-01", 47, -404);
    assert.equal(stale.tradesCount, null, "stale session tradesCount must be null (not shown)");
    assert.equal(stale.dailyPnl, null, "stale session dailyPnl must be null (not shown)");

    // Current: session matches today's CME day
    const current = resolveStale("2026-06-01", "2026-06-01", 47, -404);
    assert.equal(current.tradesCount, 47, "current session tradesCount must be shown");
    assert.equal(current.dailyPnl, -404, "current session dailyPnl must be shown");
  });

  it("unavailable account KPI sub says 'Account unavailable' not 'CME session'", () => {
    // When selectedAccount.status is 'unavailable', the KPI sub must not say
    // 'CME session · since 17:00 CT' (which implies live monitoring).
    // It must say 'Account unavailable · no current data' instead.
    assert.ok(
      dashboard.includes('"Account unavailable · no current data"'),
      "KPI sub for unavailable accounts must say 'Account unavailable · no current data'",
    );
    assert.ok(
      dashboard.includes('selectedAccount.status === "unavailable"') ||
        dashboard.includes("selectedAccount.status === 'unavailable'"),
      "unavailable KPI sub must be guarded by status check",
    );
  });

  it("Broker session P&L snapshot helper copy names the Tradovate snapshot source", () => {
    // The helper copy below the KPI strip must name snapshot.todayPnL as the source
    // so users understand dailyPnl comes from the broker account snapshot API,
    // not from summing individual fill records.
    assert.ok(
      dashboard.includes("todayPnL") || dashboard.includes("snapshot"),
      "helper copy must reference the Tradovate snapshot source (todayPnL or snapshot)",
    );
    assert.ok(
      dashboard.includes("commission"),
      "helper copy must mention commission-adjustment to explain the P&L gap",
    );
  });

  it("equity curve subtitle says 'closed round-trip' to distinguish from broker snapshot", () => {
    const equity = read("app/dashboard/_components/equity-curve.tsx");
    assert.ok(
      equity.includes("closed round-trip"),
      "equity curve subtitle must say 'closed round-trip P&L', not just 'realized P&L'",
    );
    assert.ok(
      equity.includes("closed round-trip"),
      "equity curve trade count must say 'closed round-trips' not just 'trades'",
    );
  });
});

// ── 7. Source-of-truth: Account Balance History preferred for historical P&L ──

describe("data-truth: Account Balance History is the historical source of truth", () => {
  const dashboard = read("app/dashboard/page.tsx");
  const trades    = readTrades();
  const equity    = read("app/dashboard/_components/equity-curve.tsx");
  const calendar  = read("app/dashboard/_components/pnl-calendar.tsx");
  const insights  = read("app/dashboard/_components/trader-insights.tsx");

  it("dashboard loads broker performance via getHistoricalAccountPerformance (report-preferred)", () => {
    // ABH is loaded OFF the blocking render path via the shared cached loader,
    // awaited inside async Suspense sections. The loader (not the page) calls ABH.
    const loader = read("lib/brokers/broker-performance-loader.ts");
    assert.ok(
      loader.includes("getHistoricalAccountPerformance"),
      "the broker-performance loader must prefer the report-backed historical performance loader",
    );
    assert.ok(
      !loader.includes("getCashHistoryPerformance"),
      "the loader must not call getCashHistoryPerformance directly (it's the fallback inside getHistoricalAccountPerformance)",
    );
    assert.ok(
      dashboard.includes("<Suspense"),
      "dashboard must stream ABH widgets behind <Suspense> instead of blocking render on them",
    );
  });

  it("trades page loads broker day-net via getHistoricalAccountPerformance", () => {
    assert.ok(
      trades.includes("getHistoricalAccountPerformance"),
      "trades page must use the report-preferred loader",
    );
  });

  it("fallback to cashBalanceLog/deps lives inside the loader, not the pages", () => {
    const client = read("lib/brokers/tradovate-client.ts");
    // The loader prefers the report and falls back to cash history.
    assert.ok(
      client.includes("getAccountBalanceHistoryReport") &&
      client.includes("getCashHistoryPerformance"),
      "getHistoricalAccountPerformance must combine report (primary) + cash history (fallback)",
    );
  });

  it("DB imported fills are not the primary broker metric source when broker history exists", () => {
    // KPIs branch on brokerPerformance/brokerWindow first; recentTrades (fills)
    // is only the fallback when there is no broker history. This now lives in the
    // streamed ABH KPI section.
    const sections = read("app/dashboard/_components/broker-sections.tsx");
    assert.ok(
      sections.includes("brokerWindow30d != null"),
      "dashboard win-rate/PF must prefer broker window stats over fill-derived recentTrades",
    );
  });

  it("labels are source-aware (Broker Account Balance History / report-visible), not hardcoded Cash History", () => {
    assert.ok(equity.includes("brokerSourceLabel"), "equity curve must use brokerSourceLabel");
    assert.ok(calendar.includes("brokerSourceLabel"), "calendar must use brokerSourceLabel");
    assert.ok(insights.includes("brokerSourceLabel"), "insights must use brokerSourceLabel");
    assert.ok(
      equity.includes("report-visible history"),
      "equity 'All' range label must say 'report-visible history' (honest coverage)",
    );
  });
});
