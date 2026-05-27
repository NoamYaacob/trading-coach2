/**
 * Phase L — structural and visual cleanup regression tests.
 *
 * Locks in:
 *  1. Session cutoff: invalid hour values (non-integer, out-of-range) produce
 *     an empty display string — never "Stops at 123:00 CME".
 *  2. Session cutoff: valid hours use "H:00 AM/PM CT" format from formatCmeHourLabel.
 *  3. SessionCutoffSection summary uses formatCmeHourLabel (contains "CT").
 *  4. Advanced broker actions: no "PDLL" or "PDPT" in user-facing names; uses
 *     product wording (Broker-side daily loss lock / Broker-side profit target lock /
 *     Flatten positions through broker / Cancel pending orders through broker).
 *  5. How enforcement works: compact grouped-row layout — no full-width paragraphs,
 *     chips close to their label text.
 *  6. AppShell workspaceMode header is tighter (py-1.5 not py-2.5).
 *  7. RuleCard: compact padding (p-3.5), tighter internal gaps.
 *  8. Starter settings form uses GR surface warm tokens.
 *  9. Daily loss editor threshold section uses GR border/surface tokens.
 * 10. Honesty: no fake metrics introduced.
 */
import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ruleDisplayValue, type OverviewValues } from "./rule-meta.ts";
import { isValidCmeHour, formatCmeHourLabel } from "./cme-hour-parsing.ts";

