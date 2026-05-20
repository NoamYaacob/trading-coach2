/**
 * Source-scan tests for the per-symbol contract-limits UI (Phase 4B polish).
 *
 * The component is a React client component; these tests assert structural
 * guarantees without a DOM:
 *   - TopstepX-style: an "Add limit" composer row + a "Current contract
 *     limits" list
 *   - the symbol picker is registry-backed (no free-text entry); SIL excluded
 *   - the selected symbol is stored as the plain root even though it is
 *     displayed with a leading slash
 *   - the raw per-symbol limit is bounded 1–1000
 *   - the equivalent helper is secondary text only
 *   - the empty state reads "No contract limits set yet."
 *   - no "symbol block" framing, no broker-backed claim
 *   - the locked state disables every control
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

// ── TopstepX-style layout: add row + current limits list ─────────────────────

describe("SymbolLimitsTable — layout", () => {
  it("is a client component", () => {
    assert.ok(read(TABLE).includes('"use client"'), "must be a client component");
  });

  it("has an Add-limit composer row", () => {
    const src = read(TABLE);
    assert.ok(src.includes("Add limit"), "must have an 'Add limit' button");
    assert.ok(src.includes("addLimit"), "must have an addLimit handler");
  });

  it("renders a 'Current contract limits' list", () => {
    assert.ok(
      read(TABLE).includes("SYMBOL_LIMITS_COPY.currentHeading"),
      "must render the current-limits list under its heading",
    );
  });

  it("shows the empty state when no limits are configured", () => {
    assert.ok(
      read(TABLE).includes("SYMBOL_LIMITS_COPY.emptyState"),
      "must render the empty-state copy when there are no rows",
    );
  });
});

// ── Registry-backed picker, no free text ─────────────────────────────────────

describe("SymbolLimitsTable — registry-backed picker", () => {
  it("builds its options from SUPPORTED_PICKER_SYMBOLS", () => {
    assert.ok(
      read(TABLE).includes("SUPPORTED_PICKER_SYMBOLS"),
      "symbol options must come from the Phase A allowlist",
    );
  });

  it("uses a <select> dropdown for symbols — no free-text input path", () => {
    const src = read(TABLE);
    assert.ok(src.includes("<select"), "symbol entry must be a <select> dropdown");
    assert.ok(!src.includes('type="text"'), "there must be no free-text symbol input in v1");
  });

  it("groups options by market with <optgroup> (secondary aid)", () => {
    assert.ok(read(TABLE).includes("<optgroup"), "options must be grouped by market");
  });

  it("does not hardcode SIL as a selectable option", () => {
    assert.ok(
      !read(TABLE).includes('"SIL"'),
      "component must not hardcode SIL as a string literal / selectable option",
    );
  });

  it("SIL is absent from SUPPORTED_PICKER_SYMBOLS, so it cannot be selected", () => {
    assert.ok(!SUPPORTED_PICKER_SYMBOLS.includes("SIL"), "SIL must not be selectable in v1");
  });

  it("excludes already-configured symbols from the Add-limit dropdown", () => {
    const src = read(TABLE);
    assert.ok(src.includes("usedSymbols"), "must track configured symbols");
    assert.ok(
      src.includes("!usedSymbols.has"),
      "the dropdown must filter out symbols that already have a limit",
    );
  });
});

// ── Symbol is displayed with a slash but stored plain ────────────────────────

describe("SymbolLimitsTable — symbol storage", () => {
  it("displays symbols with a leading slash (TopstepX style)", () => {
    assert.ok(
      read(TABLE).includes("displaySymbol"),
      "component must format the displayed symbol with a slash",
    );
    assert.ok(
      read(TABLE).includes("`/${symbol}`"),
      "displaySymbol must prepend a slash for display only",
    );
  });

  it("stores the plain registry root as the option value", () => {
    assert.ok(
      read(TABLE).includes("value={o.symbol}"),
      "the <option> value must be the plain symbol root, not the slash form",
    );
  });

  it("stores the plain selected symbol on the row (no slash)", () => {
    assert.ok(
      read(TABLE).includes("symbol: draftSymbol"),
      "a new limit row must store the plain draftSymbol value",
    );
    assert.ok(
      !read(TABLE).includes("symbol: displaySymbol"),
      "the stored row symbol must never be the slash display form",
    );
  });
});

// ── Raw per-symbol limit, bounded 1–1000 ─────────────────────────────────────

describe("SymbolLimitsTable — limit input", () => {
  it("is a numeric input bounded 1–1000", () => {
    const src = read(TABLE);
    assert.ok(src.includes('type="number"'), "limit must be a numeric input");
    assert.ok(src.includes("min={1}"), "limit input must have min 1");
    assert.ok(
      src.includes("max={MAX_SYMBOL_CONTRACTS}"),
      "limit input must be capped at MAX_SYMBOL_CONTRACTS (1000)",
    );
  });

  it("the raw limit is stored per selected symbol", () => {
    assert.ok(
      read(TABLE).includes("{ symbol: draftSymbol, maxContracts:"),
      "each row pairs the selected symbol with its own raw maxContracts limit",
    );
  });

  it("rejects an out-of-range draft limit before it can be added", () => {
    const src = read(TABLE);
    assert.ok(src.includes("draftLimitValid"), "must validate the draft limit");
    assert.ok(
      src.includes("Enter a whole number from 1 to"),
      "must show an inline hint for an out-of-range draft limit",
    );
  });
});

// ── Equivalent helper is secondary ───────────────────────────────────────────

describe("SymbolLimitsTable — equivalent helper", () => {
  it("uses describeSymbolEquivalent (metadata-derived, not hardcoded)", () => {
    assert.ok(
      read(TABLE).includes("describeSymbolEquivalent"),
      "the equivalent helper must use the metadata-driven function",
    );
  });

  it("renders the equivalent as small, muted secondary text", () => {
    const src = read(TABLE);
    const idx = src.indexOf("equivalent !== \"\"");
    assert.ok(idx !== -1, "equivalent must be conditionally rendered");
    const block = src.slice(idx, idx + 160);
    assert.ok(
      block.includes("text-[11px]") && block.includes("text-stone-400"),
      "the equivalent helper text must be styled smaller/secondary, not primary",
    );
  });
});

// ── Locked / disabled state ──────────────────────────────────────────────────

describe("SymbolLimitsTable — disabled state", () => {
  it("accepts a disabled prop", () => {
    assert.ok(read(TABLE).includes("disabled = false"), "must accept a disabled prop");
  });

  it("disables the symbol select, the limit input and the remove buttons", () => {
    const src = read(TABLE);
    const refs = (src.match(/disabled=\{disabled\}/g) ?? []).length;
    assert.ok(
      refs >= 3,
      `select, limit input and remove button must each honor disabled={disabled} (found ${refs})`,
    );
  });

  it("disables the Add-limit button when the form is locked", () => {
    const src = read(TABLE);
    assert.ok(
      src.includes("const canAdd = !disabled"),
      "canAdd must be false when the form is disabled",
    );
    assert.ok(
      src.includes("disabled={!canAdd}"),
      "the Add-limit button must be disabled via canAdd",
    );
  });

  it("guards row removal against the disabled state", () => {
    assert.ok(
      read(TABLE).includes("if (disabled) return"),
      "removeLimit must early-return when disabled",
    );
  });
});

// ── Not a symbol-block feature ───────────────────────────────────────────────

describe("SymbolLimitsTable — framing", () => {
  it("does not use 'block' / 'blocked' framing — this is a contract-limit feature", () => {
    const src = read(TABLE).toLowerCase();
    assert.ok(!src.includes("block"), "component must not frame symbols as blocked");
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

// ── Copy — TopstepX-style contract-limit framing, no broker enforcement ──────

describe("SYMBOL_LIMITS_COPY", () => {
  it("names the section 'Contract limits by symbol'", () => {
    assert.ok(
      read(COPY).includes('heading: "Contract limits by symbol"'),
      "section heading must be 'Contract limits by symbol'",
    );
  });

  it("describes per-account monitoring of per-symbol limits", () => {
    assert.ok(
      /Guardrail monitors these limits per\s+account/i.test(read(COPY)),
      "copy must say Guardrail monitors these limits per account",
    );
  });

  it("explicitly says broker-side enforcement is not used", () => {
    assert.ok(
      /broker-side enforcement is not\s+used/i.test(read(COPY)),
      "copy must state broker-side enforcement is not used for this rule",
    );
  });

  it("uses the global-fallback note 'Fallback limit ...'", () => {
    assert.ok(
      read(COPY).includes("Fallback limit — used only for symbols"),
      "the maxContracts field note must describe it as a fallback limit",
    );
  });

  it("empty state reads 'No contract limits set yet.'", () => {
    assert.ok(
      read(COPY).includes('emptyState: "No contract limits set yet."'),
      "empty state must read 'No contract limits set yet.'",
    );
  });

  it("does not claim broker-backed enforcement or use block framing", () => {
    const src = read(COPY).toLowerCase();
    const symbolCopy = src.slice(src.indexOf("symbol_limits_copy"));
    for (const phrase of ["broker-backed", "broker enforced", "broker will", "block"]) {
      assert.ok(
        !symbolCopy.includes(phrase),
        `symbol-limits copy must not contain "${phrase}"`,
      );
    }
  });
});
