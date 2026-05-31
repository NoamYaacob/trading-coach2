/**
 * Source-scan contract tests for dashboard product controls.
 * Asserts that UI controls that were previously dead are now wired up,
 * and that the layout follows the single-CTA and no-duplicate-info rules.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), "src");
function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

describe("GrShell: header controls are functional dropdowns", () => {
  const shell = read("components/ui/gr-shell.tsx");

  it("bell is a dropdown with recent alerts and a 'View all alerts' link", () => {
    assert.ok(
      shell.includes("bellOpen") && shell.includes("setBellOpen"),
      "bell must be a stateful dropdown (bellOpen state)",
    );
    assert.ok(
      shell.includes("Recent alerts"),
      "bell dropdown must show a 'Recent alerts' heading",
    );
    assert.ok(
      shell.includes("View all alerts"),
      "bell dropdown must include a 'View all alerts' link to /alerts",
    );
  });

  it("bell shows an unread-count badge when alerts exist", () => {
    assert.ok(
      shell.includes("activeAlertCount"),
      "bell must compute activeAlertCount from recentAlerts",
    );
  });

  it("avatar menu includes account/profile, billing, and logout", () => {
    assert.ok(
      shell.includes("Account &amp; profile") || shell.includes("Account & profile"),
      "avatar dropdown must include 'Account & profile'",
    );
    assert.ok(
      shell.includes("Plan &amp; billing") || shell.includes("Plan & billing"),
      "avatar dropdown must include 'Plan & billing'",
    );
    assert.ok(
      shell.includes("LogoutButton"),
      "avatar dropdown must include LogoutButton",
    );
    assert.ok(
      shell.includes('href="/pricing"'),
      "Plan & billing must link to the existing /pricing page",
    );
  });

  it("quick-nav palette has both Navigate and Actions sections", () => {
    assert.ok(
      shell.includes("Quick nav"),
      "quick action must say 'Quick nav' (not the old dead 'Quick action')",
    );
    assert.ok(
      shell.includes("resolvedNav.filter"),
      "quick nav must iterate the resolvedNav items to build navigation links",
    );
    assert.ok(
      shell.includes("Navigate") && shell.includes("Actions"),
      "quick nav must have both Navigate and Actions section headers",
    );
    assert.ok(
      shell.includes("Connect account"),
      "quick nav Actions must include 'Connect account'",
    );
    assert.ok(
      shell.includes("GrShellSyncButton"),
      "quick nav Actions must include the Sync accounts button",
    );
  });
});

describe("GrShellSyncButton: client action", () => {
  const btn = read("components/ui/gr-shell-sync-button.tsx");
  it("calls POST /api/accounts/sync-all", () => {
    assert.ok(
      btn.includes('"/api/accounts/sync-all"'),
      "sync button must POST to /api/accounts/sync-all",
    );
    assert.ok(
      btn.includes('method: "POST"'),
      "sync button must use POST method",
    );
    assert.ok(
      btn.includes("router.refresh"),
      "sync button must router.refresh() on success",
    );
  });
});

describe("/dashboard: passes alerts data to the shell", () => {
  const page = read("app/dashboard/page.tsx");
  it("dashboard maps activeViolations into bellAlerts for the shell", () => {
    assert.ok(
      page.includes("bellAlerts"),
      "dashboard must build a bellAlerts payload",
    );
    assert.ok(
      page.includes("recentAlerts={bellAlerts}"),
      "dashboard must pass bellAlerts to <GrShell recentAlerts={...} />",
    );
  });
});

describe("/dashboard: layout and CTA hygiene", () => {
  const page = read("app/dashboard/page.tsx");

  it("no duplicate 'Connect another' tile alongside the hero CTA", () => {
    assert.ok(
      !page.includes("Connect another"),
      "the 'Connect another' dashed tile must be removed (the hero '+ Connect account' button is the single CTA)",
    );
  });

  it("Accounts detail section only shows when expired accounts exist", () => {
    // The section gated on hasExpiredAccount should contain the expired heading
    const expiredSectionStart = page.indexOf("{hasExpiredAccount && (");
    assert.ok(expiredSectionStart !== -1, "must have a {hasExpiredAccount && ( conditional block");
    const afterGate = page.slice(expiredSectionStart, expiredSectionStart + 2000);
    assert.ok(
      afterGate.includes("Expired / unavailable accounts"),
      "Accounts detail section must be gated on hasExpiredAccount and contain the expired heading",
    );
  });

  it("active rules panel shows progress bars for quantitative rules", () => {
    assert.ok(
      page.includes("rulePct"),
      "rules panel must compute rulePct for daily loss / trades / loss streak",
    );
    assert.ok(
      page.includes("ruleValueLabel"),
      "rules panel must compute value labels for progress-bar rows",
    );
    assert.ok(
      /width.*pct.*100/.test(page),
      "rules panel must render a progress bar using the pct value",
    );
  });

  it("P&L calendar section exists and uses real trade data", () => {
    // The calendar moved into its own client component file.  The dashboard
    // still imports + renders <PnlCalendar /> but the dayMap / empty-state
    // wiring lives in the component now.
    assert.ok(
      page.includes("<PnlCalendar"),
      "dashboard must render the <PnlCalendar /> client island",
    );
    const calendar = read("app/dashboard/_components/pnl-calendar.tsx");
    assert.ok(
      calendar.includes("dayMap"),
      "calendar must aggregate trades by day (dayMap)",
    );
    assert.ok(
      calendar.includes("No closed trades in the last 30 days"),
      "calendar must show an honest empty state when no data exists",
    );
  });

  it("equity curve loads 30 days of trades (not 7)", () => {
    assert.ok(
      page.includes("thirtyDaysAgo"),
      "must use thirtyDaysAgo for the trade load window",
    );
    assert.ok(
      !page.includes("sevenDaysAgo"),
      "must not use the old sevenDaysAgo variable",
    );
    // The equity-curve UI moved to its own client component with timeframe
    // toggles.  Verify the file exists and exposes the toggle states.
    const equity = read("app/dashboard/_components/equity-curve.tsx");
    assert.ok(
      equity.includes("\"7d\"") && equity.includes("\"30d\"") && equity.includes("\"all\""),
      "equity curve component must expose 7d / 30d / all timeframe states",
    );
  });

  it("today's trades panel links to /trades?accountId=", () => {
    assert.ok(
      /href=.*\/trades\?accountId=/.test(page),
      "today's trades 'All trades' link must go to /trades?accountId=<selectedAccountId>",
    );
  });
});

describe("/dashboard: hero sync button is the real sync action", () => {
  const page = read("app/dashboard/page.tsx");

  it("imports SyncAllButton from the command-center module", () => {
    assert.ok(
      page.includes("SyncAllButton"),
      "dashboard must import SyncAllButton",
    );
  });

  it("does not use a plain <Link href='/dashboard'> as the sync control", () => {
    assert.ok(
      !page.includes('href="/dashboard"'),
      "the sync control must not be a plain /dashboard reload link — it must use SyncAllButton",
    );
  });

  it("renders <SyncAllButton /> in the hero area when a broker account is connected", () => {
    assert.ok(
      page.includes("<SyncAllButton"),
      "dashboard must render <SyncAllButton /> so sync actually fires",
    );
  });
});

describe("/dashboard: pnlColor uses red for negative values", () => {
  const page = read("app/dashboard/page.tsx");

  it("pnlColor returns var(--gr-bad) for negative P&L, not var(--gr-warn)", () => {
    assert.ok(
      page.includes('if (v < 0) return "var(--gr-bad)"'),
      "negative P&L must use --gr-bad (red), not --gr-warn (amber)",
    );
    assert.ok(
      !page.includes('if (v < 0) return "var(--gr-warn)"'),
      "pnlColor must not return --gr-warn for negative values",
    );
  });
});

describe("/dashboard: account display helpers", () => {
  const page = read("app/dashboard/page.tsx");

  it("imports deriveAccountDisplayLabel from the shared account-display helper", () => {
    assert.ok(
      page.includes('deriveAccountDisplayLabel') && page.includes('@/lib/account-display'),
      "dashboard must import deriveAccountDisplayLabel from @/lib/account-display",
    );
  });

  it("uses deriveAccountDisplayLabel for all label render sites", () => {
    const callCount = (page.match(/deriveAccountDisplayLabel\(/g) ?? []).length;
    assert.ok(
      callCount >= 6,
      `dashboard must call deriveAccountDisplayLabel at least 6 times (sidebar, cards, now-viewing, active-rules, today-trades, pnl-calendar, expired); found ${callCount}`,
    );
  });

  it("long broker labels are truncated with title tooltip", () => {
    assert.ok(
      page.includes('title={acc.label}'),
      "account display must keep title={acc.label} for tooltip on full broker name",
    );
    assert.ok(
      page.includes('title={selectedAccount.label}'),
      "selected account label sites must keep title={selectedAccount.label} for tooltip",
    );
  });
});

describe("/dashboard: hero greeting does not expose email-derived username", () => {
  const page = read("app/dashboard/page.tsx");

  it("greeting is just timeGreeting() with no appended username", () => {
    assert.ok(
      !page.includes('{timeGreeting()}, {displayName}'),
      "hero must not render '{timeGreeting()}, {displayName}' — no email-derived username",
    );
    assert.ok(
      !page.includes('const displayName = emailName'),
      "dashboard must not construct displayName from the email prefix",
    );
  });

  it("emailName is not constructed from user email for display", () => {
    assert.ok(
      !page.includes('emailName.charAt(0).toUpperCase()'),
      "dashboard must not uppercase an email prefix for display",
    );
  });
});

describe("/dashboard: P&L calendar is compact", () => {
  const calendar = read("app/dashboard/_components/pnl-calendar.tsx");

  it("calendar cell minHeight is reduced for compact display", () => {
    const match = calendar.match(/minHeight:\s*(\d+)/);
    const minH = match ? parseInt(match[1] ?? "0", 10) : 0;
    assert.ok(
      minH < 55,
      `P&L calendar cell minHeight must be < 55px for compact display; found ${minH}`,
    );
  });

  it("calendar outer padding is reduced", () => {
    const match = calendar.match(/padding:\s*(\d+)/);
    const pad = match ? parseInt(match[1] ?? "0", 10) : 0;
    assert.ok(
      pad < 22,
      `P&L calendar outer padding must be < 22 for compact display; found ${pad}`,
    );
  });
});

describe("/dashboard: P&L calendar grid is constrained, not stretched", () => {
  const calendar = read("app/dashboard/_components/pnl-calendar.tsx");

  it("wraps the grid in a centered, narrow max-width inner column", () => {
    const match = calendar.match(/maxWidth:\s*(\d+)/);
    const maxW = match ? parseInt(match[1] ?? "0", 10) : 0;
    assert.ok(
      maxW >= 600 && maxW <= 820,
      `calendar grid must sit in a narrow, intentionally centered column (~680–760px); found maxWidth ${maxW}`,
    );
    assert.ok(
      calendar.includes('margin: "0 auto"'),
      "the constrained inner column must be centered (margin: 0 auto)",
    );
  });

  it("still uses a 7-column grid with readable gaps", () => {
    assert.ok(
      calendar.includes('gridTemplateColumns: "repeat(7, 1fr)"'),
      "calendar must keep a 7-column week grid",
    );
  });
});

describe("/dashboard: P&L calendar day cells show trade count and link to trades", () => {
  const calendar = read("app/dashboard/_components/pnl-calendar.tsx");
  const page = read("app/dashboard/page.tsx");

  it("calendar cell renders trade count when day has trades", () => {
    assert.ok(
      calendar.includes("data!.count") && calendar.includes("}T"),
      "calendar must render the trade count (e.g. '4T') inside each day cell with trades",
    );
  });

  it("calendar accepts accountId prop for day-click deep links", () => {
    assert.ok(
      calendar.includes("accountId: string"),
      "PnlCalendar Props must include accountId: string",
    );
    assert.ok(
      calendar.includes("accountId"),
      "PnlCalendar must use accountId",
    );
  });

  it("calendar day cells with trades link to /trades with accountId and date", () => {
    assert.ok(
      calendar.includes("/trades?accountId="),
      "calendar day cells must link to /trades?accountId=...",
    );
    assert.ok(
      calendar.includes("&date="),
      "calendar day links must include &date= for the specific day",
    );
  });

  it("dashboard passes accountId to PnlCalendar", () => {
    assert.ok(
      page.includes("accountId={selectedAccount.id}"),
      "dashboard must pass accountId={selectedAccount.id} to <PnlCalendar>",
    );
  });
});

describe("/dashboard: equity curve is a Lightweight Charts area chart", () => {
  const equity = read("app/dashboard/_components/equity-curve.tsx");

  it("imports from the lightweight-charts library", () => {
    assert.ok(
      /from\s+["']lightweight-charts["']/.test(equity),
      "equity curve must import its chart primitives from 'lightweight-charts'",
    );
  });

  it("no longer uses Recharts", () => {
    assert.ok(
      !/from\s+["']recharts["']/.test(equity),
      "equity curve must not import from 'recharts' anymore",
    );
    assert.ok(
      !equity.includes("ResponsiveContainer") &&
        !equity.includes("AreaChart") &&
        !equity.includes("CartesianGrid"),
      "equity curve must not reference Recharts components (ResponsiveContainer/AreaChart/CartesianGrid)",
    );
  });

  it("creates the chart via createChart against a ref'd container", () => {
    assert.ok(equity.includes("createChart("), "must call createChart()");
    assert.ok(
      equity.includes("useRef") && equity.includes("containerRef"),
      "chart must be created against a useRef'd container element",
    );
  });

  it("uses an Area series (not candlesticks)", () => {
    assert.ok(
      equity.includes("addSeries(AreaSeries"),
      "must add an Area series via addSeries(AreaSeries, ...)",
    );
    assert.ok(
      !equity.includes("CandlestickSeries"),
      "must not use a candlestick series",
    );
  });

  it("is client-only and never SSR-renders the canvas (created in useEffect)", () => {
    assert.ok(
      equity.includes('"use client"'),
      "equity curve must be a client component",
    );
    assert.ok(
      equity.includes("React.useEffect") || equity.includes("useEffect"),
      "chart must be created inside an effect so it never runs during SSR",
    );
  });

  it("handles responsive width via ResizeObserver", () => {
    assert.ok(
      equity.includes("ResizeObserver"),
      "chart width must respond to container resize via ResizeObserver",
    );
  });

  it("has a subtle green gradient area fill (low alpha top color)", () => {
    assert.ok(
      equity.includes("topColor") && equity.includes("bottomColor"),
      "Area series must define topColor/bottomColor for the gradient fill",
    );
    const alphas = [...equity.matchAll(/rgba\(lineColor,\s*([\d.]+)\)/g)].map((m) =>
      parseFloat(m[1] ?? "1"),
    );
    const top = Math.max(...alphas, 0);
    assert.ok(top > 0 && top <= 0.3, `gradient fill must stay subtle (alpha <= 0.3); found ${top}`);
  });

  it("removes all grid lines for a clean, premium look", () => {
    assert.ok(
      /vertLines:\s*\{\s*visible:\s*false\s*\}/.test(equity),
      "vertical grid lines must be hidden",
    );
    assert.ok(
      /horzLines:\s*\{\s*visible:\s*false\s*\}/.test(equity),
      "horizontal grid lines must be hidden to reduce chart noise",
    );
  });

  it("hides the technical right-side price scale labels", () => {
    assert.ok(
      /rightPriceScale:\s*\{[^}]*visible:\s*false/.test(equity),
      "the right-side price scale must be hidden (visible: false) so the card doesn't feel like a terminal",
    );
  });

  it("hides the default time axis (custom date labels are rendered instead)", () => {
    assert.ok(
      /timeScale:\s*\{[^}]*visible:\s*false/.test(equity),
      "the built-in time axis must be hidden — it repeats ugly same-day day-numbers",
    );
    assert.ok(
      equity.includes("buildAxisLabels"),
      "the component must render its own clean date labels via buildAxisLabels",
    );
  });

  it("deduplicates date labels so same-day data never repeats (no '29 / 29 / 29')", () => {
    assert.ok(
      equity.includes("if (first === last) return [first]"),
      "same-day windows must collapse to a single centered label",
    );
    assert.ok(
      equity.includes("if (mid === first || mid === last) return [first, last]"),
      "a middle label equal to an endpoint must be dropped (no repeated labels)",
    );
  });

  it("uses a clean, financial-style line type (Simple — not cartoonishly curved)", () => {
    assert.ok(
      equity.includes("lineType: LineType.Simple"),
      "the line must use LineType.Simple for a clean financial-chart look",
    );
  });

  it("uses a compact dashboard height (160–210px)", () => {
    const match = equity.match(/CHART_HEIGHT\s*=\s*(\d+)/);
    const h = match ? parseInt(match[1] ?? "0", 10) : 0;
    assert.ok(
      h >= 160 && h <= 210,
      `chart height must be compact (160–210px); found ${h}`,
    );
  });

  it("has a minimal crosshair tooltip labelled cumulative realized P&L", () => {
    assert.ok(
      equity.includes("subscribeCrosshairMove"),
      "must wire a crosshair tooltip via subscribeCrosshairMove",
    );
    assert.ok(
      equity.includes("Cumulative realized P&amp;L") ||
        equity.includes("Cumulative realized P&L"),
      "tooltip must label the value as cumulative realized P&L",
    );
    assert.ok(
      equity.includes("fmtTooltipDate") || equity.includes("toLocaleDateString"),
      "tooltip must show a formatted date",
    );
  });

  it("uses a thin, professional line stroke (lineWidth <= 2)", () => {
    const lw = [...equity.matchAll(/lineWidth:\s*([\d.]+)/g)].map((m) =>
      parseFloat(m[1] ?? "0"),
    );
    assert.ok(
      lw.some((w) => w > 0 && w <= 2),
      "the Area line must use a thin/professional line weight (<= 2)",
    );
  });

  it("converts trade close times to a valid Lightweight Charts time", () => {
    assert.ok(
      equity.includes("UTCTimestamp"),
      "trade times must be converted to a UTCTimestamp for the area data",
    );
    assert.ok(
      equity.includes("Math.floor(p.t / 1000)"),
      "ms timestamps must be converted to whole seconds for the time scale",
    );
  });

  it("avoids duplicate times when trades share a second/day", () => {
    assert.ok(
      equity.includes("bySecond") && equity.includes("Map"),
      "must collapse same-second trades so chart times stay unique and ascending",
    );
  });

  it("builds the series from real trade pnl only — no fake/demo/sample data", () => {
    assert.ok(
      equity.includes("trades: RoundTripTrade[]"),
      "equity curve must accept real round-trip trades",
    );
    assert.ok(
      equity.includes("cum += t.pnl"),
      "cumulative series must be accumulated from real trade pnl",
    );
    assert.ok(
      !equity.includes("Math.random") &&
        !equity.includes("fakeTrades") &&
        !equity.includes("demoTrades") &&
        !equity.includes("sampleData") &&
        !equity.includes("samplePoints"),
      "equity curve must not fabricate, randomize, or sample data",
    );
  });

  it("keeps all four timeframe controls (7D / 14D / 30D / All)", () => {
    assert.ok(
      equity.includes('"7d"') &&
        equity.includes('"14d"') &&
        equity.includes('"30d"') &&
        equity.includes('"all"'),
      "must keep the 7d/14d/30d/all timeframe states",
    );
    assert.ok(
      equity.includes('"7D"') &&
        equity.includes('"14D"') &&
        equity.includes('"30D"') &&
        equity.includes('"All"'),
      "must keep the visible 7D/14D/30D/All toggle labels",
    );
  });

  it("preserves the segmented-control range track", () => {
    assert.ok(
      equity.includes('background: "var(--gr-bg-elev)"') ||
        equity.includes("background: 'var(--gr-bg-elev)'"),
      "range pill group must keep a background track for the segmented-control look",
    );
  });

  it("preserves the 'Open →' link to the trades page", () => {
    assert.ok(
      equity.includes("Open →") && equity.includes("tradesHref"),
      "header must keep the 'Open →' link wired to tradesHref",
    );
  });

  it("keeps a large, prominent headline P&L value (fontSize >= 24)", () => {
    const matches = [...equity.matchAll(/fontSize:\s*(\d+)/g)].map((m) =>
      parseInt(m[1] ?? "0", 10),
    );
    assert.ok(
      Math.max(...matches, 0) >= 24,
      "equity curve headline must stay >= 24px for prominence",
    );
  });
});

describe("/dashboard: P&L calendar active-day cell quality", () => {
  const calendar = read("app/dashboard/_components/pnl-calendar.tsx");

  it("active day P&L value is rendered in monospace, colored by sign", () => {
    assert.ok(
      calendar.includes("var(--font-ibm-plex-mono") &&
        calendar.includes("var(--gr-ok)") &&
        calendar.includes("var(--gr-bad)"),
      "P&L value must use monospace font and design tokens for green/red coloring",
    );
  });

  it("trade count uses var(--gr-text-mute) color for legibility", () => {
    assert.ok(
      calendar.includes("var(--gr-text-mute)"),
      "calendar trade count must use --gr-text-mute (not faint) for clear legibility",
    );
  });

  it("bottom section has breathing room (gap >= 2)", () => {
    // Checks the gap inside the hasTrades bottom flex column.
    const gapMatch = calendar.match(/gap:\s*(\d+)/g);
    const gaps = (gapMatch ?? []).map((s) => parseInt(s.replace(/\D/g, ""), 10));
    assert.ok(
      gaps.some((g) => g >= 2),
      "calendar active-day bottom section must have gap >= 2 for breathing room",
    );
  });
});

describe("/dashboard: equity curve has a designed empty state", () => {
  const equity = read("app/dashboard/_components/equity-curve.tsx");

  it("shows the honest empty-state sentence for < 2 round-trips", () => {
    assert.ok(
      equity.includes(
        "Curve appears once at least 2 round-trips have closed in this window",
      ),
      "empty state must use the honest 'appears once at least 2 round-trips' copy",
    );
  });

  it("triggers the empty state when fewer than 2 trades exist in the window", () => {
    assert.ok(
      equity.includes("trades.length < 2"),
      "empty state must render whenever the window has fewer than 2 round-trips",
    );
  });

  it("distinguishes the zero-trade case with its own honest copy", () => {
    assert.ok(
      equity.includes("No closed round-trips in this window for this account"),
      "zero-trade case must show its own honest message",
    );
  });

  it("is an intentionally designed state, not a bare line (has a framed icon)", () => {
    // The designed empty state wraps a small chart glyph in a bordered tile.
    assert.ok(
      equity.includes("borderRadius: 11") || equity.includes("border: \"1px dashed var(--gr-border)\""),
      "empty state must be a designed block (framed icon / dashed container), not a raw chart",
    );
  });
});

describe("/dashboard: Active rules + Equity curve are not height-coupled", () => {
  const page = read("app/dashboard/page.tsx");

  // Anchor on the Row 1 comment — the bare className also appears in a
  // <style> media query, so we locate the actual <section> that follows it.
  const rowIdx = page.indexOf("Row 1: Active rules + Equity curve");

  it("the 2-column row opts out of grid stretch (alignItems: start)", () => {
    assert.ok(rowIdx !== -1, "must have the Row 1 (Active rules + Equity curve) section");
    const section = page.slice(rowIdx, rowIdx + 400);
    assert.ok(
      section.includes('alignItems: "start"'),
      "the Active-rules/Equity-curve row must use alignItems: 'start' so the rules card is content-height and not stretched to match the equity curve",
    );
  });

  it("preserves the 2-column desktop layout", () => {
    const section = page.slice(rowIdx, rowIdx + 400);
    assert.ok(
      section.includes('gridTemplateColumns: "1fr 1fr"'),
      "the row must remain a 2-column grid on desktop",
    );
  });

  it("does not force equal height via height:100% on the row's cards", () => {
    const section = page.slice(rowIdx, rowIdx + 1400);
    assert.ok(
      !/height:\s*"100%"/.test(section),
      "cards in the 2-col row must not use height: 100% to force equal height",
    );
  });
});

describe("/dashboard: equity curve fills its card naturally", () => {
  const equity = read("app/dashboard/_components/equity-curve.tsx");

  it("uses tight price-scale margins so the curve isn't stranded in empty space", () => {
    const m = equity.match(/scaleMargins:\s*\{\s*top:\s*([\d.]+),\s*bottom:\s*([\d.]+)/);
    assert.ok(m, "must set scaleMargins on the (hidden) price scale");
    const top = parseFloat(m![1] ?? "1");
    const bottom = parseFloat(m![2] ?? "1");
    assert.ok(
      top <= 0.14 && bottom <= 0.14,
      `scale margins must be tight so the line fills the card (<= 0.14); found top ${top}, bottom ${bottom}`,
    );
  });

  it("still uses lightweight-charts with both built-in axes hidden", () => {
    assert.ok(/from\s+["']lightweight-charts["']/.test(equity), "must keep lightweight-charts");
    assert.ok(
      /rightPriceScale:\s*\{[^}]*visible:\s*false/.test(equity),
      "right price scale must stay hidden",
    );
    assert.ok(
      /timeScale:\s*\{[^}]*visible:\s*false/.test(equity),
      "native time axis must stay hidden",
    );
  });
});

describe("/dashboard: P&L calendar vertical spacing is tightened", () => {
  const calendar = read("app/dashboard/_components/pnl-calendar.tsx");

  it("keeps the grid constrained and centered (~720)", () => {
    const m = calendar.match(/maxWidth:\s*(\d+)/);
    const w = m ? parseInt(m[1] ?? "0", 10) : 0;
    assert.ok(w >= 600 && w <= 820, `calendar inner column must stay narrow; found maxWidth ${w}`);
    assert.ok(calendar.includes('margin: "0 auto"'), "inner column must stay centered");
  });

  it("reduces the stacked-row vertical gaps (header / nav / summary)", () => {
    const bottoms = [...calendar.matchAll(/marginBottom:\s*(\d+)/g)].map((m) =>
      parseInt(m[1] ?? "0", 10),
    );
    // The only remaining 12px gap is the conditional past-data caveat banner;
    // header/nav/summary must all be tightened to <= 10.
    const nonCaveat = bottoms.filter((b) => b !== 12);
    assert.ok(
      nonCaveat.length > 0 && nonCaveat.every((b) => b <= 10),
      `stacked-row margins must be <= 10 after tightening; found ${bottoms.join(", ")}`,
    );
    assert.ok(
      bottoms.filter((b) => b <= 8).length >= 2,
      "the month-nav and summary rows must be tightened to <= 8px",
    );
  });

  it("still shows trade count and links traded days to /trades?accountId=&date=", () => {
    assert.ok(calendar.includes("data!.count}T"), "trade count must stay in traded cells");
    assert.ok(
      calendar.includes("/trades?accountId=") && calendar.includes("&date="),
      "traded days must still deep-link to /trades with accountId and date",
    );
    assert.ok(
      calendar.includes("hasTrades && accountId &&"),
      "only days with trades may be clickable",
    );
  });

  it("outer card padding is tight (<=12) for a compact card feel", () => {
    const m = calendar.match(/borderRadius: 14,\s*padding: (\d+)/);
    const pad = m ? parseInt(m[1] ?? "0", 10) : null;
    assert.ok(
      pad !== null && pad <= 12,
      `calendar outer padding must be <= 12 for a compact card; found ${pad}`,
    );
  });
});

describe("/dashboard: equity curve tooltip is compact and non-dominant", () => {
  const equity = read("app/dashboard/_components/equity-curve.tsx");

  it("tooltip padding is small so it doesn't cover the chart", () => {
    const m = equity.match(/padding:\s*["'](\d+)px\s+(\d+)px["']/);
    const vPad = m ? parseInt(m[1] ?? "0", 10) : null;
    assert.ok(
      vPad !== null && vPad <= 6,
      `tooltip vertical padding must be <= 6px; found ${vPad}`,
    );
  });

  it("tooltip shadow is soft and minimal", () => {
    assert.ok(
      equity.includes("rgba(0,0,0,0.07)") || equity.includes("rgba(0,0,0,0.08)"),
      "tooltip box-shadow must use a very low alpha (≤ 0.08) to stay non-dominant",
    );
  });

  it("date label row sits close to the chart (marginTop < -5)", () => {
    const m = equity.match(/marginTop:\s*(-\d+)/);
    const mt = m ? parseInt(m[1] ?? "0", 10) : 0;
    assert.ok(
      mt < -5,
      `date label row marginTop must be < -5 to sit tight against the chart; found ${mt}`,
    );
  });
});

describe("/dashboard: equity curve card padding is compact", () => {
  const equity = read("app/dashboard/_components/equity-curve.tsx");

  it("outer card uses tighter padding (<=18px)", () => {
    const m = equity.match(/padding:\s*["'](\d+)px\s+(\d+)px["']/);
    const vPad = m ? parseInt(m[1] ?? "0", 10) : null;
    // This regex captures the card padding "14px 16px" first match.
    assert.ok(
      vPad !== null && vPad <= 18,
      `card outer vertical padding must be <= 18px for a compact card; found ${vPad}`,
    );
  });
});
