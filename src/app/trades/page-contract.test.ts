/**
 * Source-scan contract tests for the /trades page.
 *
 * No JSX renderer (matches the project's existing safety-test pattern). These
 * tests read the page source to verify:
 *
 *   1. It uses GrShell — the only authenticated app shell.
 *   2. It reads from real broker data via loadAccountTrades.
 *   3. It supports per-account URL routing.
 *   4. It includes the honest empty-state copy when no trades exist.
 *   5. It does not fabricate trade data (no hardcoded tickers / dollar amounts).
 *   6. It is wired into the GrShell nav on every other authenticated page.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), "src");
function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

describe("/trades page: structural contract", () => {
  const page = read("app/trades/page.tsx");

  it("uses GrShell (not AppShell)", () => {
    assert.ok(page.includes("<GrShell"), "must render <GrShell>");
    assert.ok(!page.includes("AppShell"), "must not reference AppShell");
  });

  it("does not hide the GrShell sidebar (hideSidebar must be absent)", () => {
    assert.ok(
      !page.includes("hideSidebar"),
      "must not pass hideSidebar — the nav rail and sidebar must be visible on /trades",
    );
  });

  it("passes sidebarLabel to GrShell so the sidebar section has a heading", () => {
    assert.ok(
      page.includes("sidebarLabel"),
      "must pass sidebarLabel prop so the sidebar section shows a heading",
    );
  });

  it("loads real trades via loadAccountTrades", () => {
    assert.ok(
      page.includes("loadAccountTrades"),
      "must import and call loadAccountTrades",
    );
  });

  it("supports per-account URL routing via ?accountId=", () => {
    assert.ok(page.includes("searchParams"), "must accept searchParams");
    assert.ok(page.includes("accountId"), "must read accountId from query");
  });

  it("renders honest empty-state copy when no trades exist", () => {
    assert.ok(
      page.includes("No closed round-trips"),
      "must include honest empty-state text",
    );
    assert.ok(
      page.includes("does not invent activity"),
      "must explicitly state Guardrail does not invent activity",
    );
  });

  it("computes stats from real trades, not from constants", () => {
    assert.ok(
      page.includes("computeTradeStats"),
      "must call computeTradeStats with reconstructed trades",
    );
    // No hardcoded large-dollar values that would imply fake P&L
    const fakeP = /value:\s*"\$\d[\d,]+/;
    assert.ok(
      !fakeP.test(page),
      "must not hardcode any dollar-amount placeholders for trade values",
    );
  });

  it("is in the GrShell nav arrays of all other authenticated pages", () => {
    const dashboard = read("app/dashboard/page.tsx");
    const rules = read("app/rules/page.tsx");
    const alerts = read("app/alerts/page.tsx");
    const settings = read("app/settings/page.tsx");
    for (const [name, content] of [
      ["dashboard", dashboard],
      ["rules", rules],
      ["alerts", alerts],
      ["settings", settings],
    ] as const) {
      assert.ok(
        content.includes('href: "/trades"'),
        `${name} page must include /trades in its nav array`,
      );
    }
  });
});

describe("dashboard: today's trades + equity curve use real data", () => {
  const page = read("app/dashboard/page.tsx");

  it("imports loadAccountTrades", () => {
    assert.ok(
      page.includes("loadAccountTrades"),
      "dashboard must load real trades for selected account",
    );
  });

  it("does not contain 'Coming soon' badges on the trade/equity panels", () => {
    // We may keep "Coming soon" elsewhere if used; verify the specific
    // placeholders we replaced are gone by checking for their old copy.
    assert.ok(
      !page.includes("Synced fills will appear here once broker trade history is connected"),
      "old 'Synced fills' placeholder must be removed from Today's trades",
    );
    assert.ok(
      !page.includes("Balance history will appear here once broker trade sync is available"),
      "old 'Balance history' placeholder must be removed from Equity curve",
    );
  });

  it("has honest empty-state copy for today's trades panel", () => {
    assert.ok(
      page.includes("No closed round-trips this session"),
      "today's trades must show honest empty state",
    );
    assert.ok(
      page.includes("does not invent activity"),
      "honesty statement must be present",
    );
  });
});

describe("/trades page: KPI strip is responsive", () => {
  const page = read("app/trades/page.tsx");

  it("KPI grid uses the trades-kpi-grid class for responsive overrides", () => {
    assert.ok(
      page.includes("trades-kpi-grid"),
      "KPI grid div must have className='trades-kpi-grid' so media queries can target it",
    );
  });

  it("includes @media breakpoints so the grid reflows on small screens", () => {
    assert.ok(
      page.includes("@media"),
      "trades page must include @media rules to prevent 5-column overflow on mobile",
    );
  });

  it("breaks to at most 3 columns at 700 px viewport width", () => {
    assert.ok(
      page.includes("max-width: 700px") && page.includes("repeat(3, 1fr)"),
      "at ≤700px the KPI grid must reflow to 3 columns",
    );
  });

  it("breaks to 2 columns at 460 px viewport width for very small screens", () => {
    assert.ok(
      page.includes("max-width: 460px") && page.includes("repeat(2, 1fr)"),
      "at ≤460px the KPI grid must reflow to 2 columns",
    );
  });
});

describe("/trades page: heading hierarchy", () => {
  const page = read("app/trades/page.tsx");

  it("h1 is 'Trades' or 'Trades · <date>' in date-filter mode", () => {
    assert.ok(
      page.includes(">Trades</h1>") ||
        /h1[^>]*>[^<]*Trades[^<]*<\/h1>/.test(page) ||
        page.includes("Trades\n          </h1>") ||
        page.includes('"Trades"') ||
        page.includes("`Trades · `") ||
        page.includes('"Trades · "'),
      "h1 must render the page title 'Trades' (optionally with date context)",
    );
    assert.ok(
      !/<h1[^>]*>\s*\{selectedAccount/.test(page),
      "h1 must not render the dynamic account label — that belongs in the eyebrow",
    );
  });

  it("eyebrow/subtitle uses primaryLabel (real broker ref) and 'Closed round-trips' context", () => {
    assert.ok(
      page.includes("selectedAccount.primaryLabel") &&
        page.includes("Closed round-trips"),
      "eyebrow must use primaryLabel (real broker ref) and include 'Closed round-trips' context",
    );
    assert.ok(
      !page.includes("selectedAccount.label + \" · \""),
      "eyebrow must not use the friendly label — it must use primaryLabel",
    );
  });
});

describe("/trades page: date deep-link from calendar", () => {
  const page = read("app/trades/page.tsx");

  it("accepts a date searchParam", () => {
    assert.ok(
      page.includes("date?:"),
      "searchParams type must include date?: string",
    );
  });

  it("validates the date param format before using it", () => {
    assert.ok(
      page.includes("/^\\d{4}-\\d{2}-\\d{2}$/") || page.includes('/^\\d{4}-\\d{2}-\\d{2}$/.test'),
      "date param must be validated as YYYY-MM-DD before use",
    );
  });

  it("filters trades to the specific day when date is present", () => {
    assert.ok(
      page.includes("isoDateKey(t.closedAt, tz) === dateFilter"),
      "when date filter is active, trades must be filtered to that exact calendar day",
    );
  });

  it("shows the date as a human-readable heading", () => {
    assert.ok(
      page.includes("fmtDateFromKey"),
      "page must format the date key into a human-readable label for the heading/banner",
    );
  });

  it("shows an '← All trades' back link in date mode", () => {
    assert.ok(
      page.includes("All trades"),
      "date-filter mode must show a back link to clear the date filter",
    );
  });

  it("date filter loads enough history to cover any calendar day (31 days)", () => {
    assert.ok(
      page.includes("dateFilter ? 31 :"),
      "when date filter is active, must load at least 31 days to cover any calendar date",
    );
  });
});

describe("/trades page: timezone — calendar ↔ trades date consistency", () => {
  const page = read("app/trades/page.tsx");
  const calendar = read("app/dashboard/_components/pnl-calendar.tsx");

  it("trades page must NOT hardcode 'America/Chicago' as its display timezone", () => {
    // The calendar uses the user's displayTimeZone; the trades page must do
    // the same so clicking a calendar day always shows the trades in that cell.
    assert.ok(
      !page.includes("const tz = \"America/Chicago\""),
      "trades page must not hardcode tz = 'America/Chicago'; it must resolve displayTimeZone",
    );
  });

  it("trades page must resolve displayTimeZone from cookie/profile (same as dashboard)", () => {
    assert.ok(
      page.includes("resolveDisplayTimeZone"),
      "trades page must call resolveDisplayTimeZone to match the dashboard's timezone",
    );
    assert.ok(
      page.includes("DISPLAY_TIME_ZONE_COOKIE"),
      "trades page must read the browser timezone cookie (same as dashboard)",
    );
  });

  it("both calendar and trades page bucket trades by the same isoDateKey pattern", () => {
    // Both must use toLocaleDateString('en-CA', { timeZone: tz }) for day bucketing
    // so a trade at 2026-05-31T00:30:00Z shows up in the same calendar-day on both.
    assert.ok(
      calendar.includes("toLocaleDateString(\"en-CA\", { timeZone: timezone })"),
      "calendar must bucket trades with en-CA toLocaleDateString in the user's timezone",
    );
    assert.ok(
      page.includes("isoDateKey(t.closedAt, tz) === dateFilter"),
      "trades page must use the same key function to filter to a specific day",
    );
  });
});

describe("/trades page: account isolation", () => {
  const load = read("lib/trades/load.ts");

  it("loadAccountTrades always passes accountId to the DB query — no cross-account leakage", () => {
    assert.ok(
      load.includes("accountId,"),
      "loadAccountTrades must pass accountId in the WHERE clause to prevent cross-account data",
    );
    assert.ok(
      !load.includes("userId"),
      "loadAccountTrades must not use userId (which would aggregate all user accounts)",
    );
  });

  it("loadAccountTrades only queries fills with non-null side, quantity, price", () => {
    assert.ok(
      load.includes("side: { not: null }"),
      "must filter out non-fill events (events with null side)",
    );
    assert.ok(
      load.includes("quantity: { not: null }"),
      "must filter out events with null quantity",
    );
  });
});

describe("Priority 2 — P&L/fees: gross vs net labelling", () => {
  const page = read("app/trades/page.tsx");
  const dashboard = read("app/dashboard/page.tsx");
  const calendar = read("app/dashboard/_components/pnl-calendar.tsx");
  const stats = read("lib/trades/stats.ts");
  const roundTrips = read("lib/trades/round-trips.ts");
  const lockout = read("app/dashboard/_components/command-center/account-lockout.tsx");

  it("TradeStats uses grossPnl (not netPnl) — round-trip sum is gross before fees", () => {
    assert.ok(
      stats.includes("grossPnl"),
      "TradeStats must expose grossPnl — the round-trip sum from fills is gross (before fees)",
    );
    assert.ok(
      !stats.includes("netPnl"),
      "TradeStats must not expose netPnl — fills do not include fee deductions",
    );
  });

  it("RoundTripTrade exposes pnlType field to distinguish broker_gross from computed", () => {
    assert.ok(
      roundTrips.includes("pnlType"),
      "RoundTripTrade must include pnlType field",
    );
    assert.ok(
      roundTrips.includes('"broker_gross"'),
      "pnlType must include 'broker_gross' variant for broker fill P&L",
    );
    assert.ok(
      roundTrips.includes('"computed"'),
      "pnlType must include 'computed' variant for price-difference P&L",
    );
  });

  it("Trades page KPI labels trade fill P&L as 'Trade P&L (before fees)' — not gross-first headline", () => {
    assert.ok(
      page.includes("Trade P&L (before fees)"),
      "trades page KPI strip must label the round-trip sum as 'Trade P&L (before fees)'",
    );
    assert.ok(
      !page.includes('"Net P&L"'),
      "trades page must not label round-trip P&L as 'Net P&L' — per-trade fees are not available",
    );
    assert.ok(
      !page.includes("Gross P&L (before fees)"),
      "trades page must not use 'Gross P&L (before fees)' as the headline KPI label",
    );
  });

  it("Trades page column header is 'Trade P&L' (neutral, not gross-first)", () => {
    assert.ok(
      page.includes('"Trade P&L"'),
      "trades page table column header must say 'Trade P&L'",
    );
    assert.ok(
      !page.includes('"Gross P&L"'),
      "trades page must not use 'Gross P&L' as the column header",
    );
  });

  it("Trades page footer note explains before-fees distinction and points to broker session net P&L", () => {
    assert.ok(
      page.includes("before fees") && page.includes("fees"),
      "trades page footer must clarify that Trade P&L is before fees/commissions",
    );
    assert.ok(
      page.includes("Broker Session P&L snapshot"),
      "trades page footer must point to the Broker Session P&L snapshot for net P&L",
    );
  });

  it("P&L calendar subtitle is neutral ('P&L calendar') and indicates before-fees context", () => {
    assert.ok(
      calendar.includes("P&L calendar") || calendar.includes("P&amp;L calendar"),
      "P&L calendar subtitle must use neutral 'P&L calendar' framing",
    );
    assert.ok(
      calendar.includes("before fees") || calendar.includes("fees"),
      "P&L calendar must indicate that the displayed P&L is before fees",
    );
    assert.ok(
      !calendar.includes("Gross round-trip"),
      "P&L calendar must not use 'Gross round-trip' as the primary subtitle label",
    );
  });

  it("Dashboard session trades column header is 'Trade P&L' (neutral, before-fees)", () => {
    assert.ok(
      dashboard.includes('"Trade P&L"'),
      "dashboard session trades table must use 'Trade P&L' — not 'Gross P&L'",
    );
    assert.ok(
      !dashboard.includes('"Gross P&L"'),
      "dashboard must not use 'Gross P&L' as the session trades column header",
    );
  });

  it("Dashboard 'Broker session P&L snapshot' card is retained as the authoritative net value", () => {
    assert.ok(
      dashboard.includes("Broker session P&L snapshot"),
      "dashboard must still show the broker session P&L snapshot (net, from account snapshot)",
    );
    assert.ok(
      dashboard.includes("dailyPnl"),
      "broker session P&L must come from account.dailyPnl (broker snapshot) not from round-trip sum",
    );
  });

  it("dashboard Broker session P&L uses dailyPnl (broker snapshot) not sum of round-trips", () => {
    // The broker snapshot dailyPnl is net (incl. fees). The round-trip sum is gross.
    // The dashboard must show the broker snapshot for the 'Broker session P&L' card.
    assert.ok(
      dashboard.includes("selectedAccount.dailyPnl"),
      "Broker session P&L card must use selectedAccount.dailyPnl (broker snapshot net P&L)",
    );
  });

  it("no accounts are combined — loadAccountTrades is account-scoped", () => {
    const load = read("lib/trades/load.ts");
    assert.ok(
      load.includes("accountId,"),
      "loadAccountTrades must pass accountId so trades are never combined across accounts",
    );
    assert.ok(
      !load.includes("userId"),
      "loadAccountTrades must not use userId (which would aggregate all accounts)",
    );
  });

  it("dashboard P&L source explanation mentions both broker snapshot net and before-fees trade P&L", () => {
    assert.ok(
      dashboard.includes("Broker session P&L snapshot"),
      "dashboard must explain that the broker session P&L snapshot is the authoritative net value",
    );
    assert.ok(
      dashboard.includes("Closed round-trip P&L") || dashboard.includes("Trade P&L") || dashboard.includes("before fees"),
      "dashboard must explain that closed round-trip / Trade P&L values are before fees",
    );
  });
});

describe("Lockout button — soft danger styling (smaller, muted red)", () => {
  const lockout = read("app/dashboard/_components/command-center/account-lockout.tsx");

  it("AccountLockoutButton uses h-7 or h-8 — not the large h-10", () => {
    assert.ok(
      lockout.includes("h-7") || lockout.includes("h-8"),
      "Lockout button must be h-7 or h-8 — smaller than the original h-10",
    );
    assert.ok(
      !lockout.includes("h-10"),
      "Lockout button must not use h-10 (too large for an inline pill next to account cards)",
    );
  });

  it("AccountLockoutButton uses soft/muted danger colors — not bright bg-red-500", () => {
    assert.ok(
      lockout.includes("bg-red-50") ||
        lockout.includes("bg-[#fff1ee]") ||
        lockout.includes("bg-red-100"),
      "Lockout button background must be a soft/light red (bg-red-50 / bg-[#fff1ee] / bg-red-100)",
    );
    assert.ok(
      !lockout.includes("bg-red-500"),
      "Lockout button must not use bright bg-red-500 — too visually dominant on the account card",
    );
  });

  it("AccountLockoutButton uses muted text color (text-red-700 or darker)", () => {
    assert.ok(
      lockout.includes("text-red-700") || lockout.includes("text-[#9f321f]"),
      "Lockout button text must use a muted danger color (text-red-700 or text-[#9f321f])",
    );
    assert.ok(
      !lockout.includes("text-white") || lockout.includes("bg-red-700"),
      "If text-white is used it must be paired with a dark red background (modal confirm only)",
    );
  });

  it("AccountLockoutButton has a border for visual definition", () => {
    assert.ok(
      lockout.includes("border-red-200") ||
        lockout.includes("border-[#efc7bd]") ||
        lockout.includes("border-red-300"),
      "Lockout button must have a border to give it definition against the card background",
    );
  });

  it("lock icon is smaller (h-3 or h-3.5) to match the compact button", () => {
    assert.ok(
      lockout.includes("h-3") || lockout.includes("h-3.5"),
      "Lock icon inside the Lockout button must be h-3 or h-3.5 to match the compact size",
    );
  });

  it("modal confirm button retains the strong red styling (bg-red-700) — only the pill is softened", () => {
    assert.ok(
      lockout.includes("bg-red-700"),
      "The confirm button inside the modal must retain a strong red (bg-red-700) for the danger action",
    );
  });
});
