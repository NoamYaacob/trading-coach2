/**
 * Alerts page honesty + AlertPreferences orphan guard.
 *
 * AlertPreferences is a Prisma model that is NOT wired into the app: no UI
 * renders its toggles and no code reads it before sending alerts. That is
 * acceptable only because nothing promises the user those toggles exist.
 *
 * These guards confirm:
 *   1. The /alerts page exposes no interactive AlertPreferences toggles.
 *   2. Its trigger copy is honest and read-only ("Active when the matching
 *      rule is configured").
 *   3. AlertPreferences stays orphaned — if any source file starts reading or
 *      rendering it, this test fails so the feature can be finished properly
 *      (preference reads default-false fields could otherwise silently
 *      suppress alerts).
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

  it("has no interactive toggle handlers (read-only status only)", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes("onChange") && !ALERTS_PAGE_SRC.includes("onClick"),
      "the alerts page must stay read-only — no toggle handlers",
    );
  });

  it("uses honest copy: triggers are active only when their rule is configured", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("Active when the matching rule is configured"),
      "the alerts page must state that triggers depend on rule configuration",
    );
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

  it("mentions all three behavioral triggers by name", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("Revenge entry") &&
        ALERTS_PAGE_SRC.includes("Rapid trading") &&
        ALERTS_PAGE_SRC.includes("Size increase after loss"),
      "all three behavioral triggers (revenge entry, rapid trading, size increase after loss) must appear on the alerts page",
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

// ── Notification-audit honesty fixes ──────────────────────────────────────────

describe("/alerts page — Telegram + trigger honesty", () => {
  it("does not claim Telegram sends a max-trades alert", () => {
    // The only proactive Telegram pushes are near_daily_loss_limit (80%) and
    // consecutive_losses_warning (N-1) — no exceeded_trade_count is produced.
    assert.ok(
      !ALERTS_PAGE_SRC.includes("daily loss, max trades, loss streak"),
      "the Telegram channel copy must not claim a max-trades alert is sent",
    );
  });

  it("does not list Unrealized drawdown as an active rule trigger", () => {
    const ruleTriggersBlock = ALERTS_PAGE_SRC.slice(
      ALERTS_PAGE_SRC.indexOf("const ruleTriggers"),
      ALERTS_PAGE_SRC.indexOf("const comingSoon"),
    );
    assert.ok(
      !ruleTriggersBlock.includes("Unrealized drawdown"),
      "Unrealized drawdown is not wired to any rule — must not be an active trigger",
    );
  });

  it("does not query riskPerTrade — no unrealized-drawdown trigger is wired", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes("riskPerTrade"),
      "riskPerTrade is not wired to an alert — must not be queried or claimed as active",
    );
  });

  it("does not list the 80% early warning as Planned — it is wired", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes("Approaching loss limit (80%)"),
      "the 80% daily-loss early warning is wired (Telegram) — it must not sit in the Planned list",
    );
  });

  it("describes the wired 80% Telegram early warning on the active daily-loss trigger", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("early warning at 80%"),
      "the active daily-loss trigger must describe the wired 80% Telegram warning",
    );
  });
});

// ── Roadmap visibility: planned features stay visible but not "Active" ────────

describe("/alerts page roadmap", () => {
  const PLANNED_FEATURES = [
    "Daily profit target",
    "Unrealized drawdown",
    "Pre-news window",
    "News lockout",
    "Session start & end reminders",
    "In-app notification center",
  ];

  it("keeps every planned alert feature visible on the page", () => {
    for (const feature of PLANNED_FEATURES) {
      assert.ok(
        ALERTS_PAGE_SRC.includes(feature),
        `planned feature "${feature}" must stay visible so the team can track it`,
      );
    }
  });

  it("marks planned features with a Planned badge, not Active", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("Planned"),
      "planned features must carry a Planned badge",
    );
  });

  it("shows an alert-preferences roadmap card, not functional toggles", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("Alert preferences are planned"),
      "alert preferences must be presented as a roadmap card until the feature is wired",
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
});
