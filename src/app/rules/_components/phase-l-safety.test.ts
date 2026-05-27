/**
 * Phase L safety keepers — behavior + honesty regression tests.
 *
 * This file deliberately contains ZERO pinned pixel-class assertions
 * (no `p-3.5`, `mt-3`, `py-1.5`, etc.). The Trading Plan page is about
 * to be redesigned to match the Guardrail 2 design bundle, and any
 * visual-pixel locks here would falsely fail the redesign PR.
 *
 * What this file DOES guard:
 *  1. Session-cutoff display safety
 *      - Invalid hour values (>23, negative, non-numeric) produce empty
 *        string — never "Stops at 123:00 CME" or similar garbage.
 *      - Valid hours produce the human-readable "H:00 AM/PM CT" label.
 *  2. Advanced broker actions copy
 *      - Internal codes (PDLL/PDPT/Liquidate/Liquidate & block) are not
 *        used as user-facing labels anywhere.
 *      - All four planned actions use product-friendly names.
 *      - All four remain marked as Planned / not active.
 *  3. Daily-loss editor planned sub-labels
 *      - Same product naming applies to the in-editor "Planned · not
 *        active" sub-rows.
 *  4. No fake metrics
 *      - "Today P&L", "Compliance", "Balance:", "Win rate", "Streak"
 *        do not appear in the rules surface — Guardrail does not have
 *        real values for these on the Trading Plan page yet.
 */
import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ruleDisplayValue, type OverviewValues } from "./rule-meta.ts";
import { isValidCmeHour, formatCmeHourLabel } from "./cme-hour-parsing.ts";

const ROOT = resolve(import.meta.dirname);

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

const BASE_VALUES: OverviewValues = {
  maxDailyLoss: "",
  riskPerTrade: "",
  maxTradesPerDay: "",
  stopAfterLosses: "",
  maxContracts: "",
  symbolLimits: [],
  allowedEndHour: "",
};

// ── 1. Session-cutoff invalid hour safety ────────────────────────────────────

describe("ruleDisplayValue session-cutoff — invalid hours produce empty string", () => {
  for (const bad of ["123", "-1", "24", "abc", "", "  "]) {
    it(`returns "" for allowedEndHour=${JSON.stringify(bad)}`, () => {
      assert.equal(
        ruleDisplayValue("session-cutoff", { ...BASE_VALUES, allowedEndHour: bad }),
        "",
        `hours outside 0..23 must produce empty string, never "Stops at ${bad}:00 CME"`,
      );
    });
  }
});

describe("ruleDisplayValue session-cutoff — valid hours use AM/PM CT format", () => {
  it("hour 0 → 'Stops at 12:00 AM CT'", () => {
    assert.equal(
      ruleDisplayValue("session-cutoff", { ...BASE_VALUES, allowedEndHour: "0" }),
      "Stops at 12:00 AM CT",
    );
  });
  it("hour 12 → 'Stops at 12:00 PM CT'", () => {
    assert.equal(
      ruleDisplayValue("session-cutoff", { ...BASE_VALUES, allowedEndHour: "12" }),
      "Stops at 12:00 PM CT",
    );
  });
  it("hour 15 → 'Stops at 3:00 PM CT'", () => {
    assert.equal(
      ruleDisplayValue("session-cutoff", { ...BASE_VALUES, allowedEndHour: "15" }),
      "Stops at 3:00 PM CT",
    );
  });
  it("hour 23 → 'Stops at 11:00 PM CT'", () => {
    assert.equal(
      ruleDisplayValue("session-cutoff", { ...BASE_VALUES, allowedEndHour: "23" }),
      "Stops at 11:00 PM CT",
    );
  });
  it("all valid hours 0..23 produce non-empty strings matching formatCmeHourLabel", () => {
    for (let h = 0; h <= 23; h++) {
      const result = ruleDisplayValue("session-cutoff", {
        ...BASE_VALUES,
        allowedEndHour: String(h),
      });
      assert.equal(result, `Stops at ${formatCmeHourLabel(h)}`);
    }
  });
});

describe("isValidCmeHour — bounds the session-cutoff fix", () => {
  it("rejects 123", () => assert.equal(isValidCmeHour(123), false));
  it("rejects -1", () => assert.equal(isValidCmeHour(-1), false));
  it("rejects 24", () => assert.equal(isValidCmeHour(24), false));
  it("accepts 0", () => assert.equal(isValidCmeHour(0), true));
  it("accepts 23", () => assert.equal(isValidCmeHour(23), true));
  it("formatCmeHourLabel(123) returns empty (safe fallback)", () =>
    assert.equal(formatCmeHourLabel(123), ""));
});

