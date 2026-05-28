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
    assert.ok(
      page.includes("P&L calendar") || page.includes("P&amp;L calendar"),
      "must render a P&L calendar heading",
    );
    assert.ok(
      page.includes("dayMap"),
      "must aggregate trades by day (dayMap)",
    );
    assert.ok(
      page.includes("No closed trades in the last 30 days"),
      "must show an honest empty state when no calendar data exists",
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
  });

  it("today's trades panel links to /trades?accountId=", () => {
    assert.ok(
      /href=.*\/trades\?accountId=/.test(page),
      "today's trades 'All trades' link must go to /trades?accountId=<selectedAccountId>",
    );
  });
});
