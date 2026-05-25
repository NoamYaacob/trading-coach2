/**
 * PR #37 redesign — source-scan invariants.
 *
 * The account Trading Plan page now centers on a single "Core rules" card
 * with five compact RuleRow controls. Everything else collapses into a
 * <details> accordion stack underneath. This file locks the new layout so
 * future edits don't silently re-expand sections that should stay closed.
 */
import { test, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname);

function read(rel: string) {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

// ── Core rules card contains exactly the 5 enforce-today rules ───────────────

describe("CoreRulesSection — five compact RuleRows", () => {
  const SRC = read("sections/core-rules-section.tsx");

  it("renders a SectionCard with title 'Core rules'", () => {
    assert.ok(
      SRC.includes('title="Core rules"') && SRC.includes('ariaLabel="Core rules"'),
      "core-rules-section must render <SectionCard title=\"Core rules\" ariaLabel=\"Core rules\">",
    );
  });

  it("uses the compact RuleRow primitive, not the full Field card", () => {
    const ruleRowCount = (SRC.match(/<RuleRow\b/g) ?? []).length;
    assert.equal(
      ruleRowCount,
      5,
      `core-rules-section must render exactly 5 <RuleRow> elements (found ${ruleRowCount})`,
    );
  });

  it("declares one row per enforce-today rule label", () => {
    for (const label of [
      "Daily loss limit ($)",
      "Risk per trade ($)",
      "Max trades per day",
      "Stop after consecutive losses",
      "MAX_POSITION_SIZE_COPY.label",
    ]) {
      assert.ok(
        SRC.includes(label),
        `core-rules-section must declare a RuleRow with label ${label}`,
      );
    }
  });

  it("does not include Max trades per week (placeholder lives in PlannedRulesSection)", () => {
    assert.ok(
      !SRC.includes("Max trades per week"),
      "Max trades per week must not surface in Core rules — it is not enforced today",
    );
  });

  it("does not include any planned broker action labels", () => {
    for (const banned of ["PDLL", "PDPT", "Liquidate", "Symbol blocks"]) {
      assert.ok(
        !SRC.includes(banned),
        `Core rules must not advertise '${banned}' — those live in Advanced broker actions / Planned rules`,
      );
    }
  });

  it("tags integer rules with status='guardrail-lock'", () => {
    // Three rules create internal locks: Max trades, Stop after losses, Max contracts.
    const count = (SRC.match(/status="guardrail-lock"/g) ?? []).length;
    assert.equal(
      count,
      3,
      `expected exactly 3 guardrail-lock rows (Max trades / Stop after losses / Max contracts), found ${count}`,
    );
  });

  it("tags Daily loss limit with status='broker-eligible'", () => {
    assert.ok(
      SRC.includes('status="broker-eligible"'),
      "Daily loss limit must be tagged broker-eligible — it is the only Tradovate-write-eligible rule",
    );
  });

  it("tags Risk per trade with status='monitoring-only'", () => {
    assert.ok(
      SRC.includes('status="monitoring-only"'),
      "Risk per trade must be tagged monitoring-only — it never locks",
    );
  });
});

// ── RuleRow primitive in field-primitives ────────────────────────────────────

describe("RuleRow primitive (field-primitives.tsx)", () => {
  const SRC = read("sections/field-primitives.tsx");

  it("exports a RuleRow function", () => {
    assert.ok(
      /export function RuleRow\b/.test(SRC),
      "field-primitives must export RuleRow",
    );
  });

  it("RuleRow forwards status to a compact RuleStatusBadge", () => {
    assert.ok(
      SRC.includes("RuleStatusBadge") && SRC.includes("compact"),
      "RuleRow must render a compact RuleStatusBadge so labels stay short",
    );
  });

  it("RuleRow info disclosure uses <details>/<summary> (no JS toggle)", () => {
    assert.ok(
      SRC.includes("<details") && SRC.includes("<summary"),
      "RuleRow's info trigger must be a native <details> for zero JS",
    );
  });

  it("RuleRow has no long inline hint by default — info goes behind '?' trigger", () => {
    // The RuleRow signature must NOT take a `hint` prop. Long copy is in `info`.
    const sig = SRC.slice(SRC.indexOf("export function RuleRow"));
    const body = sig.slice(0, sig.indexOf("\n}\n") + 3);
    assert.ok(
      !/\bhint\?:/.test(body),
      "RuleRow must not accept a `hint` prop — long copy belongs behind the info disclosure",
    );
  });
});

// ── Advanced rows are collapsed by default ───────────────────────────────────

describe("Advanced rows — collapsed by default", () => {
  it("symbol-limits-row is a <details> without `open`", () => {
    const src = read("sections/symbol-limits-row.tsx");
    assert.ok(
      src.includes('aria-label="Contract limits by symbol"'),
      "symbol-limits-row must declare aria-label=\"Contract limits by symbol\"",
    );
    assert.ok(
      !/<details\b[^>]*\bopen\b/.test(src),
      "symbol-limits-row <details> must not default to open",
    );
  });

  it("session-cutoff-section is a <details> without `open`", () => {
    const src = read("sections/session-cutoff-section.tsx");
    assert.ok(
      src.includes('aria-label="Session cutoff"'),
      "session-cutoff-section must declare aria-label=\"Session cutoff\"",
    );
    assert.ok(
      !/<details\b[^>]*\bopen\b/.test(src),
      "session-cutoff-section <details> must not default to open",
    );
  });

  it("notifications-section is a <details> without `open` (compact row)", () => {
    const src = read("sections/notifications-section.tsx");
    assert.ok(
      src.includes('aria-label="Notifications"'),
      "notifications-section must declare aria-label=\"Notifications\"",
    );
    assert.ok(
      !/<details\b[^>]*\bopen\b/.test(src),
      "notifications-section <details> must not default to open",
    );
    // The compact summary line should mention the actual delivery channels.
    assert.ok(
      src.includes("In-app active") && src.includes("Telegram"),
      "notifications summary must read 'In-app active · Telegram optional'",
    );
  });

  it("advanced-broker-actions-section stays collapsed by default", () => {
    // The full read-only / no-inputs invariants live in
    // advanced-broker-actions-section.test.ts. Here we only assert the
    // section is still collapsed after the PR #37 layout change.
    const src = read("sections/advanced-broker-actions-section.tsx");
    assert.ok(
      !/<details\b[^>]*\bopen\b/.test(src),
      "advanced-broker-actions-section <details> must not default to open",
    );
  });
});

// ── Account form composition ────────────────────────────────────────────────

describe("AccountRulesForm composition (PR #37)", () => {
  const SRC = read("account-rules-form.tsx");

  it("renders <CoreRulesSection> as the first editable card", () => {
    assert.ok(
      SRC.includes("<CoreRulesSection"),
      "account-rules-form must render <CoreRulesSection>",
    );
  });

  it("does not import or render the deprecated MoneyLimits/TradingBehavior/PositionSymbol cards", () => {
    for (const removed of ["MoneyLimitsSection", "TradingBehaviorSection", "PositionSymbolSection"]) {
      assert.ok(
        !SRC.includes(removed),
        `account-rules-form must not reference removed section '${removed}'`,
      );
    }
  });

  it("renders <SymbolLimitsRow> for the per-symbol cap collapsed accordion", () => {
    assert.ok(SRC.includes("<SymbolLimitsRow"), "account-rules-form must render <SymbolLimitsRow>");
  });

  it("submit payload still passes every existing field unchanged", () => {
    for (const key of [
      "maxDailyLoss: num",
      "riskPerTrade: num",
      "maxTradesPerDay: int",
      "stopAfterLosses: int",
      "maxContracts: int",
      "rawBrokerHardLimitEnabled:",
      "maxContractsBySymbolJson:",
    ]) {
      assert.ok(
        SRC.includes(key),
        `submit payload must still include '${key}' — redesign is UI-only`,
      );
    }
  });
});

// ── Safety: redesign is UI-only ──────────────────────────────────────────────

describe("PR #37 safety: UI redesign does not pull in broker/server modules", () => {
  const FILES = [
    "sections/core-rules-section.tsx",
    "sections/symbol-limits-row.tsx",
    "sections/field-primitives.tsx",
  ];

  for (const rel of FILES) {
    it(`${rel} imports no Tradovate / prisma / server-action code`, () => {
      const src = read(rel);
      for (const banned of [
        "TradovateClient",
        "prisma",
        "@/lib/db",
        "@/lib/env",
        '"server-only"',
        '"use server"',
      ]) {
        assert.ok(
          !src.includes(banned),
          `${rel} must not import '${banned}' — UI-only redesign`,
        );
      }
    });

    it(`${rel} does not reference broker write/cancel/flatten actions`, () => {
      const src = read(rel);
      for (const banned of ["cancelOrder", "liquidate", "flattenPosition", "sendOrder"]) {
        assert.ok(
          !src.includes(banned),
          `${rel} must not reference broker action '${banned}'`,
        );
      }
    });
  }
});

// ── How enforcement works trigger stays minimal ──────────────────────────────

test("how-enforcement-works: renders as a minimal inline trigger, not a full card", () => {
  const src = readFileSync(resolve(ROOT, "how-enforcement-works.tsx"), "utf8");
  // The outer <details> must NOT carry the large card styling that was used
  // before PR #37 (border + bg + px-4 py-3 in one line). The card styling
  // moved INSIDE the disclosure so the collapsed trigger is just a small link.
  const summaryMatch = src.match(/<summary\b([^>]*)>/);
  assert.ok(summaryMatch, "how-enforcement-works must have a <summary>");
  const summaryAttrs = summaryMatch![1];
  assert.ok(
    /\binline-flex\b/.test(summaryAttrs) || /\bw-fit\b/.test(summaryAttrs),
    "summary must collapse to fit content (inline-flex / w-fit), not a full-width card",
  );
});