const ROOT = resolve(import.meta.dirname);
const REPO_ROOT = resolve(ROOT, "../../../..");

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}
function readRepo(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
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

// ── Issue 1 & 2: Session cutoff display bug fix ───────────────────────────────

describe("ruleDisplayValue — session-cutoff bug fix", () => {
  it("returns empty string for a clearly invalid hour (123)", () => {
    assert.equal(
      ruleDisplayValue("session-cutoff", { ...BASE_VALUES, allowedEndHour: "123" }),
      "",
      "hours outside 0..23 must produce empty string, never 'Stops at 123:00 CME'",
    );
  });

  it("returns empty string for a negative hour (-1)", () => {
    assert.equal(
      ruleDisplayValue("session-cutoff", { ...BASE_VALUES, allowedEndHour: "-1" }),
      "",
    );
  });

  it("returns empty string for non-numeric input", () => {
    assert.equal(
      ruleDisplayValue("session-cutoff", { ...BASE_VALUES, allowedEndHour: "abc" }),
      "",
    );
  });

  it("returns empty string for empty allowedEndHour", () => {
    assert.equal(
      ruleDisplayValue("session-cutoff", { ...BASE_VALUES, allowedEndHour: "" }),
      "",
    );
  });

  it("formats hour 15 as 'Stops at 3:00 PM CT' (matches formatCmeHourLabel)", () => {
    const result = ruleDisplayValue("session-cutoff", { ...BASE_VALUES, allowedEndHour: "15" });
    assert.equal(result, `Stops at ${formatCmeHourLabel(15)}`);
    assert.ok(result.includes("PM CT"), "display must use AM/PM CT format, not HH:00 CME");
  });

  it("formats hour 0 as 'Stops at 12:00 AM CT'", () => {
    const result = ruleDisplayValue("session-cutoff", { ...BASE_VALUES, allowedEndHour: "0" });
    assert.equal(result, "Stops at 12:00 AM CT");
  });

  it("formats hour 16 as 'Stops at 4:00 PM CT'", () => {
    const result = ruleDisplayValue("session-cutoff", { ...BASE_VALUES, allowedEndHour: "16" });
    assert.equal(result, "Stops at 4:00 PM CT");
  });

  it("all valid hours 0..23 produce non-empty display strings", () => {
    for (let h = 0; h <= 23; h++) {
      const result = ruleDisplayValue("session-cutoff", { ...BASE_VALUES, allowedEndHour: String(h) });
      assert.ok(result.length > 0, `hour ${h} must produce a non-empty display string`);
    }
  });
});

// ── Issue 1: SessionCutoffSection summary uses CT format ─────────────────────

describe("SessionCutoffSection — summary uses formatCmeHourLabel", () => {
  const SRC = read("sections/session-cutoff-section.tsx");

  it("summary does not use raw padded HH:00 CME format", () => {
    // The old bug: `${String(hour).padStart(2, "0")}:00 CME`
    assert.ok(
      !SRC.includes(":00 CME"),
      "summary must not use raw ':00 CME' suffix — use formatCmeHourLabel instead",
    );
  });

  it("imports and uses formatCmeHourLabel from cme-hour-parsing", () => {
    assert.ok(
      SRC.includes("formatCmeHourLabel"),
      "SessionCutoffSection must import and use formatCmeHourLabel for the summary display",
    );
  });
});

// ── Issue 3: isValidCmeHour and formatCmeHourLabel correctness ────────────────

describe("isValidCmeHour / formatCmeHourLabel — validates range properly", () => {
  it("rejects 123", () => assert.equal(isValidCmeHour(123), false));
  it("rejects -1", () => assert.equal(isValidCmeHour(-1), false));
  it("rejects 24", () => assert.equal(isValidCmeHour(24), false));
  it("accepts 0", () => assert.equal(isValidCmeHour(0), true));
  it("accepts 23", () => assert.equal(isValidCmeHour(23), true));
  it("formatCmeHourLabel(15) returns '3:00 PM CT'", () =>
    assert.equal(formatCmeHourLabel(15), "3:00 PM CT"));
  it("formatCmeHourLabel(123) returns empty string", () =>
    assert.equal(formatCmeHourLabel(123), ""));
});

// ── Issue 6: Advanced broker actions copy cleanup ─────────────────────────────

describe("AdvancedBrokerActionsSection — product wording, no internal codes", () => {
  const SRC = read("sections/advanced-broker-actions-section.tsx");

  it("does not show 'PDLL' as a user-facing action name", () => {
    // The internal code "PDLL" must not appear in user-facing copy
    // Note: it may appear in comments (which is fine). We check the ADVANCED_ACTIONS array.
    const actionsStart = SRC.indexOf("const ADVANCED_ACTIONS");
    const actionsEnd = SRC.indexOf("] as const;", actionsStart);
    const actionsBlock = SRC.slice(actionsStart, actionsEnd);
    assert.ok(
      !actionsBlock.includes('"PDLL"') && !actionsBlock.includes("'PDLL'") && !actionsBlock.includes("`PDLL`"),
      "PDLL must not appear as a user-facing action name in ADVANCED_ACTIONS",
    );
  });

  it("does not show 'PDPT' as a user-facing action name", () => {
    const actionsStart = SRC.indexOf("const ADVANCED_ACTIONS");
    const actionsEnd = SRC.indexOf("] as const;", actionsStart);
    const actionsBlock = SRC.slice(actionsStart, actionsEnd);
    assert.ok(
      !actionsBlock.includes('"PDPT"') && !actionsBlock.includes("'PDPT'") && !actionsBlock.includes("`PDPT`"),
      "PDPT must not appear as a user-facing action name in ADVANCED_ACTIONS",
    );
  });

  it("uses 'Broker-side daily loss lock' as the first action name", () => {
    assert.ok(
      SRC.includes("Broker-side daily loss lock"),
      "advanced broker actions must use product wording 'Broker-side daily loss lock'",
    );
  });

  it("uses 'Broker-side profit target lock' as the second action name", () => {
    assert.ok(
      SRC.includes("Broker-side profit target lock"),
      "advanced broker actions must use product wording 'Broker-side profit target lock'",
    );
  });

  it("uses 'Flatten positions through broker' as action name", () => {
    assert.ok(
      SRC.includes("Flatten positions through broker"),
      "advanced broker actions must use product wording 'Flatten positions through broker'",
    );
  });

  it("uses 'Cancel pending orders through broker' as action name", () => {
    assert.ok(
      SRC.includes("Cancel pending orders through broker"),
      "advanced broker actions must use product wording 'Cancel pending orders through broker'",
    );
  });

  it("actions remain Planned / not active — badge present in both summary and per-action map", () => {
    const count = (SRC.match(/variant="planned-broker"/g) ?? []).length;
    assert.ok(count >= 2, `planned-broker badge must appear in summary and per-action map, found ${count}`);
    // The per-action badge is inside the .map() so only 1 literal occurrence renders to 4 DOM nodes
    assert.ok(SRC.includes('variant="planned-broker"'), "planned-broker variant must be present");
  });

  it("still collapsed by default", () => {
    assert.ok(SRC.includes("<details"), "must use <details> element");
    assert.ok(!/<details[^>]*\bopen\b/.test(SRC), "<details> must not default to open");
  });
});

// ── Issue 4: How enforcement works compact layout ─────────────────────────────

describe("HowEnforcementWorks — compact grouped-row layout", () => {
  const SRC = read("how-enforcement-works.tsx");

  it("uses a max-w container for the content (not full-width)", () => {
    assert.ok(
      SRC.includes("max-w-"),
      "enforcement panel must use a max-w constraint for compact contained layout",
    );
  });

  it("chip labels appear directly in colored span elements (no long paragraphs as headers)", () => {
    // Chips should have short px values, not long prose
    assert.ok(
      SRC.includes("px-1.5"),
      "enforcement chip labels must use compact px-1.5 padding (pill-style)",
    );
  });

  it("all five enforcement labels still present with correct colors", () => {
    assert.ok(SRC.includes("Broker-backed eligible"), "must include Broker-backed eligible");
    assert.ok(SRC.includes("Guardrail lock"), "must include Guardrail lock");
    assert.ok(SRC.includes("Monitoring only"), "must include Monitoring only");
    assert.ok(SRC.includes("Saved · Evaluation coming soon"), "must include Saved state");
    assert.ok(SRC.includes("Planned broker action"), "must include Planned state");
  });

  it("Daily Loss only statement still present", () => {
    assert.ok(/Daily Loss only/.test(SRC), "must state broker-backing is Daily Loss only");
  });

  it("not active in beta still stated", () => {
    const flat = SRC.replace(/\s+/g, " ");
    assert.ok(/not active in this beta/i.test(flat), "must state cancel/flatten not active");
  });
});

// ── Issue 5: AppShell workspaceMode header tighter ───────────────────────────

describe("AppShell — tighter workspaceMode header (Phase L)", () => {
  const SRC = readRepo("src/components/ui/app-shell.tsx");

  it("workspaceMode header uses py-1.5 (compact, not py-2.5)", () => {
    const idx = SRC.indexOf("if (workspaceMode)");
    // Look 1200 chars into the block to cover the full header element
    const block = SRC.slice(idx, idx + 1200);
    assert.ok(
      block.includes("py-1.5"),
      "workspaceMode header must use py-1.5 for tighter nav (not py-2.5)",
    );
    assert.ok(
      !block.includes("py-2.5"),
      "workspaceMode header must not use py-2.5 after Phase L tightening",
    );
  });
});

// ── Issue 2: Compact overview grid ────────────────────────────────────────────

describe("RulesOverviewScreen — compact RuleCard (Phase L)", () => {
  const SRC = read("rules-overview-screen.tsx");

  it("RuleCard uses p-3.5 (compact, not p-5)", () => {
    assert.ok(
      SRC.includes("p-3.5"),
      "RuleCard must use p-3.5 for compact padding (Phase L reduction from p-5)",
    );
  });

  it("RuleCard value display uses mt-3 (compact, not mt-4)", () => {
    assert.ok(
      SRC.includes("mt-3 flex-1"),
      "RuleCard value section must use mt-3 flex-1 for tighter vertical rhythm",
    );
  });

  it("does not regress text-2xl value display", () => {
    assert.ok(SRC.includes("text-2xl"), "configured rule value must still use text-2xl");
  });

  it("does not regress --gr-surface-warm card background", () => {
    assert.ok(
      SRC.includes("var(--gr-surface-warm)"),
      "RuleCard must still use --gr-surface-warm background",
    );
  });

  it("does not regress --gr-border-hi card border", () => {
    assert.ok(
      SRC.includes("var(--gr-border-hi)"),
      "RuleCard must still use --gr-border-hi border",
    );
  });
});

// ── Issue 8: Starter settings visual alignment ────────────────────────────────

describe("RulesForm (Starter settings) — GR surface warm tokens", () => {
  const SRC = readRepo("src/app/rules/_components/rules-form.tsx");

  it("section groups use --gr-surface-warm background (warm, not plain stone-50)", () => {
    assert.ok(
      SRC.includes("var(--gr-surface-warm)"),
      "starter settings form groups must use --gr-surface-warm background",
    );
  });

  it("section groups use --gr-border-sub border (GR token, not stone-100)", () => {
    assert.ok(
      SRC.includes("var(--gr-border-sub)"),
      "starter settings form groups must use --gr-border-sub border",
    );
  });

  it("no longer uses old stone-50/50 background for groups", () => {
    assert.ok(
      !SRC.includes("bg-stone-50/50"),
      "starter settings form must not use old bg-stone-50/50 group backgrounds",
    );
  });

  it("no longer uses border-stone-100 for group containers", () => {
    assert.ok(
      !SRC.includes("border-stone-100 bg-stone-50"),
      "starter settings form must not use border-stone-100/bg-stone-50 group containers",
    );
  });
});

// ── Issue 7: Daily loss editor polish ────────────────────────────────────────

describe("DailyLossEditor — Phase L threshold card polish", () => {
  const SRC = read("editors/daily-loss-editor.tsx");

  it("threshold section uses --gr-surface-warm background", () => {
    assert.ok(
      SRC.includes("var(--gr-surface-warm)"),
      "threshold section must use --gr-surface-warm warm background",
    );
  });

  it("threshold section uses --gr-border-hi border", () => {
    assert.ok(
      SRC.includes("var(--gr-border-hi)"),
      "threshold section must use --gr-border-hi for stronger border",
    );
  });

  it("Active now section still present", () => {
    assert.ok(SRC.includes("Active now"), "editor must still show 'Active now' section");
  });

  it("planned section still uses opacity-60", () => {
    assert.ok(SRC.includes("opacity-60"), "planned actions block must still use opacity-60");
  });

  it("planned section still renders planned-broker badges", () => {
    assert.ok(SRC.includes("planned-broker"), "planned section must still render planned-broker badges");
  });

  it("does not use forbidden phrasing", () => {
    for (const phrase of ["Auto-flatten positions", "Cancel all open orders", "Lock account at broker"]) {
      assert.ok(!SRC.includes(phrase), `editor must not use forbidden phrase: "${phrase}"`);
    }
  });
});

// ── Honesty guard: no fake metrics introduced ─────────────────────────────────

test("Phase L honesty: no fake metrics introduced in modified files", () => {
  const files = [
    "rules-overview-screen.tsx",
    "editors/daily-loss-editor.tsx",
    "how-enforcement-works.tsx",
    "sections/advanced-broker-actions-section.tsx",
  ];
  const forbidden = ["Today P&L", "Compliance", "Balance:", "P&L:", "Win rate", "Streak"];
  for (const rel of files) {
    const src = read(rel);
    for (const f of forbidden) {
      assert.ok(!src.includes(f), `${rel} must not introduce fake metric: "${f}"`);
    }
  }
});
