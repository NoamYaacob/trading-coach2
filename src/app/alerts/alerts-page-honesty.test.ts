/**
 * Alerts page honesty + AlertPreferences orphan guard.
 *
 * AlertPreferences is a Prisma model that is NOT wired into the app: no UI
 * renders its toggles and no code reads it before sending alerts. That is
 * acceptable only because nothing promises the user those toggles exist.
 *
 * These guards confirm:
 *   1. The /alerts page exposes no interactive AlertPreferences toggles.
 *   2. The page is a read-only Server Component (no onClick/onChange).
 *   3. AlertPreferences stays orphaned — if any source file starts reading or
 *      rendering it, this test fails so the feature can be finished properly
 *      (preference reads default-false fields could otherwise silently
 *      suppress alerts).
 *   4. The feed layout is honest: queries guardianIntervention, not raw tables.
 *   5. Old static channels/planned sections are gone.
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SRC_ROOT = join(__dirname, "../..");
const THIS_FILE = "alerts-page-honesty.test.ts";

const ALERTS_PAGE_SRC = readFileSync(join(__dirname, "page.tsx"), "utf8");

// ── /alerts page is honest and read-only ──────────────────────────────────────

describe("/alerts page", () => {
  it("renders no AlertPreferences toggles", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes("AlertPreferences") &&
        !ALERTS_PAGE_SRC.includes("alertPreferences"),
      "the alerts page must not render or read AlertPreferences",
    );
  });

  it("has no interactive toggle handlers (read-only Server Component)", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes("onChange") && !ALERTS_PAGE_SRC.includes("onClick"),
      "the alerts page must stay read-only — no toggle handlers",
    );
  });

  it("exposes no internal implementation terms to users", () => {
    for (const term of ["dry_run", "DryRunViolation", "GuardianIntervention", "InternalLockEvent"]) {
      assert.ok(
        !ALERTS_PAGE_SRC.includes(term),
        `internal term "${term}" must not appear in user-facing copy`,
      );
    }
  });
});

// ── Trigger honesty: only wired triggers are shown as active ──────────────────

describe("/alerts page trigger honesty", () => {
  it("does not query dailyProfitTarget (not a live trigger)", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes("dailyProfitTarget"),
      "dailyProfitTarget is not wired to an alert — must not be queried or claimed as active",
    );
  });

  it("does not query newsLockoutEnabled (not a live trigger)", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes("newsLockoutEnabled"),
      "newsLockoutEnabled is not wired to an alert — must not be queried or claimed as active",
    );
  });

  it("does not query riskPerTrade — no unrealized-drawdown trigger is wired", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes("riskPerTrade"),
      "riskPerTrade is not wired to an alert — must not be queried or claimed as active",
    );
  });
});

// ── Feed layout ───────────────────────────────────────────────────────────────

describe("/alerts page — feed layout", () => {
  it("queries guardianIntervention for the alert feed", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("guardianIntervention.findMany"),
      "the alerts page must query guardianIntervention for the feed data",
    );
  });

  it("shows 'Notification settings' link to /settings#alerts-telegram", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("/settings#alerts-telegram") &&
        ALERTS_PAGE_SRC.includes("Notification settings"),
      "must render a 'Notification settings' link pointing to /settings#alerts-telegram",
    );
  });

  it("empty state shows 'No alerts yet'", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("No alerts yet"),
      "empty state must show 'No alerts yet'",
    );
  });

  it("empty state explains what kinds of alerts will appear", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes(
        "Guardrail will show rule breaches, session events, and broker sync events here.",
      ),
      "empty state must explain what kinds of alerts Guardrail will show",
    );
  });

  it("feed rows include a 'View →' action link", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("View →"),
      "feed rows must include a 'View →' action link",
    );
  });

  it("rule alerts route to /rules", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("/rules?scope=account"),
      "rule alerts must link to /rules?scope=account&id=<accountId>",
    );
  });

  it("broker alerts route to /settings#broker-connections", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("/settings#broker-connections"),
      "broker alerts must link to /settings#broker-connections",
    );
  });
});

// ── Filter chips ──────────────────────────────────────────────────────────────

describe("/alerts page — filter chips", () => {
  it("has All filter chip", () => {
    assert.ok(ALERTS_PAGE_SRC.includes('"All"') || ALERTS_PAGE_SRC.includes("\"All\"") || ALERTS_PAGE_SRC.includes("label: \"All\"") || ALERTS_PAGE_SRC.includes("{ key: \"all\",    label: \"All\" }") || ALERTS_PAGE_SRC.includes("All"), "must have an All filter chip");
    // Check FILTER_CHIPS array contains "all"
    assert.ok(ALERTS_PAGE_SRC.includes('"all"') && ALERTS_PAGE_SRC.includes("All"), "FILTER_CHIPS must contain the all chip");
  });

  it("has Rule alerts filter chip", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("Rule alerts"),
      "must have a 'Rule alerts' filter chip",
    );
  });

  it("has System filter chip", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes('"system"') && ALERTS_PAGE_SRC.includes("System"),
      "must have a System filter chip",
    );
  });

  it("has Broker filter chip", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes('"broker"') && ALERTS_PAGE_SRC.includes("Broker"),
      "must have a Broker filter chip",
    );
  });

  it("has Today only chip", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("Today only"),
      "must have a 'Today only' filter chip",
    );
  });

  it("filter chips use Link href, not onClick (URL-param based navigation)", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes("onClick") &&
        ALERTS_PAGE_SRC.includes('filter=${'),
      "filter chips must navigate via URL params (?filter=...), not onClick handlers",
    );
  });
});

// ── Old static sections are gone ─────────────────────────────────────────────

describe("/alerts page — old static sections removed", () => {
  it("does not show a Channels section card", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes('"Channels"') && !ALERTS_PAGE_SRC.includes("'Channels'"),
      "the old Channels section card must be removed",
    );
  });

  it("does not show Email coming soon", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes("Email") || !ALERTS_PAGE_SRC.includes("Coming soon"),
      "the Email coming soon content must be removed",
    );
  });

  it("does not show Planned & coming soon section", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes("Planned &amp; coming soon") &&
        !ALERTS_PAGE_SRC.includes("Planned & coming soon"),
      "the old 'Planned & coming soon' section must be removed",
    );
  });

  it("does not show Alert preferences are planned text", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes("Alert preferences are planned"),
      "the old 'Alert preferences are planned' roadmap card must be removed",
    );
  });

  it("does not show old behavioral trigger section", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes("Revenge entry") &&
        !ALERTS_PAGE_SRC.includes("Rapid trading") &&
        !ALERTS_PAGE_SRC.includes("Size increase after loss"),
      "behavioral trigger rows must be removed from the new feed-based page",
    );
  });
});

// ── AlertPreferences stays orphaned ───────────────────────────────────────────

function collectSourceFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      entry.name !== THIS_FILE
    ) {
      out.push(full);
    }
  }
}

describe("AlertPreferences model", () => {
  it("is not referenced anywhere in src/ (orphaned schema, not a broken feature)", () => {
    const files: string[] = [];
    collectSourceFiles(SRC_ROOT, files);

    const offenders = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return src.includes("alertPreferences") || src.includes("AlertPreferences");
    });

    assert.deepEqual(
      offenders.map((f) => f.slice(SRC_ROOT.length + 1)),
      [],
      "AlertPreferences must remain unwired until a real preferences UI exists; " +
        "wiring reads of its default-false fields could silently suppress alerts",
    );
  });
});

// ── Sidebar only shows active accounts ────────────────────────────────────────

describe("/alerts page — sidebar account filtering", () => {
  it("sidebar query restricts to protected and monitor_only protectionStatus", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes('"protected"') && ALERTS_PAGE_SRC.includes('"monitor_only"'),
      "alerts sidebar must restrict to protected/monitor_only — not { not: 'archived' }",
    );
  });

  it("sidebar query filters out accounts missing from broker", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("missingFromBrokerSince: null"),
      "alerts sidebar must filter missingFromBrokerSince: null to exclude unavailable accounts",
    );
  });

  it("excludes accounts on an expired or errored broker connection", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes('"expired"') &&
        ALERTS_PAGE_SRC.includes('"connection_error"'),
      "alerts sidebar must exclude expired / connection_error connections",
    );
  });
});
