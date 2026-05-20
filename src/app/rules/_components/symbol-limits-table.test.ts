/**
 * Source-scan tests for the symbol-specific max-contracts UI (Phase 4B).
 *
 * The component is a React client component; these tests assert structural
 * guarantees without a DOM:
 *   - the symbol picker is registry-backed (no free-text entry)
 *   - SIL is not selectable
 *   - duplicate symbols are excluded
 *   - the max-contracts input is bounded 1–1000
 *   - the equivalent display uses metadata helpers
 *   - the locked/disabled state propagates to every control
 *   - copy says "monitoring only" — no broker-backed / live-enforcement claim
 *   - no evaluator wiring and no broker calls were introduced
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { SUPPORTED_PICKER_SYMBOLS } from "../../../lib/futures/symbol-limits.ts";

const TABLE = resolve(import.meta.dirname, "symbol-limits-table.tsx");
const COPY = resolve(import.meta.dirname, "position-size-copy.ts");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

// ── Picker is registry-backed, no free text ──────────────────────────────────

describe("SymbolLimitsTable — registry-backed picker", () => {
  it("is a client component", () => {
    assert.ok(read(TABLE).includes('"use client"'), "must be a client component");
  });

  it("builds its options from SUPPORTED_PICKER_SYMBOLS", () => {
    assert.ok(
      read(TABLE).includes("SUPPORTED_PICKER_SYMBOLS"),
      "symbol options must come from the Phase A allowlist",
    );
  });

  it("uses a <select> dropdown for symbols — no free-text input path", () => {
    const src = read(TABLE);
    assert.ok(src.includes("<select"), "symbol entry must be a <select> dropdown");
    assert.ok(
      !src.includes('type="text"'),
      "there must be no free-text symbol input in v1",
    );
  });

  it("groups options into <optgroup> by market", () => {
    assert.ok(read(TABLE).includes("<optgroup"), "options must be grouped by market");
  });

  it("does not hardcode SIL as a selectable option — it is excluded from the v1 allowlist", () => {
    assert.ok(
      !read(TABLE).includes('"SIL"'),
      "component must not hardcode SIL as a string literal / selectable option",
    );
  });

  it("SIL is absent from SUPPORTED_PICKER_SYMBOLS, so it cannot be selected", () => {
    assert.ok(!SUPPORTED_PICKER_SYMBOLS.includes("SIL"), "SIL must not be selectable in v1");
  });

  it("excludes already-used symbols to prevent duplicates", () => {
    const src = read(TABLE);
    assert.ok(src.includes("usedSymbols"), "must track used symbols");
    assert.ok(
      src.includes("!usedSymbols.has"),
      "the symbol dropdown must filter out symbols already used in other rows",
    );
  });
});

// ── Max contracts input bounds ───────────────────────────────────────────────

describe("SymbolLimitsTable — max contracts input", () => {
  it("is a numeric input bounded 1–1000", () => {
    const src = read(TABLE);
    assert.ok(src.includes('type="number"'), "max contracts must be a numeric input");
    assert.ok(src.includes("min={1}"), "max contracts input must have min 1");
    assert.ok(
      src.includes("max={MAX_SYMBOL_CONTRACTS}"),
      "max contracts input must be capped at MAX_SYMBOL_CONTRACTS (1000)",
    );
  });

  it("flags rows outside the 1–1000 range", () => {
    assert.ok(
      read(TABLE).includes("Enter 1–1000"),
      "out-of-range rows must show an inline 'Enter 1-1000' hint",
    );
  });
});

// ── Equivalent display ───────────────────────────────────────────────────────

describe("SymbolLimitsTable — equivalent display", () => {
  it("uses describeSymbolEquivalent (metadata-derived, not hardcoded)", () => {
    assert.ok(
      read(TABLE).includes("describeSymbolEquivalent"),
      "the Equivalent column must use the metadata-driven helper",
    );
  });
});

// ── Remove + add ─────────────────────────────────────────────────────────────

describe("SymbolLimitsTable — add / remove", () => {
  it("has an Add symbol button", () => {
    assert.ok(read(TABLE).includes("Add symbol"), "must have an Add symbol control");
  });

  it("has a per-row Remove button", () => {
    const src = read(TABLE);
    assert.ok(src.includes("removeRow"), "must support removing a row");
    assert.ok(src.includes(">Remove<") || src.includes("Remove "), "must render a Remove control");
  });
});

// ── Locked / disabled state ──────────────────────────────────────────────────

describe("SymbolLimitsTable — disabled state", () => {
  it("accepts a disabled prop", () => {
    assert.ok(read(TABLE).includes("disabled = false"), "must accept a disabled prop");
  });

  it("disables the select, the input, and both buttons when disabled", () => {
    const src = read(TABLE);
    // Every interactive control must carry disabled={disabled} (or be gated by it).
    const disabledRefs = (src.match(/disabled=\{disabled/g) ?? []).length;
    assert.ok(
      disabledRefs >= 3,
      `select, number input and remove button must all honor the disabled prop (found ${disabledRefs})`,
    );
    assert.ok(
      src.includes("disabled={disabled || !canAdd}"),
      "the Add symbol button must be disabled when the form is locked",
    );
  });

  it("guards add/remove/update against the disabled state", () => {
    const src = read(TABLE);
    assert.ok(src.includes("if (disabled"), "row mutations must early-return when disabled");
  });
});

// ── No evaluator wiring, no broker calls ─────────────────────────────────────

describe("SymbolLimitsTable — safety", () => {
  it("does not import the evaluator (resolveSymbolLimit) — Phase C is not wired", () => {
    assert.ok(
      !read(TABLE).includes("resolveSymbolLimit"),
      "Phase B must not wire the guardian evaluator",
    );
  });

  it("does not import broker clients or trigger broker writes", () => {
    const src = read(TABLE);
    for (const forbidden of [
      "TradovateClient",
      "applyMaxPositionSize",
      "executeDailyLossSync",
      "@/lib/db",
    ]) {
      assert.ok(!src.includes(forbidden), `component must not reference "${forbidden}"`);
    }
  });
});

// ── Copy — monitoring only, no broker-backed / live-enforcement claim ────────

describe("SYMBOL_LIMITS_COPY", () => {
  it("describes the limits as saved with the Trading Plan", () => {
    assert.ok(
      read(COPY).includes("saved with"),
      "copy must say symbol limits are saved with the Trading Plan",
    );
  });

  it("explicitly says broker-side enforcement is not used", () => {
    assert.ok(
      /broker-side enforcement is not\s+used/i.test(read(COPY)),
      "copy must state broker-side enforcement is not used for this rule",
    );
  });

  it("does not claim broker-backed or live per-symbol enforcement", () => {
    const src = read(COPY).toLowerCase();
    const symbolCopy = src.slice(src.indexOf("symbol_limits_copy"));
    for (const phrase of [
      "broker-backed",
      "broker enforced",
      "actively enforced",
      "live enforcement",
      "guardian enforces",
    ]) {
      assert.ok(
        !symbolCopy.includes(phrase),
        `symbol-limits copy must not claim "${phrase}" before Phase C`,
      );
    }
  });

  it("signals that engine support is a later rollout", () => {
    assert.ok(
      /next rollout/i.test(read(COPY)),
      "copy must tell the user engine support activates in a later rollout",
    );
  });

  it("provides the global fallback note", () => {
    assert.ok(
      read(COPY).includes("Global fallback"),
      "copy must include the global-fallback note for the maxContracts field",
    );
  });
});
