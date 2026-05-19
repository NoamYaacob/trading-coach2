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
    assert.ok(
      !ALERTS_PAGE_SRC.includes("dry_run") && !ALERTS_PAGE_SRC.includes("GuardianIntervention"),
      "internal implementation terms must not appear in user-facing copy",
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
