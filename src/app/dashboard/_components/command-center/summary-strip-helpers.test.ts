import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  formatBreakdownHint,
  TRADABLE_ACCOUNTS_TILE_LABEL,
  buildRuleSummaryChips,
  formatRuleSummaryLine,
} from "./summary-strip-helpers.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const helperSource = readFileSync(
  join(__dirname, "summary-strip-helpers.ts"),
  "utf-8",
);

describe("TRADABLE_ACCOUNTS_TILE_LABEL", () => {
  it("is the literal 'Tradable accounts' (not 'Allowed')", () => {
    // Renamed from 'Allowed' — the count alone implied uniform protection.
    assert.equal(TRADABLE_ACCOUNTS_TILE_LABEL, "Tradable accounts");
  });

  it("does not say 'Allowed' (regression: avoid the legacy label)", () => {
    assert.ok(
      !TRADABLE_ACCOUNTS_TILE_LABEL.toLowerCase().includes("allowed"),
      `expected 'Allowed' to be removed from tile label, got: ${TRADABLE_ACCOUNTS_TILE_LABEL}`,
    );
  });
});

describe("formatBreakdownHint — Allowed/Warning/Locked breakdown shown to user", () => {
  it("zero total → no hint (no breakdown shown when nothing to count)", () => {
    assert.equal(
      formatBreakdownHint({ total: 0, live: 0, practice: 0 }),
      undefined,
    );
  });

  it("only live accounts → '2 live'", () => {
    assert.equal(
      formatBreakdownHint({ total: 2, live: 2, practice: 0 }),
      "2 live",
    );
  });

  it("only practice accounts → '3 practice'", () => {
    assert.equal(
      formatBreakdownHint({ total: 3, live: 0, practice: 3 }),
      "3 practice",
    );
  });

  it("mix of live and practice → '1 live · 1 practice' (matches user-requested format)", () => {
    assert.equal(
      formatBreakdownHint({ total: 2, live: 1, practice: 1 }),
      "1 live · 1 practice",
    );
  });

  it("multi-account live and practice → counts display verbatim", () => {
    assert.equal(
      formatBreakdownHint({ total: 5, live: 3, practice: 2 }),
      "3 live · 2 practice",
    );
  });

  it("regression: 1 live + 1 demo (practice) is NOT confused as 2 live", () => {
    // Product invariant: a user with one personal account + one demo account
    // must never see "2 live" — that would imply both are real.
    const hint = formatBreakdownHint({ total: 2, live: 1, practice: 1 });
    assert.ok(hint?.includes("1 live"), `expected '1 live' in hint, got: ${hint}`);
    assert.ok(hint?.includes("1 practice"), `expected '1 practice' in hint, got: ${hint}`);
    assert.ok(!hint?.includes("2 live"), `must not show '2 live', got: ${hint}`);
  });
});

describe("summary-strip-helpers — buildRuleSummaryChips re-export", () => {
  it("buildRuleSummaryChips is exported from summary-strip-helpers", () => {
    assert.equal(typeof buildRuleSummaryChips, "function", "buildRuleSummaryChips must be a function export");
  });

  it("formatRuleSummaryLine is exported from summary-strip-helpers", () => {
    assert.equal(typeof formatRuleSummaryLine, "function", "formatRuleSummaryLine must be a function export");
  });

  it("source re-exports buildRuleSummaryChips", () => {
    assert.ok(
      helperSource.includes("buildRuleSummaryChips"),
      "summary-strip-helpers.ts must export/re-export buildRuleSummaryChips",
    );
  });
});

describe("summary-strip-helpers — SAFETY: no broker+profit-target combination in chip text", () => {
  it("source file does not hardcode 'Broker-backed: Profit target' text", () => {
    const combined = helperSource.toLowerCase();
    const profitIdx = combined.indexOf("profit");
    const targetIdx = combined.indexOf("target");
    if (profitIdx !== -1 && targetIdx !== -1) {
      // Check that 'broker' does not appear within 30 chars of 'profit target'
      const window = combined.slice(
        Math.max(0, Math.min(profitIdx, targetIdx) - 10),
        Math.max(profitIdx, targetIdx) + 30,
      );
      assert.ok(
        !window.includes("broker"),
        `summary-strip-helpers must not combine 'broker' with 'profit target': found near offset ${profitIdx}`,
      );
    }
    // If profit/target not found at all, invariant is trivially satisfied
  });
});
