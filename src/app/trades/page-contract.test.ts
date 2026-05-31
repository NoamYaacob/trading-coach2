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
      page.includes("No closed round-trips yet today"),
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

  it("h1 is 'Trades', not the selected account name", () => {
    assert.ok(
      page.includes(">Trades</h1>") ||
        /h1[^>]*>[^<]*Trades[^<]*<\/h1>/.test(page) ||
        page.includes("Trades\n          </h1>"),
      "h1 must be the stable page title 'Trades'",
    );
    assert.ok(
      !/<h1[^>]*>\s*\{selectedAccount/.test(page),
      "h1 must not render the dynamic account label — that belongs in the eyebrow",
    );
  });

  it("eyebrow/subtitle includes the selected account label for context", () => {
    assert.ok(
      page.includes("selectedAccount.label") &&
        page.includes("Closed round-trips"),
      "eyebrow must include both the account label and 'Closed round-trips' context",
    );
  });
});
