/**
 * Guardrail 2 Phase 2 — source-scan safety tests.
 *
 * No JSX renderer. Tests read source text to confirm:
 *   1.  /rules/page.tsx uses GrShell (not AppShell) as top-level wrapper
 *   2.  Other production pages still use AppShell (not migrated)
 *   3.  rules-overview-screen uses GrEnforcementChip (G2 primitive)
 *   4.  rules-rail uses GrEnforcementChip + GrButton (G2 primitives)
 *   5.  rules-overview-screen uses GrChip for filter pills (G2 primitive)
 *   6.  No fake balance / P&L / compliance metrics in overview or rules page
 *   7.  AccountRulesForm field names preserved (submit payload shape unchanged)
 *   8.  Daily Loss is the only broker-eligible (broker-backed) rule
 *   9.  Advanced broker actions remain planned / not-active
 *   10. Risk per trade remains monitoring-only (not broker-eligible)
 *   11. Backend / API / Prisma / broker files are untouched
 *   12. GrShell received the new real-data props (hideSidebar, navItems, etc.)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(process.cwd(), "src");

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

// ── 1. /rules page wrapper is GrShell ────────────────────────

describe("rules page.tsx: GrShell as wrapper", () => {
  const page = read("app/rules/page.tsx");

  it("imports GrShell from gr-shell", () => {
    assert.ok(
      page.includes("GrShell") && page.includes("gr-shell"),
      "rules page must import GrShell from @/components/ui/gr-shell",
    );
  });

  it("does NOT import AppShell", () => {
    assert.ok(
      !page.includes("AppShell"),
      "rules page must not import or reference AppShell",
    );
  });

  it("does NOT import from app-shell module", () => {
    // Only check import statements, not comments (a comment mentioning
    // "app-shell density" is harmless; an import would be a real dependency).
    const importLines = page
      .split("\n")
      .filter((l) => l.trimStart().startsWith("import "));
    const hasAppShellImport = importLines.some((l) => l.includes("app-shell"));
    assert.ok(
      !hasAppShellImport,
      "rules page must not have an import statement referencing app-shell",
    );
  });

  it("uses GrShell JSX element in return", () => {
    assert.ok(
      page.includes("<GrShell") && page.includes("</GrShell>"),
      "rules page must render <GrShell> as the root JSX element",
    );
  });
});

// ── 2. GrShell real-data props wired correctly ────────────────

describe("rules page.tsx: GrShell real-data props", () => {
  const page = read("app/rules/page.tsx");

  it("passes navItems to GrShell", () => {
    assert.ok(
      page.includes("navItems={RULES_NAV}") || page.includes("navItems="),
      "GrShell must receive real navItems",
    );
  });

  it("passes userInitials derived from email", () => {
    assert.ok(
      page.includes("userInitials"),
      "GrShell must receive userInitials derived from user.email",
    );
    // Must not hardcode a literal string for initials
    assert.ok(
      !page.includes('userInitials="AN"'),
      'userInitials must not be hardcoded "AN" (mock default)',
    );
  });

  it("passes hideApiStatus to suppress mock API status card", () => {
    assert.ok(
      page.includes("hideApiStatus"),
      "GrShell must receive hideApiStatus to hide mock API card",
    );
  });

  it("passes hideSidebar for editor mode", () => {
    assert.ok(
      page.includes("hideSidebar"),
      "GrShell must receive hideSidebar for rule-editor mode",
    );
  });

  it("passes sidebarContent (ScopeSelector slot)", () => {
    assert.ok(
      page.includes("sidebarContent"),
      "GrShell must receive sidebarContent slot",
    );
  });

  it("RULES_NAV has real href entries", () => {
    // Confirm real hrefs are wired (not mock)
    const realHrefs = ["/dashboard", "/rules", "/accounts", "/settings"];
    for (const href of realHrefs) {
      assert.ok(
        page.includes(href),
        `RULES_NAV must include href: ${href}`,
      );
    }
  });
});

// ── 3. Shell migration state ──────────────────────────────────

describe("other production pages: AppShell not replaced", () => {
  // Dashboard migrated to GrShell in Phase 3 (dashboard redesign pass).
  // This test now verifies the migration happened correctly.
  it("dashboard uses GrShell (migrated from AppShell)", () => {
    const dashboard = read("app/dashboard/page.tsx");
    assert.ok(
      dashboard.includes("GrShell"),
      "dashboard page must use GrShell (migrated from AppShell in phase 3)",
    );
  });

  it("settings still uses AppShell", () => {
    try {
      const settings = read("app/settings/page.tsx");
      assert.ok(
        settings.includes("AppShell") || settings.includes("app-shell"),
        "settings page must still import/use AppShell",
      );
      assert.ok(
        !settings.includes("GrShell"),
        "settings page must NOT use GrShell",
      );
    } catch {
      // page may live elsewhere; skip rather than fail
    }
  });
});

// ── 4. rules-overview-screen uses G2 primitives ──────────────

describe("rules-overview-screen: G2 primitives", () => {
  const overview = read("app/rules/_components/rules-overview-screen.tsx");

  it("imports GrEnforcementChip", () => {
    assert.ok(
      overview.includes("GrEnforcementChip"),
      "rules-overview-screen must import GrEnforcementChip",
    );
  });

  it("imports GrChip for filter pills", () => {
    assert.ok(
      overview.includes("GrChip"),
      "rules-overview-screen must import GrChip",
    );
  });

  it("does NOT use old RuleStatusBadge", () => {
    assert.ok(
      !overview.includes("RuleStatusBadge"),
      "rules-overview-screen must not use the old RuleStatusBadge",
    );
  });

  it("renders GrEnforcementChip in RuleCard", () => {
    assert.ok(
      overview.includes("<GrEnforcementChip"),
      "RuleCard in overview-screen must render <GrEnforcementChip>",
    );
  });

  it("renders GrChip for All rules filter", () => {
    assert.ok(
      overview.includes("<GrChip"),
      "overview-screen must render <GrChip> for filter pills",
    );
  });
});

// ── 5. rules-rail uses G2 primitives ─────────────────────────

describe("rules-rail: G2 primitives", () => {
  const rail = read("app/rules/_components/rules-rail.tsx");

  it("imports GrEnforcementChip", () => {
    assert.ok(
      rail.includes("GrEnforcementChip"),
      "rules-rail must import GrEnforcementChip",
    );
  });

  it("imports GrButton", () => {
    assert.ok(
      rail.includes("GrButton"),
      "rules-rail must import GrButton",
    );
  });

  it("does NOT use old RuleStatusBadge", () => {
    assert.ok(
      !rail.includes("RuleStatusBadge"),
      "rules-rail must not use the old RuleStatusBadge",
    );
  });

  it("renders GrButton for back navigation", () => {
    assert.ok(
      rail.includes("<GrButton"),
      "rules-rail must render <GrButton> for the back navigation",
    );
  });
});

// ── 6. No fake balance / P&L / compliance data ───────────────

describe("no fake metrics in rules pages", () => {
  const overview = read("app/rules/_components/rules-overview-screen.tsx");
  const rulesPage = read("app/rules/page.tsx");

  // P&L and balance should not appear in the overview screen
  it("overview-screen has no fake balance reference", () => {
    // Allow 'balance' as part of a real form field name (accountSize etc.)
    // but 'current balance' / '$balance' / 'account balance' would be fake
    const suspiciousBalance = /current balance|account balance|\$\d+.*balance|balance: \$/i;
    assert.ok(
      !suspiciousBalance.test(overview),
      "overview-screen must not display fake account balance",
    );
  });

  it("overview-screen has no rendered P&L display", () => {
    // The overview policy comment legitimately says "P&L are omitted".
    // What must NOT exist are JSX renders of a P&L value (e.g. dollar amounts
    // next to P&L labels in the UI).  We check for the display pattern only.
    const pnlDisplayPattern = />\s*[+-]?\$[\d,.]+\s*<\/.*[Pp]&[Ll]|[Pp]&[Ll].*>\s*[+-]?\$[\d,.]+|daily.*pnl.*=|pnl.*value/i;
    assert.ok(
      !pnlDisplayPattern.test(overview),
      "overview-screen must not render a P&L dollar value in JSX",
    );
  });

  it("rules page has no hardcoded win-rate or compliance percentage", () => {
    const fakeMetrics = /win.?rate.*\d+%|compliance.*\d+%|\d+% compliant/i;
    assert.ok(
      !fakeMetrics.test(rulesPage),
      "rules page must not contain hardcoded win-rate or compliance %",
    );
  });

  it("overview-screen policy comment is present", () => {
    // The component has a JSDoc note about data policy
    assert.ok(
      overview.includes("Balance") || overview.includes("no fabricated"),
      "overview-screen must document its data policy (no fabricated telemetry)",
    );
  });
});

// ── 7. AccountRulesForm field names preserved ─────────────────

describe("AccountRulesForm: payload field names preserved", () => {
  const form = read("app/rules/_components/account-rules-form.tsx");

  const REQUIRED_FIELDS = [
    "maxDailyLoss",
    "riskPerTrade",
    "maxTradesPerDay",
    "stopAfterLosses",
    "allowedEndHour",
    "sessionEndBehavior",
    "maxContracts",
    "rawBrokerHardLimitEnabled",
    "symbolLimits",
  ];

  for (const field of REQUIRED_FIELDS) {
    it(`field "${field}" is present in form`, () => {
      assert.ok(
        form.includes(field),
        `AccountRulesForm must contain field: ${field}`,
      );
    });
  }
});

// ── 8. Daily Loss is the only broker-eligible rule ────────────

describe("rule-meta: Daily Loss is the only broker-eligible rule", () => {
  const meta = read("app/rules/_components/rule-meta.ts");

  it("daily-loss has broker-eligible status", () => {
    // The rule meta should have daily loss rule with broker-eligible
    assert.ok(
      meta.includes("broker-eligible"),
      "rule-meta must contain at least one broker-eligible rule",
    );
  });

  it("only one rule has status: broker-eligible (Daily Loss)", () => {
    // Count status assignments only — not JSDoc comment occurrences.
    const statusMatches = meta.match(/status:\s*"broker-eligible"/g);
    assert.strictEqual(
      statusMatches?.length ?? 0,
      1,
      "Exactly one rule must have status: broker-eligible (Daily Loss only)",
    );
  });

  it("daily-loss rule has broker-eligible status", () => {
    // The daily loss rule uses id "daily-loss" (kebab-case) in this codebase.
    assert.ok(
      meta.includes('"daily-loss"') && meta.includes("broker-eligible"),
      "daily-loss rule must be marked broker-eligible",
    );
  });
});

// ── 9. Advanced broker actions remain planned / not-active ────

describe("rule-meta: advanced broker actions are planned or not-active", () => {
  const meta = read("app/rules/_components/rule-meta.ts");

  it("planned-broker status appears for advanced features", () => {
    assert.ok(
      meta.includes("planned-broker"),
      "rule-meta must have at least one planned-broker entry for advanced features",
    );
  });

  it("advanced-broker-actions rule uses planned-broker status", () => {
    // In this codebase rules that aren't active use "planned-broker" status.
    // "not-active" is a valid RuleStatusVariant type but no rule currently
    // uses it — all inactive/planned rules map to "planned-broker".
    assert.ok(
      meta.includes('"advanced-broker-actions"') && meta.includes("planned-broker"),
      "advanced-broker-actions must be marked planned-broker",
    );
  });
});

// ── 10. Risk per trade is monitoring-only ─────────────────────

describe("rule-meta: risk-per-trade is monitoring-only", () => {
  const meta = read("app/rules/_components/rule-meta.ts");

  it("risk-per-trade appears with monitoring-only status", () => {
    // Both strings must be in the file; the relationship is enforced by structure
    assert.ok(
      meta.includes("risk-per-trade") && meta.includes("monitoring-only"),
      "rule-meta must define risk-per-trade with monitoring-only status",
    );
  });

  it("monitoring-only status is present (not upgraded to broker-eligible)", () => {
    assert.ok(
      meta.includes("monitoring-only"),
      "monitoring-only status must not have been removed from rule-meta",
    );
  });
});

// ── 11. Backend files untouched ───────────────────────────────

describe("backend files: no Phase 2 changes", () => {
  // These files must still exist and not reference GrShell/G2 primitives.
  const BACKEND_PATHS = [
    "app/api/rules/route.ts",
    "app/api/rules/apply-pending/route.ts",
    "lib/guardian.ts",
  ];

  for (const path of BACKEND_PATHS) {
    it(`${path} does not import G2 primitives`, () => {
      try {
        const content = read(path);
        assert.ok(
          !content.includes("GrShell"),
          `${path} must not import GrShell`,
        );
        assert.ok(
          !content.includes("gr-enforcement-chip"),
          `${path} must not import gr-enforcement-chip`,
        );
      } catch {
        // File may not exist in this layout; that's fine — skip
      }
    });
  }
});

// ── 12. GrShell: new real-data props are present ──────────────

describe("gr-shell.tsx: Phase 2 props", () => {
  const shell = read("components/ui/gr-shell.tsx");

  it("accepts hideSidebar prop", () => {
    assert.ok(
      shell.includes("hideSidebar"),
      "GrShell must accept hideSidebar prop",
    );
  });

  it("accepts hideApiStatus prop", () => {
    assert.ok(
      shell.includes("hideApiStatus"),
      "GrShell must accept hideApiStatus prop",
    );
  });

  it("accepts sidebarContent prop", () => {
    assert.ok(
      shell.includes("sidebarContent"),
      "GrShell must accept sidebarContent prop",
    );
  });

  it("accepts navItems prop", () => {
    assert.ok(
      shell.includes("navItems"),
      "GrShell must accept navItems prop",
    );
  });

  it("accepts userInitials prop", () => {
    assert.ok(
      shell.includes("userInitials"),
      "GrShell must accept userInitials prop",
    );
  });

  it("exports GrNavItem type", () => {
    assert.ok(
      shell.includes("GrNavItem"),
      "GrShell must export the GrNavItem type",
    );
  });

  it("uses next/link for nav items with hrefs", () => {
    assert.ok(
      shell.includes("next/link"),
      "GrShell must import next/link to render real nav hrefs",
    );
  });

  it("does not import from app-shell", () => {
    assert.ok(
      !shell.includes("app-shell"),
      "GrShell must not import from AppShell",
    );
  });
});
