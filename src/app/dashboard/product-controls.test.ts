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

describe("GrShell: header controls are not dead buttons", () => {
  const shell = read("components/ui/gr-shell.tsx");

  it("bell button links to /alerts", () => {
    assert.ok(
      shell.includes('href="/alerts"'),
      "bell must link to /alerts",
    );
  });

  it("avatar opens a user menu with settings link", () => {
    assert.ok(
      shell.includes('href="/settings"'),
      "avatar dropdown must include a link to /settings",
    );
  });

  it("avatar menu includes logout action", () => {
    assert.ok(
      shell.includes("LogoutButton"),
      "avatar dropdown must include LogoutButton",
    );
  });

  it("quick-nav palette has navigation links", () => {
    assert.ok(
      shell.includes("Quick nav"),
      "quick action must say 'Quick nav' (not the old dead 'Quick action')",
    );
    assert.ok(
      shell.includes("resolvedNav.filter"),
      "quick nav must iterate the resolvedNav items to build links",
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
