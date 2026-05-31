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

describe("/dashboard: equity curve is a Recharts area chart", () => {
  const equity = read("app/dashboard/_components/equity-curve.tsx");

  it("imports from the recharts library", () => {
    assert.ok(
      /from\s+["']recharts["']/.test(equity),
      "equity curve must import its chart primitives from 'recharts'",
    );
  });

  it("renders the chart inside a ResponsiveContainer", () => {
    assert.ok(
      equity.includes("ResponsiveContainer"),
      "chart must use a ResponsiveContainer so it sizes to the card",
    );
  });

  it("uses an AreaChart with an <Area> (filled curve)", () => {
    assert.ok(equity.includes("AreaChart"), "must use Recharts AreaChart");
    assert.ok(equity.includes("<Area"), "must render an <Area> series (filled line)");
  });

  it("uses a smooth, non-overshooting monotone curve", () => {
    assert.ok(
      equity.includes('type="monotone"'),
      "the Area must use type=\"monotone\" for a smooth curve that never overshoots the data",
    );
  });

  it("has a subtle gradient fill under the line (top opacity <= 0.3)", () => {
    assert.ok(
      equity.includes("linearGradient") && equity.includes("stopOpacity"),
      "must define a linear gradient fill via stopOpacity stops",
    );
    const opacities = [...equity.matchAll(/stopOpacity=\{?([\d.]+)\}?/g)].map((m) =>
      parseFloat(m[1] ?? "0"),
    );
    const top = Math.max(...opacities, 0);
    assert.ok(top > 0, "gradient fill must be present (top opacity > 0)");
    assert.ok(top <= 0.3, `gradient fill must stay subtle (top opacity <= 0.3); found ${top}`);
  });

  it("renders light horizontal grid lines without vertical clutter", () => {
    assert.ok(equity.includes("CartesianGrid"), "must render a CartesianGrid");
    assert.ok(
      equity.includes("vertical={false}"),
      "grid must hide vertical lines to keep the chart clean",
    );
  });

  it("formats minimal X-axis date ticks", () => {
    assert.ok(equity.includes("XAxis"), "must render an XAxis");
    assert.ok(
      equity.includes("tickFormatter"),
      "X axis must format ticks into readable date labels",
    );
  });

  it("hides Y-axis clutter while keeping the chart readable", () => {
    assert.ok(
      /<YAxis\b[^>]*\bhide\b/.test(equity),
      "YAxis must be hidden (hide) to reduce visual clutter",
    );
  });

  it("has a tooltip that labels the value as cumulative realized P&L", () => {
    assert.ok(equity.includes("<Tooltip"), "must render a Recharts <Tooltip>");
    assert.ok(
      equity.includes("Cumulative realized P&amp;L") ||
        equity.includes("Cumulative realized P&L"),
      "tooltip must label the value as cumulative realized P&L",
    );
    assert.ok(
      equity.includes("fmtTooltipDate") || equity.includes("toLocaleDateString"),
      "tooltip must show a formatted date/time",
    );
  });

  it("uses a thin, professional line stroke (strokeWidth <= 2.5)", () => {
    const sw = [...equity.matchAll(/strokeWidth=\{?([\d.]+)\}?/g)].map((m) =>
      parseFloat(m[1] ?? "0"),
    );
    assert.ok(
      sw.some((w) => w > 0 && w <= 2.5),
      "the Area line must use a thin/professional stroke weight (<= 2.5)",
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
