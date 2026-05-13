/**
 * Unit tests for src/lib/futures/contracts.ts
 *
 * No network, no DB, no real credentials required.
 *
 * Coverage:
 *  1. normalizeSymbolRoot — known/unknown roots, month/year suffixes
 *  2. getContractMetadata — lookup and null cases
 *  3. getParentContract — parent resolution
 *  4. getExposureRatioToParent — mini and micro ratios
 *  5. toParentEquivalentContracts — conversion and IEEE-754 safety
 *  6. toRawContractLimit — NQ/MNQ/ES/MES, floor semantics, minimum 1
 *  7. comparePositionToLimit — allowed/breach with reason
 *  8. effectiveSupportedRawLimits — shape and values
 *  9. Registry integrity checks
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  normalizeSymbolRoot,
  getContractMetadata,
  getParentContract,
  getExposureRatioToParent,
  toParentEquivalentContracts,
  toRawContractLimit,
  comparePositionToLimit,
  effectiveSupportedRawLimits,
  getAllContracts,
  getSupportedRoots,
} from "./contracts.ts";

// ── 1. normalizeSymbolRoot ────────────────────────────────────────────────────

describe("normalizeSymbolRoot", () => {
  it("bare root passes through unchanged", () => {
    assert.equal(normalizeSymbolRoot("NQ"),  "NQ");
    assert.equal(normalizeSymbolRoot("MNQ"), "MNQ");
    assert.equal(normalizeSymbolRoot("ES"),  "ES");
    assert.equal(normalizeSymbolRoot("MES"), "MES");
    assert.equal(normalizeSymbolRoot("M2K"), "M2K");
  });

  it("strips single-digit year suffix (NQM6 → NQ)", () => {
    assert.equal(normalizeSymbolRoot("NQM6"), "NQ");
  });

  it("strips two-digit year suffix (NQZ26 → NQ)", () => {
    assert.equal(normalizeSymbolRoot("NQZ26"), "NQ");
  });

  it("handles MNQ where root starts with month-like letter (MNQM6 → MNQ)", () => {
    assert.equal(normalizeSymbolRoot("MNQM6"), "MNQ");
  });

  it("MNQZ26 → MNQ", () => {
    assert.equal(normalizeSymbolRoot("MNQZ26"), "MNQ");
  });

  it("MESM6 → MES", () => {
    assert.equal(normalizeSymbolRoot("MESM6"), "MES");
  });

  it("ESM6 → ES", () => {
    assert.equal(normalizeSymbolRoot("ESM6"), "ES");
  });

  it("M2KH25 → M2K (root with digit in name)", () => {
    assert.equal(normalizeSymbolRoot("M2KH25"), "M2K");
  });

  it("MYM with suffix → MYM", () => {
    assert.equal(normalizeSymbolRoot("MYMH6"), "MYM");
  });

  it("RTY with suffix → RTY", () => {
    assert.equal(normalizeSymbolRoot("RTYH25"), "RTY");
  });

  it("is case-insensitive", () => {
    assert.equal(normalizeSymbolRoot("mnqm6"), "MNQ");
    assert.equal(normalizeSymbolRoot("nqz26"), "NQ");
  });

  it("strips leading/trailing whitespace", () => {
    assert.equal(normalizeSymbolRoot("  NQM6  "), "NQ");
  });

  it("unknown root is returned uppercased", () => {
    const result = normalizeSymbolRoot("AAPL");
    assert.equal(result, "AAPL");
  });

  it("all 12 CME month codes are recognised as suffixes on NQ", () => {
    const months = ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"];
    for (const m of months) {
      assert.equal(normalizeSymbolRoot(`NQ${m}6`), "NQ", `NQ${m}6 should normalise to NQ`);
    }
  });
});

// ── 2. getContractMetadata ────────────────────────────────────────────────────

describe("getContractMetadata", () => {
  it("returns metadata for known root", () => {
    const meta = getContractMetadata("NQ");
    assert.ok(meta !== null);
    assert.equal(meta!.symbolRoot, "NQ");
    assert.equal(meta!.displayName, "E-mini Nasdaq-100");
    assert.equal(meta!.exchange, "CME");
    assert.equal(meta!.assetClass, "equity_index");
    assert.equal(meta!.sizeClass, "mini");
  });

  it("accepts a symbol with suffix (MNQM6 → MNQ metadata)", () => {
    const meta = getContractMetadata("MNQM6");
    assert.ok(meta !== null);
    assert.equal(meta!.symbolRoot, "MNQ");
  });

  it("returns null for unknown root", () => {
    assert.equal(getContractMetadata("AAPL"), null);
    assert.equal(getContractMetadata(""), null);
  });

  it("MES has pointValueUsd=5 and tickValueUsd=1.25", () => {
    const meta = getContractMetadata("MES");
    assert.equal(meta!.pointValueUsd, 5);
    assert.equal(meta!.tickValueUsd, 1.25);
  });

  it("GC is in registry but supportedForMiniEquivalent=false", () => {
    const meta = getContractMetadata("GC");
    assert.ok(meta !== null);
    assert.equal(meta!.supportedForMiniEquivalent, false);
  });
});

// ── 3. getParentContract ──────────────────────────────────────────────────────

describe("getParentContract", () => {
  it("MNQ parent is NQ", () => {
    const parent = getParentContract("MNQ");
    assert.ok(parent !== null);
    assert.equal(parent!.symbolRoot, "NQ");
  });

  it("MES parent is ES", () => {
    const parent = getParentContract("MES");
    assert.equal(parent!.symbolRoot, "ES");
  });

  it("M2K parent is RTY", () => {
    const parent = getParentContract("M2K");
    assert.equal(parent!.symbolRoot, "RTY");
  });

  it("NQ parent is NQ (self-referential for the mini)", () => {
    const parent = getParentContract("NQ");
    assert.equal(parent!.symbolRoot, "NQ");
  });

  it("returns null for unknown root", () => {
    assert.equal(getParentContract("UNKNOWN"), null);
  });

  it("MBT parent is BTC", () => {
    const parent = getParentContract("MBT");
    assert.equal(parent!.symbolRoot, "BTC");
  });
});

// ── 4. getExposureRatioToParent ───────────────────────────────────────────────

describe("getExposureRatioToParent", () => {
  it("NQ is 1.0 (it IS the parent)", () => {
    assert.equal(getExposureRatioToParent("NQ"), 1);
  });

  it("MNQ is 0.1 (micro = 1/10 of NQ)", () => {
    assert.equal(getExposureRatioToParent("MNQ"), 0.1);
  });

  it("ES is 1.0", () => {
    assert.equal(getExposureRatioToParent("ES"), 1);
  });

  it("MES is 0.1", () => {
    assert.equal(getExposureRatioToParent("MES"), 0.1);
  });

  it("YM is 1.0 and MYM is 0.1", () => {
    assert.equal(getExposureRatioToParent("YM"),  1);
    assert.equal(getExposureRatioToParent("MYM"), 0.1);
  });

  it("RTY is 1.0 and M2K is 0.1", () => {
    assert.equal(getExposureRatioToParent("RTY"), 1);
    assert.equal(getExposureRatioToParent("M2K"), 0.1);
  });

  it("SIL (micro silver) is 0.2", () => {
    assert.equal(getExposureRatioToParent("SIL"), 0.2);
  });

  it("MBT (micro bitcoin) is 0.02", () => {
    assert.equal(getExposureRatioToParent("MBT"), 0.02);
  });

  it("unknown root falls back to 1.0 (safe — never understates exposure)", () => {
    assert.equal(getExposureRatioToParent("AAPL"), 1);
    assert.equal(getExposureRatioToParent(""), 1);
  });
});

// ── 5. toParentEquivalentContracts ────────────────────────────────────────────

describe("toParentEquivalentContracts", () => {
  it("10 MNQ = 1 NQ-equivalent", () => {
    assert.equal(toParentEquivalentContracts(10, "MNQ"), 1);
  });

  it("2 MNQ = 0.2 NQ-equivalent", () => {
    assert.equal(toParentEquivalentContracts(2, "MNQ"), 0.2);
  });

  it("1 NQ = 1 NQ-equivalent", () => {
    assert.equal(toParentEquivalentContracts(1, "NQ"), 1);
  });

  it("10 MES = 1 ES-equivalent", () => {
    assert.equal(toParentEquivalentContracts(10, "MES"), 1);
  });

  it("1 MES = 0.1 ES-equivalent", () => {
    assert.equal(toParentEquivalentContracts(1, "MES"), 0.1);
  });

  it("uses absolute value (short positions counted as exposure)", () => {
    assert.equal(toParentEquivalentContracts(-10, "MNQ"), 1);
  });

  it("IEEE-754 safety: 11 × 0.1 does not drift below 1.1", () => {
    // 11 * 0.1 in IEEE-754 = 1.1000000000000001
    // The integer-tenths implementation must give exactly 1.1
    assert.equal(toParentEquivalentContracts(11, "MNQ"), 1.1);
  });
});

// ── 6. toRawContractLimit ─────────────────────────────────────────────────────

describe("toRawContractLimit: NQ (1:1)", () => {
  it("maxParentEquivalent=1 → NQ raw limit = 1", () => {
    assert.equal(toRawContractLimit(1, "NQ"), 1);
  });

  it("maxParentEquivalent=2 → NQ raw limit = 2", () => {
    assert.equal(toRawContractLimit(2, "NQ"), 2);
  });
});

describe("toRawContractLimit: MNQ (0.1 ratio, so 1 mini = 10 raw)", () => {
  it("maxParentEquivalent=1 → MNQ raw limit = 10", () => {
    assert.equal(toRawContractLimit(1, "MNQ"), 10);
  });

  it("maxParentEquivalent=2 → MNQ raw limit = 20", () => {
    assert.equal(toRawContractLimit(2, "MNQ"), 20);
  });

  it("maxParentEquivalent=3 → MNQ raw limit = 30", () => {
    assert.equal(toRawContractLimit(3, "MNQ"), 30);
  });
});

describe("toRawContractLimit: ES and MES", () => {
  it("maxParentEquivalent=1 → ES raw limit = 1", () => {
    assert.equal(toRawContractLimit(1, "ES"), 1);
  });

  it("maxParentEquivalent=1 → MES raw limit = 10", () => {
    assert.equal(toRawContractLimit(1, "MES"), 10);
  });

  it("maxParentEquivalent=2 → MES raw limit = 20", () => {
    assert.equal(toRawContractLimit(2, "MES"), 20);
  });
});

describe("toRawContractLimit: RTY and M2K", () => {
  it("maxParentEquivalent=1 → RTY raw limit = 1", () => {
    assert.equal(toRawContractLimit(1, "RTY"), 1);
  });

  it("maxParentEquivalent=1 → M2K raw limit = 10", () => {
    assert.equal(toRawContractLimit(1, "M2K"), 10);
  });
});

describe("toRawContractLimit: floor semantics and minimum 1", () => {
  it("uses floor (not ceil): partial limits round down", () => {
    // 1.5 parent-equivalent / 0.1 ratio = 15.0 → floor(15) = 15
    assert.equal(toRawContractLimit(1.5, "MNQ"), 15);
  });

  it("never returns less than 1 for supported symbols", () => {
    // Very small limit: 0.05 / 0.1 = 0.5 → floor(0.5)=0 → clamped to 1
    assert.equal(toRawContractLimit(0.05, "MNQ"), 1);
    assert.equal(toRawContractLimit(0.001, "NQ"), 1);
  });

  it("unknown root: treated as 1:1, ceiling applied, minimum 1", () => {
    assert.equal(toRawContractLimit(1,   "UNKNOWN"), 1);
    assert.equal(toRawContractLimit(2.5, "UNKNOWN"), 3); // ceil(2.5) = 3
  });

  it("accepts suffix-style input (MNQM6 → same as MNQ)", () => {
    assert.equal(toRawContractLimit(1, "MNQM6"), 10);
  });
});

// ── 7. comparePositionToLimit ─────────────────────────────────────────────────

describe("comparePositionToLimit", () => {
  it("2 MNQ vs maxParentEquivalent=1 → allowed (0.2 ≤ 1)", () => {
    const r = comparePositionToLimit(2, "MNQ", 1);
    assert.equal(r.allowed, true);
    assert.equal(r.parentEquivalentQty, 0.2);
    assert.equal(r.rawLimitForSymbol, 10);
  });

  it("11 MNQ vs maxParentEquivalent=1 → breach (1.1 > 1)", () => {
    const r = comparePositionToLimit(11, "MNQ", 1);
    assert.equal(r.allowed, false);
    assert.equal(r.parentEquivalentQty, 1.1);
    assert.equal(r.rawLimitForSymbol, 10);
    assert.match(r.reason, /exceeds/i);
  });

  it("10 MNQ vs maxParentEquivalent=1 → exactly at limit (allowed)", () => {
    const r = comparePositionToLimit(10, "MNQ", 1);
    assert.equal(r.allowed, true);
    assert.equal(r.parentEquivalentQty, 1);
  });

  it("1 NQ vs maxParentEquivalent=1 → allowed", () => {
    const r = comparePositionToLimit(1, "NQ", 1);
    assert.equal(r.allowed, true);
    assert.equal(r.parentEquivalentQty, 1);
  });

  it("2 NQ vs maxParentEquivalent=1 → breach", () => {
    const r = comparePositionToLimit(2, "NQ", 1);
    assert.equal(r.allowed, false);
    assert.equal(r.parentEquivalentQty, 2);
  });

  it("1 MES vs maxParentEquivalent=1 → allowed (0.1 ≤ 1)", () => {
    const r = comparePositionToLimit(1, "MES", 1);
    assert.equal(r.allowed, true);
    assert.equal(r.parentEquivalentQty, 0.1);
    assert.equal(r.rawLimitForSymbol, 10);
  });

  it("reason string mentions the root and parent-equivalent qty", () => {
    const r = comparePositionToLimit(2, "MNQ", 1);
    assert.match(r.reason, /MNQ/);
    assert.match(r.reason, /0\.2/);
  });
});

// ── 8. effectiveSupportedRawLimits ───────────────────────────────────────────

describe("effectiveSupportedRawLimits", () => {
  it("maxParentEquivalent=1 → NQ=1, MNQ=10, ES=1, MES=10", () => {
    const limits = effectiveSupportedRawLimits(1);
    assert.equal(limits["NQ"],  1);
    assert.equal(limits["MNQ"], 10);
    assert.equal(limits["ES"],  1);
    assert.equal(limits["MES"], 10);
    assert.equal(limits["YM"],  1);
    assert.equal(limits["MYM"], 10);
    assert.equal(limits["RTY"], 1);
    assert.equal(limits["M2K"], 10);
  });

  it("maxParentEquivalent=2 → NQ=2, MNQ=20", () => {
    const limits = effectiveSupportedRawLimits(2);
    assert.equal(limits["NQ"],  2);
    assert.equal(limits["MNQ"], 20);
  });

  it("only includes supportedForMiniEquivalent=true roots (not GC, CL, BTC, etc.)", () => {
    const limits = effectiveSupportedRawLimits(1);
    assert.ok(!("GC"  in limits), "GC should not be in supported limits");
    assert.ok(!("MGC" in limits), "MGC should not be in supported limits");
    assert.ok(!("CL"  in limits), "CL should not be in supported limits");
    assert.ok(!("BTC" in limits), "BTC should not be in supported limits");
  });
});

// ── 9. Registry integrity ─────────────────────────────────────────────────────

describe("registry integrity", () => {
  it("all 8 CME equity index roots are in the registry", () => {
    const required = ["NQ", "MNQ", "ES", "MES", "YM", "MYM", "RTY", "M2K"];
    for (const root of required) {
      assert.ok(getContractMetadata(root) !== null, `${root} must be in registry`);
    }
  });

  it("all 8 CME equity index roots have supportedForMiniEquivalent=true", () => {
    const equityRoots = ["NQ", "MNQ", "ES", "MES", "YM", "MYM", "RTY", "M2K"];
    for (const root of equityRoots) {
      const meta = getContractMetadata(root)!;
      assert.ok(
        meta.supportedForMiniEquivalent,
        `${root} must have supportedForMiniEquivalent=true`,
      );
    }
  });

  it("micro roots have exposureRatioToParent < 1", () => {
    const micros = ["MNQ", "MES", "MYM", "M2K", "MGC", "MCL", "MBT", "MET", "SIL"];
    for (const root of micros) {
      const meta = getContractMetadata(root);
      if (!meta) continue; // skip if not in registry
      assert.ok(
        meta.exposureRatioToParent < 1,
        `${root} is a micro so exposureRatioToParent must be < 1`,
      );
    }
  });

  it("every entry in the registry has a valid parentRoot pointing to a registered root", () => {
    for (const contract of getAllContracts()) {
      assert.ok(
        getContractMetadata(contract.parentRoot) !== null,
        `${contract.symbolRoot}.parentRoot="${contract.parentRoot}" must be in registry`,
      );
    }
  });

  it("getSupportedRoots returns only supportedForMiniEquivalent=true roots", () => {
    const supported = getSupportedRoots();
    for (const root of supported) {
      const meta = getContractMetadata(root)!;
      assert.ok(
        meta.supportedForMiniEquivalent,
        `getSupportedRoots returned ${root} which has supportedForMiniEquivalent=false`,
      );
    }
  });

  it("non-equity roots have supportedForMiniEquivalent=false (GC, CL, BTC)", () => {
    const nonEquity = ["GC", "MGC", "CL", "MCL", "BTC", "MBT", "ETH", "MET", "SI", "SIL"];
    for (const root of nonEquity) {
      const meta = getContractMetadata(root);
      if (!meta) continue;
      assert.equal(
        meta.supportedForMiniEquivalent,
        false,
        `${root} should have supportedForMiniEquivalent=false until exchange specs are verified`,
      );
    }
  });

  it("contracts with the same parent have consistent sizeClass ordering", () => {
    // For each parent group, there should be exactly one "mini" or "standard" root
    // that is the canonical parent (parentRoot === symbolRoot).
    const allContracts = getAllContracts();
    const parentContracts = allContracts.filter((c) => c.parentRoot === c.symbolRoot);
    for (const parent of parentContracts) {
      assert.ok(
        parent.exposureRatioToParent === 1,
        `Parent contract ${parent.symbolRoot} must have exposureRatioToParent=1`,
      );
    }
  });
});