describe("SessionCutoffSection summary uses formatCmeHourLabel", () => {
  const SRC = read("sections/session-cutoff-section.tsx");

  it("imports formatCmeHourLabel from cme-hour-parsing", () => {
    assert.ok(
      SRC.includes("formatCmeHourLabel"),
      "session-cutoff section must import formatCmeHourLabel for the summary",
    );
  });

  it("summary does not use the raw ':00 CME' suffix", () => {
    assert.ok(
      !SRC.includes(":00 CME"),
      "summary must not use raw ':00 CME' format — use formatCmeHourLabel instead",
    );
  });
});

// ── 2. Advanced broker actions: product naming, no internal codes ────────────

describe("AdvancedBrokerActionsSection — product naming, no internal codes", () => {
  const SRC = read("sections/advanced-broker-actions-section.tsx");
  const actionsBlock = SRC.slice(
    SRC.indexOf("const ADVANCED_ACTIONS"),
    SRC.indexOf("] as const;"),
  );

  it("uses 'Broker-side daily loss lock' (not 'PDLL action')", () => {
    assert.ok(SRC.includes("Broker-side daily loss lock"));
  });
  it("uses 'Broker-side profit target lock' (not 'PDPT action')", () => {
    assert.ok(SRC.includes("Broker-side profit target lock"));
  });
  it("uses 'Flatten positions through broker' (not 'Liquidate')", () => {
    assert.ok(SRC.includes("Flatten positions through broker"));
  });
  it("uses 'Cancel pending orders through broker' (not 'Liquidate & block')", () => {
    assert.ok(SRC.includes("Cancel pending orders through broker"));
  });

  it("internal codes do not appear as user-facing action names", () => {
    for (const old of [
      '"PDLL action"',
      '"PDPT action"',
      '"Liquidate"',
      '"Liquidate & block"',
    ]) {
      assert.ok(
        !actionsBlock.includes(old),
        `old internal code ${old} must not appear as a user-facing action name`,
      );
    }
  });

  it("all four actions remain Planned / not active", () => {
    assert.ok(SRC.includes('variant="planned-broker"'));
    const flat = SRC.replace(/\s+/g, " ");
    assert.ok(
      /not\s+active in this beta/i.test(flat),
      "section must still state actions are not active in this beta",
    );
  });

  it("section is still collapsed by default (no `open` attribute on <details>)", () => {
    assert.ok(SRC.includes("<details"));
    assert.ok(!/<details[^>]*\bopen\b/.test(SRC));
  });
});

// ── 3. Daily-loss editor planned sub-labels use product naming ───────────────

describe("DailyLossEditor planned sub-rows — product naming", () => {
  const SRC = read("editors/daily-loss-editor.tsx");

  it("includes 'Broker-side daily loss lock' as a planned sub-row", () => {
    assert.ok(SRC.includes("Broker-side daily loss lock"));
  });
  it("includes 'Flatten positions through broker' as a planned sub-row", () => {
    assert.ok(SRC.includes("Flatten positions through broker"));
  });
  it("includes 'Cancel pending orders through broker' as a planned sub-row", () => {
    assert.ok(SRC.includes("Cancel pending orders through broker"));
  });
  it("does not use the legacy 'PDLL action' sub-row text", () => {
    assert.ok(
      !SRC.includes("PDLL action"),
      "daily-loss editor sub-rows must not reference 'PDLL action'",
    );
  });
});

// ── 4. Honesty: no fake metrics in the rules surface ─────────────────────────

test("rules surface introduces no fake telemetry / metric labels", () => {
  // The Trading Plan page does not have real values for any of these metrics
  // today. Until the data layer surfaces them, they must not appear as labels.
  const files = [
    "rules-overview-screen.tsx",
    "editors/daily-loss-editor.tsx",
    "rule-detail-pane.tsx",
    "sections/advanced-broker-actions-section.tsx",
    "how-enforcement-works.tsx",
  ];
  const forbidden = ["Today P&L", "Compliance", "Balance:", "Win rate", "Streak"];
  for (const rel of files) {
    const src = read(rel);
    for (const f of forbidden) {
      assert.ok(!src.includes(f), `${rel} must not introduce fake metric: "${f}"`);
    }
  }
});
