/**
 * Unit tests for src/lib/futures/symbol-limits.ts — Phase 4 foundation.
 *
 * Pure-function tests: parsing, validation, the resolve function, and the
 * SUPPORTED_PICKER_SYMBOLS allowlist. No DB, no network, no broker client.
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  MAX_SYMBOL_CONTRACTS,
  SUPPORTED_PICKER_SYMBOLS,
  isSupportedPickerSymbol,
  parseSymbolLimits,
  validateSymbolLimits,
  resolveSymbolLimit,
  describeSymbolEquivalent,
} from "./symbol-limits.ts";
import { getContractMetadata } from "./contracts.ts";

// ── MAX_SYMBOL_CONTRACTS ──────────────────────────────────────────────────────

describe("MAX_SYMBOL_CONTRACTS", () => {
  it("is 1000", () => {
    assert.equal(MAX_SYMBOL_CONTRACTS, 1000);
  });
});

// ── SUPPORTED_PICKER_SYMBOLS ──────────────────────────────────────────────────

describe("SUPPORTED_PICKER_SYMBOLS", () => {
  it("contains only symbols that resolve to a registry contract", () => {
    for (const symbol of SUPPORTED_PICKER_SYMBOLS) {
      const meta = getContractMetadata(symbol);
      assert.ok(meta !== null, `picker symbol "${symbol}" must exist in the futures registry`);
      assert.equal(meta!.symbolRoot, symbol, `picker symbol "${symbol}" must match its registry root exactly`);
    }
  });

  it("has no duplicate entries", () => {
    const unique = new Set(SUPPORTED_PICKER_SYMBOLS);
    assert.equal(unique.size, SUPPORTED_PICKER_SYMBOLS.length, "SUPPORTED_PICKER_SYMBOLS must not contain duplicates");
  });

  it("all entries are uppercase", () => {
    for (const symbol of SUPPORTED_PICKER_SYMBOLS) {
      assert.equal(symbol, symbol.toUpperCase(), `picker symbol "${symbol}" must be uppercase`);
    }
  });

  it("excludes SIL — its registry exposureRatioToParent is pending verification", () => {
    assert.ok(
      !SUPPORTED_PICKER_SYMBOLS.includes("SIL"),
      "SIL must NOT be in v1 picker until its exposureRatioToParent is verified",
    );
  });

  it("includes the core prop-firm day-trading symbols", () => {
    const core = ["ES", "MES", "NQ", "MNQ", "YM", "MYM", "RTY", "M2K", "CL", "MCL", "GC", "MGC"];
    for (const s of core) {
      assert.ok(SUPPORTED_PICKER_SYMBOLS.includes(s), `core symbol "${s}" must be in the v1 picker`);
    }
  });

  it("includes the newly added FX micros and Treasury futures", () => {
    for (const s of ["M6B", "M6J", "M6C", "M6S", "ZB", "ZN", "ZF", "ZT", "UB", "KE"]) {
      assert.ok(SUPPORTED_PICKER_SYMBOLS.includes(s), `new symbol "${s}" must be in the v1 picker`);
    }
  });
});

describe("isSupportedPickerSymbol", () => {
  it("returns true for a supported symbol", () => {
    assert.equal(isSupportedPickerSymbol("NQ"), true);
  });

  it("is case-insensitive", () => {
    assert.equal(isSupportedPickerSymbol("nq"), true);
    assert.equal(isSupportedPickerSymbol("mnq"), true);
  });

  it("trims whitespace", () => {
    assert.equal(isSupportedPickerSymbol("  NQ  "), true);
  });

  it("returns false for an unsupported symbol", () => {
    assert.equal(isSupportedPickerSymbol("AAPL"), false);
    assert.equal(isSupportedPickerSymbol("SIL"), false);
  });
});

// ── parseSymbolLimits — lenient read path ────────────────────────────────────

describe("parseSymbolLimits", () => {
  it("returns [] for null", () => {
    assert.deepEqual(parseSymbolLimits(null), []);
  });

  it("returns [] for undefined", () => {
    assert.deepEqual(parseSymbolLimits(undefined), []);
  });

  it("returns [] for empty string", () => {
    assert.deepEqual(parseSymbolLimits(""), []);
  });

  it("returns [] for whitespace-only string", () => {
    assert.deepEqual(parseSymbolLimits("   "), []);
  });

  it("returns [] for an empty JSON array", () => {
    assert.deepEqual(parseSymbolLimits("[]"), []);
  });

  it("parses a valid JSON array", () => {
    const result = parseSymbolLimits('[{"symbol":"NQ","maxContracts":2},{"symbol":"MNQ","maxContracts":10}]');
    assert.deepEqual(result, [
      { symbol: "NQ", maxContracts: 2 },
      { symbol: "MNQ", maxContracts: 10 },
    ]);
  });

  it("returns [] for malformed JSON (lenient — never throws)", () => {
    assert.deepEqual(parseSymbolLimits("not json"), []);
    assert.deepEqual(parseSymbolLimits("[{bad}]"), []);
  });

  it("returns [] for a non-array JSON value", () => {
    assert.deepEqual(parseSymbolLimits('{"symbol":"NQ"}'), []);
    assert.deepEqual(parseSymbolLimits('"NQ"'), []);
    assert.deepEqual(parseSymbolLimits("42"), []);
  });

  it("normalizes symbols to uppercase", () => {
    const result = parseSymbolLimits('[{"symbol":"nq","maxContracts":2}]');
    assert.deepEqual(result, [{ symbol: "NQ", maxContracts: 2 }]);
  });

  it("drops entries with a missing or empty symbol", () => {
    const result = parseSymbolLimits('[{"maxContracts":2},{"symbol":"","maxContracts":3},{"symbol":"NQ","maxContracts":4}]');
    assert.deepEqual(result, [{ symbol: "NQ", maxContracts: 4 }]);
  });

  it("drops entries with a non-positive or non-integer maxContracts", () => {
    const result = parseSymbolLimits(
      '[{"symbol":"NQ","maxContracts":0},{"symbol":"ES","maxContracts":-1},{"symbol":"CL","maxContracts":1.5},{"symbol":"GC","maxContracts":3}]',
    );
    assert.deepEqual(result, [{ symbol: "GC", maxContracts: 3 }]);
  });

  it("keeps the first entry when a symbol is duplicated", () => {
    const result = parseSymbolLimits('[{"symbol":"NQ","maxContracts":2},{"symbol":"NQ","maxContracts":9}]');
    assert.deepEqual(result, [{ symbol: "NQ", maxContracts: 2 }]);
  });
});

// ── validateSymbolLimits — strict API-boundary validation ────────────────────

describe("validateSymbolLimits — accepts", () => {
  it("null (no symbol limits configured)", () => {
    assert.equal(validateSymbolLimits(null), null);
  });

  it("undefined", () => {
    assert.equal(validateSymbolLimits(undefined), null);
  });

  it("empty string", () => {
    assert.equal(validateSymbolLimits(""), null);
  });

  it("empty JSON array", () => {
    assert.equal(validateSymbolLimits("[]"), null);
  });

  it("a valid array of supported symbols", () => {
    assert.equal(
      validateSymbolLimits('[{"symbol":"NQ","maxContracts":2},{"symbol":"MNQ","maxContracts":10}]'),
      null,
    );
  });

  it("maxContracts at the cap (1000)", () => {
    assert.equal(validateSymbolLimits('[{"symbol":"NQ","maxContracts":1000}]'), null);
  });

  it("maxContracts at the minimum (1)", () => {
    assert.equal(validateSymbolLimits('[{"symbol":"NQ","maxContracts":1}]'), null);
  });
});

describe("validateSymbolLimits — rejects", () => {
  it("malformed JSON", () => {
    const err = validateSymbolLimits("not json");
    assert.ok(err);
    assert.match(err!.message, /valid JSON/);
  });

  it("a non-array JSON value", () => {
    const err = validateSymbolLimits('{"symbol":"NQ","maxContracts":2}');
    assert.ok(err);
    assert.match(err!.message, /array/);
  });

  it("a non-object array entry", () => {
    const err = validateSymbolLimits('["NQ"]');
    assert.ok(err);
    assert.match(err!.message, /object/);
  });

  it("an empty symbol", () => {
    const err = validateSymbolLimits('[{"symbol":"","maxContracts":2}]');
    assert.ok(err);
    assert.match(err!.message, /non-empty symbol/);
  });

  it("a missing symbol", () => {
    const err = validateSymbolLimits('[{"maxContracts":2}]');
    assert.ok(err);
    assert.match(err!.message, /non-empty symbol/);
  });

  it("a lowercase symbol (must be uppercase)", () => {
    const err = validateSymbolLimits('[{"symbol":"nq","maxContracts":2}]');
    assert.ok(err);
    assert.match(err!.message, /uppercase/);
  });

  it("an unsupported symbol", () => {
    const err = validateSymbolLimits('[{"symbol":"AAPL","maxContracts":2}]');
    assert.ok(err);
    assert.match(err!.message, /not a supported symbol/);
  });

  it("SIL — excluded from v1 picker until its ratio is verified", () => {
    const err = validateSymbolLimits('[{"symbol":"SIL","maxContracts":2}]');
    assert.ok(err);
    assert.match(err!.message, /not a supported symbol/);
  });

  it("a duplicate symbol", () => {
    const err = validateSymbolLimits('[{"symbol":"NQ","maxContracts":2},{"symbol":"NQ","maxContracts":3}]');
    assert.ok(err);
    assert.match(err!.message, /Duplicate symbol/);
  });

  it("maxContracts of 0", () => {
    const err = validateSymbolLimits('[{"symbol":"NQ","maxContracts":0}]');
    assert.ok(err);
    assert.match(err!.message, /positive integer/);
  });

  it("a negative maxContracts", () => {
    const err = validateSymbolLimits('[{"symbol":"NQ","maxContracts":-3}]');
    assert.ok(err);
    assert.match(err!.message, /positive integer/);
  });

  it("a non-integer maxContracts", () => {
    const err = validateSymbolLimits('[{"symbol":"NQ","maxContracts":2.5}]');
    assert.ok(err);
    assert.match(err!.message, /positive integer/);
  });

  it("a non-numeric maxContracts", () => {
    const err = validateSymbolLimits('[{"symbol":"NQ","maxContracts":"2"}]');
    assert.ok(err);
    assert.match(err!.message, /positive integer/);
  });

  it("maxContracts above the cap (1001)", () => {
    const err = validateSymbolLimits('[{"symbol":"NQ","maxContracts":1001}]');
    assert.ok(err);
    assert.match(err!.message, /must not exceed 1000/);
  });
});

// ── resolveSymbolLimit ────────────────────────────────────────────────────────

describe("resolveSymbolLimit", () => {
  it("uses the symbol-specific limit when the symbol matches", () => {
    const limits = [
      { symbol: "NQ", maxContracts: 2 },
      { symbol: "MNQ", maxContracts: 10 },
    ];
    assert.equal(resolveSymbolLimit("NQ", limits, 5), 2);
    assert.equal(resolveSymbolLimit("MNQ", limits, 5), 10);
  });

  it("falls back to the global limit when no symbol-specific rule exists", () => {
    const limits = [{ symbol: "NQ", maxContracts: 2 }];
    assert.equal(resolveSymbolLimit("CL", limits, 7), 7);
  });

  it("falls back to the global limit when limits is null", () => {
    assert.equal(resolveSymbolLimit("NQ", null, 4), 4);
  });

  it("falls back to the global limit when limits is undefined", () => {
    assert.equal(resolveSymbolLimit("NQ", undefined, 4), 4);
  });

  it("falls back to the global limit when limits is an empty array", () => {
    assert.equal(resolveSymbolLimit("NQ", [], 4), 4);
  });

  it("returns null when there is no symbol-specific rule and no global fallback", () => {
    assert.equal(resolveSymbolLimit("CL", [{ symbol: "NQ", maxContracts: 2 }], null), null);
    assert.equal(resolveSymbolLimit("CL", [{ symbol: "NQ", maxContracts: 2 }], undefined), null);
  });

  it("returns null when no limits and no global fallback", () => {
    assert.equal(resolveSymbolLimit("NQ", null, null), null);
  });

  it("normalizes a Tradovate contract symbol to its root before matching", () => {
    const limits = [{ symbol: "MNQ", maxContracts: 8 }];
    assert.equal(resolveSymbolLimit("MNQM6", limits, 3), 8);
    assert.equal(resolveSymbolLimit("MNQZ26", limits, 3), 8);
  });

  it("matches case-insensitively against stored limits", () => {
    const limits = [{ symbol: "NQ", maxContracts: 2 }];
    assert.equal(resolveSymbolLimit("nq", limits, 5), 2);
  });

  it("handles an unknown broker symbol conservatively — falls back to global", () => {
    const limits = [{ symbol: "NQ", maxContracts: 2 }];
    // An unrecognized symbol never matches a per-symbol rule, so it inherits
    // the account's global cap rather than being treated as unlimited.
    assert.equal(resolveSymbolLimit("XYZ", limits, 6), 6);
  });

  it("returns null for an unknown broker symbol when no global fallback exists", () => {
    assert.equal(resolveSymbolLimit("XYZ", [{ symbol: "NQ", maxContracts: 2 }], null), null);
  });
});

// ── describeSymbolEquivalent ─────────────────────────────────────────────────

describe("describeSymbolEquivalent", () => {
  it("shows the approximate parent-equivalent for micro equity-index symbols", () => {
    assert.equal(describeSymbolEquivalent("MNQ", 10), "≈ 1 NQ-equivalent");
    assert.equal(describeSymbolEquivalent("MES", 10), "≈ 1 ES-equivalent");
    assert.equal(describeSymbolEquivalent("MYM", 10), "≈ 1 YM-equivalent");
    assert.equal(describeSymbolEquivalent("M2K", 10), "≈ 1 RTY-equivalent");
  });

  it("shows the approximate parent-equivalent for micro energy symbols", () => {
    assert.equal(describeSymbolEquivalent("MCL", 10), "≈ 1 CL-equivalent");
  });

  it("shows the approximate parent-equivalent for the mini crude oil contract (ratio 0.5)", () => {
    assert.equal(describeSymbolEquivalent("QM", 2), "≈ 1 CL-equivalent");
  });

  it("shows the approximate parent-equivalent for a newly added FX micro", () => {
    assert.equal(describeSymbolEquivalent("M6B", 10), "≈ 1 6B-equivalent");
  });

  it("returns 'Standalone contract limit' for standard symbols (ratio 1.0)", () => {
    assert.equal(describeSymbolEquivalent("NQ", 5), "Standalone contract limit");
    assert.equal(describeSymbolEquivalent("ES", 3), "Standalone contract limit");
    assert.equal(describeSymbolEquivalent("CL", 2), "Standalone contract limit");
    assert.equal(describeSymbolEquivalent("ZB", 4), "Standalone contract limit");
  });

  it("formats a fractional parent-equivalent with two decimals", () => {
    assert.equal(describeSymbolEquivalent("MNQ", 5), "≈ 0.50 NQ-equivalent");
  });

  it("returns '' for an unknown symbol", () => {
    assert.equal(describeSymbolEquivalent("AAPL", 5), "");
  });

  it("returns '' for a non-positive or non-integer maxContracts", () => {
    assert.equal(describeSymbolEquivalent("MNQ", 0), "");
    assert.equal(describeSymbolEquivalent("MNQ", -3), "");
    assert.equal(describeSymbolEquivalent("MNQ", 2.5), "");
  });

  it("derives ratios from registry metadata — no hardcoded values", () => {
    const src = readFileSync(resolve(import.meta.dirname, "./symbol-limits.ts"), "utf8");
    const fnStart = src.indexOf("export function describeSymbolEquivalent");
    const fnBody = src.slice(fnStart, fnStart + 600);
    assert.ok(
      fnBody.includes("toParentEquivalentContracts") && fnBody.includes("getContractMetadata"),
      "describeSymbolEquivalent must use the registry helpers, not hardcoded ratios",
    );
  });
});

// ── Safety: no broker imports in the helper ──────────────────────────────────

describe("symbol-limits.ts — safety", () => {
  it("does not import broker clients, prisma, or trigger broker writes", () => {
    const src = readFileSync(resolve(import.meta.dirname, "./symbol-limits.ts"), "utf8");
    for (const forbidden of [
      "TradovateClient",
      "@/lib/db",
      "prisma",
      "applyMaxPositionSize",
      "executeDailyLossSync",
      "BROKER_ENFORCEMENT_ENABLED",
    ]) {
      assert.ok(
        !src.includes(forbidden),
        `symbol-limits.ts must not reference "${forbidden}" — it is a pure helper`,
      );
    }
  });
});

// ── Schema: maxContractsBySymbolJson columns exist ───────────────────────────

describe("schema — maxContractsBySymbolJson", () => {
  const schemaPath = resolve(import.meta.dirname, "../../../prisma/schema.prisma");

  it("AccountRiskRules and RiskRules both declare maxContractsBySymbolJson", () => {
    const schema = readFileSync(schemaPath, "utf8");
    const count = (schema.match(/maxContractsBySymbolJson\s+String\?/g) ?? []).length;
    assert.equal(
      count,
      2,
      "maxContractsBySymbolJson String? must be declared on both AccountRiskRules and RiskRules",
    );
  });

  it("a migration adds the maxContractsBySymbolJson columns", () => {
    const migration = readFileSync(
      resolve(import.meta.dirname, "../../../prisma/migrations/20260525000000_add_max_contracts_by_symbol/migration.sql"),
      "utf8",
    );
    assert.ok(
      migration.includes('ALTER TABLE "AccountRiskRules" ADD COLUMN "maxContractsBySymbolJson"'),
      "migration must add the column to AccountRiskRules",
    );
    assert.ok(
      migration.includes('ALTER TABLE "RiskRules" ADD COLUMN "maxContractsBySymbolJson"'),
      "migration must add the column to RiskRules",
    );
  });
});
