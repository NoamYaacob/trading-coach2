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

describe("Net P&L (after fees) — user-facing P&L surfaces", () => {
  const page = read("app/trades/page.tsx");
  const dashboard = read("app/dashboard/page.tsx");
  const calendar = read("app/dashboard/_components/pnl-calendar.tsx");
  const stats = read("lib/trades/stats.ts");
  const roundTrips = read("lib/trades/round-trips.ts");

  it("TradeStats exposes netPnl, fees, and feesAvailable", () => {
    assert.ok(stats.includes("netPnl"), "TradeStats must expose netPnl (after fees)");
    assert.ok(stats.includes("fees"), "TradeStats must expose total fees");
    assert.ok(stats.includes("feesAvailable"), "TradeStats must expose feesAvailable flag");
  });

  it("RoundTripTrade carries netPnl, fees, feesAvailable + retains gross pnl for diagnostics", () => {
    assert.ok(roundTrips.includes("netPnl"), "RoundTripTrade must include netPnl");
    assert.ok(roundTrips.includes("fees:"), "RoundTripTrade must include fees");
    assert.ok(roundTrips.includes("feesAvailable"), "RoundTripTrade must include feesAvailable");
    assert.ok(roundTrips.includes("pnlType"), "RoundTripTrade must retain pnlType for the gross source");
  });

  it("net = gross - fees: reconstruction computes netPnl by subtracting fees", () => {
    assert.ok(
      roundTrips.includes("grossPnl - (fees ?? 0)"),
      "netPnl must be computed as gross minus fees (no fabrication when fees are null)",
    );
  });

  it("fees come ONLY from broker-reported commission — no hardcoded fee/commission constants", () => {
    assert.ok(
      roundTrips.includes("extractFillFee"),
      "fees must be read from the broker fill commission via extractFillFee",
    );
    assert.ok(
      roundTrips.includes("commission"),
      "fee extraction must reference the broker commission field",
    );
    // No hardcoded per-contract fee assumption (e.g. *0.62, +1.25, FEE_PER_CONTRACT).
    assert.ok(
      !/FEE_PER_CONTRACT|COMMISSION_PER|DEFAULT_FEE|\*\s*1\.25|\*\s*0\.6/.test(roundTrips),
      "must not hardcode a fee/commission assumption",
    );
  });

  it("Trades KPI does NOT call fill-only P&L 'Net' when fees are missing", () => {
    // Priority: broker history net → per-fill net → fill before fees.
    // The fill gross must never be labelled "Net".
    assert.ok(page.includes("brokerCoversSome"), "KPI must check broker history coverage first");
    assert.ok(page.includes("stats.feesAvailable"), "KPI must also branch on per-fill feesAvailable");
    assert.ok(page.includes('label: "Net P&L"'), "KPI headlines 'Net P&L' for broker-net and per-fill-net branches");
    assert.ok(
      page.includes('label: "Trade P&L (before fees)"'),
      "KPI must fall back to 'Trade P&L (before fees)' when no net source is available",
    );
    assert.ok(page.includes("brokerWindowNet"), "broker-net branch uses the day-net window total");
    assert.ok(page.includes("stats.netPnl"), "per-fill-net branch uses stats.netPnl");
    assert.ok(page.includes("stats.grossPnl"), "fill-only branch uses stats.grossPnl");
  });

  it("Trades page subtitle uses broker source label when broker history is available", () => {
    assert.ok(
      page.includes("brokerSourceLabel(brokerSource)"),
      "subtitle must call brokerSourceLabel(brokerSource) for honest source wording",
    );
    assert.ok(
      page.includes("earliestBrokerDay"),
      "subtitle must reference earliestBrokerDay from broker performance",
    );
    assert.ok(
      page.includes("Imported history only"),
      "subtitle must still have 'Imported history only' for the fallback (source=none) path",
    );
  });

  it("Trades Win Rate KPI uses broker day-level win rate when broker history available", () => {
    assert.ok(
      page.includes("brokerWinRate"),
      "Win Rate card must use brokerWinRate (broker day wins / non-zero days)",
    );
    assert.ok(
      page.includes("broker net days"),
      "Win Rate sub-label must say 'broker net days' to distinguish from fill-based win rate",
    );
    assert.ok(
      page.includes("imported fills"),
      "Trades card sub must say 'imported fills' so it is clearly fill-based, not broker days",
    );
  });

  it("KPI broker-net branch does NOT show fill P&L in the sub-label", () => {
    // Source-of-truth rule: when broker Cash History is the primary, the confusing
    // 'Fill P&L $X before fees' subtext is removed from the Net P&L KPI card.
    // Mixing fill gross with broker net -$0.40 misleads the trader.
    // The sub-label should only say 'after broker fees' (plus coverage ratio when partial).
    assert.ok(
      !page.includes("Fill P&L ${fmt$(stats.grossPnl)} before fees"),
      "broker-net KPI sub must NOT include fill P&L — it conflicts with broker net -$0.40",
    );
  });

  it("day header is a two-column layout: date left, net P&L label+value right", () => {
    // The day header must NOT use the old concatenated raw-text form.
    assert.ok(
      !page.includes('" net · after broker fees"'),
      "day header must NOT use the old raw concatenation '... net · after broker fees'",
    );
    // Must have separate label and value lines on the right.
    assert.ok(
      page.includes("Net P&L ${fmt$(day.pnl)}"),
      "day header right side must render 'Net P&L <value>' as the primary line",
    );
    assert.ok(
      page.includes("after broker fees · "),
      "day header sub-line must say 'after broker fees' for broker-net days",
    );
  });

  it("Trades table has Trade P&L, Fees, and Net P&L columns", () => {
    assert.ok(page.includes('"Trade P&L"'), "must have a 'Trade P&L' (fill/gross) column");
    assert.ok(page.includes('"Fees"'), "must have a 'Fees' column");
    assert.ok(page.includes('"Net P&L"'), "must have a 'Net P&L' column");
  });

  it("Trades table shows 'Not reported' for fees and '—' for Net when not determinable", () => {
    assert.ok(
      page.includes('"Not reported"'),
      "Fees cell must show 'Not reported' when fees cannot be determined",
    );
    assert.ok(
      page.includes('"—"'),
      "Net P&L cell must show '—' when net cannot be determined",
    );
    // Row resolution uses resolveTradeRowNet — not the raw t.feesAvailable flag directly.
    assert.ok(
      page.includes("resolveTradeRowNet"),
      "row cells must use resolveTradeRowNet to support single-trade day inference",
    );
    assert.ok(
      page.includes("rowRes.net"),
      "Net P&L cell must branch on rowRes.net (not raw t.feesAvailable)",
    );
  });

  it("single-trade day: fees and net are inferred from broker day net via resolveTradeRowNet", () => {
    // When a day has exactly one round-trip and brokerDayNet[date] exists,
    // resolveTradeRowNet must back-infer fees = brokerDayNet - tradePnl and
    // net = brokerDayNet. The page must import and call resolveTradeRowNet.
    const dayNet = read("app/trades/day-net.ts");
    assert.ok(
      dayNet.includes("resolveTradeRowNet"),
      "day-net.ts must export resolveTradeRowNet",
    );
    assert.ok(
      dayNet.includes("tradesInDay === 1") && dayNet.includes("brokerDayNet != null"),
      "resolveTradeRowNet must special-case single-trade days with broker net",
    );
    assert.ok(
      dayNet.includes("brokerDayNet - trade.pnl"),
      "inferred fees must be computed as brokerDayNet - tradePnl",
    );
    assert.ok(
      page.includes("resolveTradeRowNet"),
      "page must call resolveTradeRowNet for each row",
    );
  });

  it("Trades footer is concise and explains the data sources", () => {
    assert.ok(page.includes("before fees"), "footer must mention before fees");
    // Footer references the broker source via the source-aware label helper.
    assert.ok(
      page.includes("brokerSourceLabel(brokerSource)"),
      "footer must reference the broker source via brokerSourceLabel(brokerSource)",
    );
    // No longer a long multi-sentence paragraph — must be concise.
    assert.ok(
      page.includes("Day totals use"),
      "footer must open with the short 'Day totals use …' sentence",
    );
  });

  it("P&L calendar does NOT label fill-only values 'Net' — branches on feesAvailable", () => {
    assert.ok(calendar.includes("feesAvailable"), "calendar must branch on feesAvailable");
    assert.ok(
      calendar.includes("Fill P&amp;L (before fees)") || calendar.includes("Fill P&L (before fees)"),
      "calendar must label values 'Fill P&L (before fees)' when fees are unavailable",
    );
    assert.ok(
      !calendar.includes("Gross round-trip"),
      "calendar must not use 'Gross round-trip' wording",
    );
  });

  it("Dashboard session trades column does NOT say 'Net P&L' when fees missing", () => {
    assert.ok(
      dashboard.includes("sessionTradesNet") && dashboard.includes("sessionTradesPnlLabel"),
      "dashboard session trades must branch the column label on fee availability",
    );
    assert.ok(
      dashboard.includes('? "Net P&L" : "Trade P&L"'),
      "label is 'Net P&L' only when every shown trade has fees; otherwise 'Trade P&L'",
    );
    assert.ok(
      dashboard.includes("t.feesAvailable ? t.netPnl : t.pnl"),
      "rows must render net only when fees are available, else fill P&L",
    );
  });

  it("Dashboard 'Broker session P&L snapshot' remains the authoritative net session value", () => {
    assert.ok(
      dashboard.includes("Broker session P&L snapshot"),
      "dashboard must still show the broker session P&L snapshot (authoritative net)",
    );
    assert.ok(
      dashboard.includes("selectedAccount.dailyPnl"),
      "Broker session P&L card must use selectedAccount.dailyPnl (broker snapshot)",
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

  it("Fee ingestion: fillFee/list is wrapped read-only and merged into executions", () => {
    const client = read("lib/brokers/tradovate-client.ts");
    assert.ok(
      client.includes('"fillFee/list"'),
      "client must wrap the read-only fillFee/list endpoint",
    );
    assert.ok(
      client.includes("getFillFeesByFillId"),
      "client must expose per-fill fee totals keyed by fillId",
    );
    assert.ok(
      client.includes("commission,"),
      "toExecutions must attach the merged commission total to each execution",
    );
    // Read-only: the fee fetch must NOT introduce any broker write verbs.
    assert.ok(
      !/fillFee\/(create|update|delete)/.test(client),
      "fee ingestion must be read-only — no fillFee writes",
    );
    const sync = read("lib/brokers/tradovate-sync.ts");
    assert.ok(
      sync.includes("commission: ex.commission"),
      "sync must persist commission into rawPayload (no schema column)",
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
