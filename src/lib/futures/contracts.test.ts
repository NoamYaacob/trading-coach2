/**
 * Unit tests for src/lib/futures/contracts.ts
 *
 * No network, no DB, no real credentials required.
 *
 * Coverage:
 *  1. normalizeSymbolRoot — known/unknown roots, month/year suffixes, FX, EUREX
 *  2. getContractMetadata — lookup and null cases
 *  3. getParentContract — parent resolution
 *  4. getExposureRatioToParent — standard/mini/micro ratios
 *  5. toParentEquivalentContracts — conversion and IEEE-754 safety
 *  6. toRawContractLimit — NQ/MNQ/ES/MES, floor semantics, minimum 1, non-0.1 ratios
 *  7. comparePositionToLimit — allowed/breach with reason
 *  8. effectiveSupportedRawLimits — shape and values
 *  9. Registry integrity — parentRoot validity, ratio ordering, Apex coverage
 * 10. Apex equivalency model — 10 micro = 1 standard; 11 MNQ breaches limit
 * 11. All Apex-listed instruments present in registry
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

describe("normalizeSymbolRoot — equity index", () => {
  it("bare roots pass through unchanged", () => {
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

  it("all 12 CME month codes are recognised as suffixes on NQ", () => {
    const months = ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"];
    for (const m of months) {
      assert.equal(normalizeSymbolRoot(`NQ${m}6`), "NQ", `NQ${m}6 should normalise to NQ`);
    }
  });
});

describe("normalizeSymbolRoot — FX (digit-prefixed roots)", () => {
  it("6A bare root unchanged", () => {
    assert.equal(normalizeSymbolRoot("6A"), "6A");
  });

  it("6AH26 → 6A", () => {
    assert.equal(normalizeSymbolRoot("6AH26"), "6A");
  });

  it("6EH6 → 6E", () => {
    assert.equal(normalizeSymbolRoot("6EH6"), "6E");
  });

  it("M6AH6 → M6A (micro AUD)", () => {
    assert.equal(normalizeSymbolRoot("M6AH6"), "M6A");
  });

  it("M6EZ26 → M6E (micro EUR)", () => {
    assert.equal(normalizeSymbolRoot("M6EZ26"), "M6E");
  });
});

describe("normalizeSymbolRoot — EUREX", () => {
  it("FDAX bare root unchanged", () => {
    assert.equal(normalizeSymbolRoot("FDAX"), "FDAX");
  });

  it("FDAXH6 → FDAX", () => {
    assert.equal(normalizeSymbolRoot("FDAXH6"), "FDAX");
  });

  it("FDXMZ26 → FDXM", () => {
    assert.equal(normalizeSymbolRoot("FDXMZ26"), "FDXM");
  });

  it("FGBLH6 → FGBL", () => {
    assert.equal(normalizeSymbolRoot("FGBLH6"), "FGBL");
  });
});

describe("normalizeSymbolRoot — CBOT grain (Z-prefixed, Z is also Dec month code)", () => {
  it("ZCZ6 → ZC (Corn, Dec expiry)", () => {
    assert.equal(normalizeSymbolRoot("ZCZ6"), "ZC");
  });

  it("ZWH26 → ZW (Wheat, Mar expiry)", () => {
    assert.equal(normalizeSymbolRoot("ZWH26"), "ZW");
  });

  it("ZMM6 → ZM (Soybean Meal, Jun expiry)", () => {
    assert.equal(normalizeSymbolRoot("ZMM6"), "ZM");
  });
});

describe("normalizeSymbolRoot — misc", () => {
  it("is case-insensitive", () => {
    assert.equal(normalizeSymbolRoot("mnqm6"), "MNQ");
    assert.equal(normalizeSymbolRoot("nqz26"), "NQ");
  });

  it("strips leading/trailing whitespace", () => {
    assert.equal(normalizeSymbolRoot("  NQM6  "), "NQ");
  });

  it("unknown root is returned uppercased", () => {
    assert.equal(normalizeSymbolRoot("AAPL"), "AAPL");
  });
});

// ── 2. getContractMetadata ────────────────────────────────────────────────────

describe("getContractMetadata", () => {
  it("returns metadata for known root NQ", () => {
    const meta = getContractMetadata("NQ");
    assert.ok(meta !== null);
    assert.equal(meta!.symbolRoot, "NQ");
    assert.equal(meta!.displayName, "E-mini NASDAQ 100");
    assert.equal(meta!.exchange, "CME");
    assert.equal(meta!.assetClass, "equity_index");
    assert.equal(meta!.sizeClass, "standard");
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

  it("FVS (VSTOXX) has assetClass=volatility", () => {
    const meta = getContractMetadata("FVS");
    assert.ok(meta !== null);
    assert.equal(meta!.assetClass, "volatility");
    assert.equal(meta!.exchange, "EUREX");
  });

  it("MBT is self-referential (parentRoot=MBT) and standalone", () => {
    const meta = getContractMetadata("MBT");
    assert.ok(meta !== null);
    assert.equal(meta!.parentRoot, "MBT");
    assert.equal(meta!.exposureRatioToParent, 1);
    assert.equal(meta!.supportedForMiniEquivalent, false);
  });

  it("MET is self-referential (parentRoot=MET) and standalone", () => {
    const meta = getContractMetadata("MET");
    assert.ok(meta !== null);
    assert.equal(meta!.parentRoot, "MET");
    assert.equal(meta!.exposureRatioToParent, 1);
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

  it("NQ parent is NQ (self-referential)", () => {
    const parent = getParentContract("NQ");
    assert.equal(parent!.symbolRoot, "NQ");
  });

  it("returns null for unknown root", () => {
    assert.equal(getParentContract("UNKNOWN"), null);
  });

  it("MBT parent is MBT (self-referential standalone crypto)", () => {
    const parent = getParentContract("MBT");
    assert.equal(parent!.symbolRoot, "MBT");
  });

  it("FDXM parent is FDAX", () => {
    const parent = getParentContract("FDXM");
    assert.equal(parent!.symbolRoot, "FDAX");
  });

  it("FDXS parent is FDAX", () => {
    const parent = getParentContract("FDXS");
    assert.equal(parent!.symbolRoot, "FDAX");
  });

  it("QM parent is CL", () => {
    const parent = getParentContract("QM");
    assert.equal(parent!.symbolRoot, "CL");
  });

  it("QG parent is NG", () => {
    const parent = getParentContract("QG");
    assert.equal(parent!.symbolRoot, "NG");
  });

  it("M6A parent is 6A", () => {
    const parent = getParentContract("M6A");
    assert.equal(parent!.symbolRoot, "6A");
  });
});

// ── 4. getExposureRatioToParent ───────────────────────────────────────────────

describe("getExposureRatioToParent — CME equity index (Apex 10-micro = 1-standard model)", () => {
  it("NQ is 1.0", () => { assert.equal(getExposureRatioToParent("NQ"), 1); });
  it("MNQ is 0.1", () => { assert.equal(getExposureRatioToParent("MNQ"), 0.1); });
  it("ES is 1.0", () => { assert.equal(getExposureRatioToParent("ES"), 1); });
  it("MES is 0.1", () => { assert.equal(getExposureRatioToParent("MES"), 0.1); });
  it("YM is 1.0 and MYM is 0.1", () => {
    assert.equal(getExposureRatioToParent("YM"),  1);
    assert.equal(getExposureRatioToParent("MYM"), 0.1);
  });
  it("RTY is 1.0 and M2K is 0.1", () => {
    assert.equal(getExposureRatioToParent("RTY"), 1);
    assert.equal(getExposureRatioToParent("M2K"), 0.1);
  });
});

describe("getExposureRatioToParent — non-0.1 ratios", () => {
  it("SIL (E-Micro Silver) is 0.001 per Apex instruments list", () => {
    assert.equal(getExposureRatioToParent("SIL"), 0.001);
  });

  it("FDXM (Mini-DAX) is 0.2 (€5/pt vs FDAX €25/pt)", () => {
    assert.equal(getExposureRatioToParent("FDXM"), 0.2);
  });

  it("FDXS (Micro-DAX) is 0.04 (€1/pt vs FDAX €25/pt)", () => {
    assert.equal(getExposureRatioToParent("FDXS"), 0.04);
  });

  it("QM (Mini Crude Oil) is 0.5 (500 bbl vs CL 1000 bbl)", () => {
    assert.equal(getExposureRatioToParent("QM"), 0.5);
  });

  it("QG (E-mini Natural Gas) is 0.25 (2500 mmBtu vs NG 10000 mmBtu)", () => {
    assert.equal(getExposureRatioToParent("QG"), 0.25);
  });

  it("FSXE (Micro Euro Stoxx 50) is 0.1", () => {
    assert.equal(getExposureRatioToParent("FSXE"), 0.1);
  });

  it("M6A (Micro AUD/USD) is 0.1", () => {
    assert.equal(getExposureRatioToParent("M6A"), 0.1);
  });

  it("M6E (Micro EUR/USD) is 0.1", () => {
    assert.equal(getExposureRatioToParent("M6E"), 0.1);
  });

  it("MBT (standalone crypto) is 1.0", () => {
    assert.equal(getExposureRatioToParent("MBT"), 1);
  });

  it("unknown root falls back to 1.0 (safe — never understates exposure)", () => {
    assert.equal(getExposureRatioToParent("AAPL"), 1);
    assert.equal(getExposureRatioToParent(""), 1);
  });
});

// ── 5. toParentEquivalentContracts ────────────────────────────────────────────

describe("toParentEquivalentContracts", () => {
  it("10 MNQ = 1 NQ-equivalent (Apex: 10 micro = 1 standard)", () => {
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

  it("10 MYM = 1 YM-equivalent", () => {
    assert.equal(toParentEquivalentContracts(10, "MYM"), 1);
  });

  it("10 M2K = 1 RTY-equivalent", () => {
    assert.equal(toParentEquivalentContracts(10, "M2K"), 1);
  });

  it("uses absolute value (short positions counted as exposure)", () => {
    assert.equal(toParentEquivalentContracts(-10, "MNQ"), 1);
  });

  it("IEEE-754 safety: 11 × 0.1 does not drift (integer-thousandths arithmetic)", () => {
    // 11 * 0.1 in IEEE-754 = 1.1000000000000001; thousandths: 11 * 100 / 1000 = 1.1 exactly
    assert.equal(toParentEquivalentContracts(11, "MNQ"), 1.1);
  });

  it("5 FDXM = 1 FDAX-equivalent (ratio 0.2)", () => {
    assert.equal(toParentEquivalentContracts(5, "FDXM"), 1);
  });

  it("2 QM = 1 CL-equivalent (ratio 0.5)", () => {
    assert.equal(toParentEquivalentContracts(2, "QM"), 1);
  });

  it("4 QG = 1 NG-equivalent (ratio 0.25)", () => {
    assert.equal(toParentEquivalentContracts(4, "QG"), 1);
  });

  it("1000 SIL = 1 SI-equivalent (ratio 0.001)", () => {
    assert.equal(toParentEquivalentContracts(1000, "SIL"), 1);
  });

  it("25 FDXS = 1 FDAX-equivalent (ratio 0.04)", () => {
    assert.equal(toParentEquivalentContracts(25, "FDXS"), 1);
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

describe("toRawContractLimit: MNQ (0.1 ratio — Apex: 10 micro = 1 standard)", () => {
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

describe("toRawContractLimit: non-0.1 ratios", () => {
  it("SIL (0.001): maxParentEquivalent=1 → 1000 raw", () => {
    assert.equal(toRawContractLimit(1, "SIL"), 1000);
  });

  it("FDXM (0.2): maxParentEquivalent=1 → 5 raw", () => {
    assert.equal(toRawContractLimit(1, "FDXM"), 5);
  });

  it("FDXS (0.04): maxParentEquivalent=1 → 25 raw", () => {
    assert.equal(toRawContractLimit(1, "FDXS"), 25);
  });

  it("QM (0.5): maxParentEquivalent=1 → 2 raw", () => {
    assert.equal(toRawContractLimit(1, "QM"), 2);
  });

  it("QG (0.25): maxParentEquivalent=1 → 4 raw", () => {
    assert.equal(toRawContractLimit(1, "QG"), 4);
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

  it("10 MES vs maxParentEquivalent=1 → allowed", () => {
    const r = comparePositionToLimit(10, "MES", 1);
    assert.equal(r.allowed, true);
    assert.equal(r.parentEquivalentQty, 1);
    assert.equal(r.rawLimitForSymbol, 10);
  });

  it("10 MYM vs maxParentEquivalent=1 → allowed", () => {
    const r = comparePositionToLimit(10, "MYM", 1);
    assert.equal(r.allowed, true);
    assert.equal(r.parentEquivalentQty, 1);
  });

  it("10 M2K vs maxParentEquivalent=1 → allowed", () => {
    const r = comparePositionToLimit(10, "M2K", 1);
    assert.equal(r.allowed, true);
    assert.equal(r.parentEquivalentQty, 1);
  });

  it("reason string mentions the root and parent-equivalent qty", () => {
    const r = comparePositionToLimit(2, "MNQ", 1);
    assert.match(r.reason, /MNQ/);
    assert.match(r.reason, /0\.2/);
  });
});

// ── 8. effectiveSupportedRawLimits ───────────────────────────────────────────

describe("effectiveSupportedRawLimits", () => {
  it("maxParentEquivalent=1 → correct limits for all 8 CME equity index roots", () => {
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

  it("only includes supportedForMiniEquivalent=true roots", () => {
    const limits = effectiveSupportedRawLimits(1);
    const excluded = ["GC", "MGC", "CL", "MCL", "MBT", "MET", "SI", "SIL",
                      "FDAX", "FDXM", "6A", "ZC", "NG", "HG"];
    for (const root of excluded) {
      assert.ok(!(root in limits), `${root} should not appear in supported limits`);
    }
  });
});

// ── 9. Registry integrity ─────────────────────────────────────────────────────

describe("registry integrity", () => {
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

  it("micro roots (ratio < 1) include new non-0.1 entries", () => {
    const micros: Record<string, number> = {
      MNQ: 0.1, MES: 0.1, MYM: 0.1, M2K: 0.1,
      MGC: 0.1, MCL: 0.1, M6A: 0.1, M6E: 0.1,
      SIL: 0.001, FDXM: 0.2, FDXS: 0.04, QM: 0.5, QG: 0.25, FSXE: 0.1,
    };
    for (const [root, expectedRatio] of Object.entries(micros)) {
      const meta = getContractMetadata(root);
      if (!meta) continue;
      assert.ok(
        meta.exposureRatioToParent < 1,
        `${root} is a sub-standard contract so exposureRatioToParent must be < 1`,
      );
      assert.equal(
        meta.exposureRatioToParent,
        expectedRatio,
        `${root} ratio should be ${expectedRatio}`,
      );
    }
  });

  it("every entry has a valid parentRoot pointing to a registered root", () => {
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

  it("parent contracts (parentRoot === symbolRoot) all have exposureRatioToParent=1", () => {
    for (const contract of getAllContracts()) {
      if (contract.parentRoot === contract.symbolRoot) {
        assert.equal(
          contract.exposureRatioToParent,
          1,
          `Parent contract ${contract.symbolRoot} must have exposureRatioToParent=1`,
        );
      }
    }
  });

  it("non-equity / non-verified roots have supportedForMiniEquivalent=false", () => {
    const nonSupported = [
      "GC", "MGC", "SI", "SIL", "CL", "MCL", "MBT", "MET",
      "FDAX", "FDXM", "FDXS", "FESX", "FSXE", "6A", "6E", "ZC",
    ];
    for (const root of nonSupported) {
      const meta = getContractMetadata(root);
      if (!meta) continue;
      assert.equal(
        meta.supportedForMiniEquivalent,
        false,
        `${root} should have supportedForMiniEquivalent=false`,
      );
    }
  });
});

// ── 10. Apex equivalency model ────────────────────────────────────────────────

describe("Apex position-sizing model: 10 micro = 1 standard", () => {
  const pairs: [string, string][] = [
    ["ES", "MES"],
    ["NQ", "MNQ"],
    ["YM", "MYM"],
    ["RTY", "M2K"],
  ];

  for (const [standard, micro] of pairs) {
    it(`${standard} limit=1 allows 10 ${micro} (not 11)`, () => {
      assert.equal(toRawContractLimit(1, standard), 1, `${standard} raw limit`);
      assert.equal(toRawContractLimit(1, micro),    10, `${micro} raw limit`);
      assert.equal(comparePositionToLimit(10, micro, 1).allowed, true,  `10 ${micro} allowed`);
      assert.equal(comparePositionToLimit(11, micro, 1).allowed, false, `11 ${micro} breaches`);
    });
  }

  it("11 MNQ breaches a maxParentEquivalent=1 limit (1.1 > 1)", () => {
    const r = comparePositionToLimit(11, "MNQ", 1);
    assert.equal(r.allowed, false);
    assert.equal(r.parentEquivalentQty, 1.1);
    assert.match(r.reason, /exceeds/i);
  });

  it("unknown symbol falls back to 1:1 (never understates exposure)", () => {
    // An unknown symbol has ratio=1 so 2 contracts = 2 equivalents, breaches limit of 1
    const r = comparePositionToLimit(2, "UNKNOWN_SYMBOL", 1);
    assert.equal(r.allowed, false);
    assert.equal(r.parentEquivalentQty, 2);
  });
});

// ── 11. Apex-listed instruments present in registry ───────────────────────────

describe("Apex instruments: equity index futures", () => {
  const roots = ["ES", "NQ", "YM", "EMD", "RTY", "NKD"];
  for (const root of roots) {
    it(`${root} is in registry`, () => {
      assert.ok(getContractMetadata(root) !== null, `${root} must be in registry`);
    });
  }
});

describe("Apex instruments: micro equity index futures", () => {
  const roots = ["MES", "MNQ", "MYM", "M2K"];
  for (const root of roots) {
    it(`${root} is in registry with ratio 0.1`, () => {
      const meta = getContractMetadata(root);
      assert.ok(meta !== null, `${root} must be in registry`);
      assert.equal(meta!.exposureRatioToParent, 0.1);
    });
  }
});

describe("Apex instruments: FX futures", () => {
  const roots = ["6A", "6B", "6C", "6E", "6J", "6S", "6N"];
  for (const root of roots) {
    it(`${root} is in registry`, () => {
      const meta = getContractMetadata(root);
      assert.ok(meta !== null, `${root} must be in registry`);
      assert.equal(meta!.assetClass, "fx");
    });
  }
});

describe("Apex instruments: micro FX futures", () => {
  it("M6A (E-Micro AUD/USD) is in registry", () => {
    const meta = getContractMetadata("M6A");
    assert.ok(meta !== null);
    assert.equal(meta!.parentRoot, "6A");
    assert.equal(meta!.exposureRatioToParent, 0.1);
  });

  it("M6E (E-Micro EUR/USD) is in registry", () => {
    const meta = getContractMetadata("M6E");
    assert.ok(meta !== null);
    assert.equal(meta!.parentRoot, "6E");
    assert.equal(meta!.exposureRatioToParent, 0.1);
  });
});

describe("Apex instruments: agricultural futures", () => {
  const roots = ["HE", "LE", "GF", "ZC", "ZW", "ZS", "ZM", "ZL"];
  for (const root of roots) {
    it(`${root} is in registry`, () => {
      const meta = getContractMetadata(root);
      assert.ok(meta !== null, `${root} must be in registry`);
      assert.equal(meta!.assetClass, "agriculture");
    });
  }
});

describe("Apex instruments: energy futures", () => {
  it("CL (Crude Oil) is in registry", () => {
    assert.ok(getContractMetadata("CL") !== null);
  });
  it("MCL (Micro Crude Oil) has ratio 0.1", () => {
    assert.equal(getExposureRatioToParent("MCL"), 0.1);
  });
  it("QM (Mini Crude Oil) has ratio 0.5 and parent CL", () => {
    const meta = getContractMetadata("QM");
    assert.ok(meta !== null);
    assert.equal(meta!.exposureRatioToParent, 0.5);
    assert.equal(meta!.parentRoot, "CL");
  });
  it("NG (Natural Gas) is in registry", () => {
    assert.ok(getContractMetadata("NG") !== null);
  });
  it("QG (E-mini Natural Gas) has ratio 0.25 and parent NG", () => {
    const meta = getContractMetadata("QG");
    assert.ok(meta !== null);
    assert.equal(meta!.exposureRatioToParent, 0.25);
    assert.equal(meta!.parentRoot, "NG");
  });
  it("HO (Heating Oil) is in registry", () => {
    assert.ok(getContractMetadata("HO") !== null);
  });
  it("RB (RBOB Gasoline) is in registry", () => {
    assert.ok(getContractMetadata("RB") !== null);
  });
});

describe("Apex instruments: metal futures", () => {
  const roots = ["GC", "MGC", "SI", "SIL", "HG", "PL", "PA"];
  for (const root of roots) {
    it(`${root} is in registry`, () => {
      const meta = getContractMetadata(root);
      assert.ok(meta !== null, `${root} must be in registry`);
      assert.equal(meta!.assetClass, "metals");
    });
  }
});

describe("Apex instruments: EUREX equity index futures", () => {
  it("FDAX (DAX) is in registry", () => {
    const meta = getContractMetadata("FDAX");
    assert.ok(meta !== null);
    assert.equal(meta!.exchange, "EUREX");
    assert.equal(meta!.sizeClass, "standard");
  });
  it("FDXM (Mini-DAX) has ratio 0.2 and parent FDAX", () => {
    const meta = getContractMetadata("FDXM");
    assert.ok(meta !== null);
    assert.equal(meta!.exposureRatioToParent, 0.2);
    assert.equal(meta!.parentRoot, "FDAX");
  });
  it("FDXS (Micro-DAX) has ratio 0.04 and parent FDAX", () => {
    const meta = getContractMetadata("FDXS");
    assert.ok(meta !== null);
    assert.equal(meta!.exposureRatioToParent, 0.04);
    assert.equal(meta!.parentRoot, "FDAX");
  });
  it("FESX (Euro Stoxx 50) is in registry", () => {
    assert.ok(getContractMetadata("FESX") !== null);
  });
  it("FSXE (Micro Euro Stoxx 50) has ratio 0.1", () => {
    assert.equal(getExposureRatioToParent("FSXE"), 0.1);
  });
  it("FVS (VSTOXX) has assetClass=volatility", () => {
    const meta = getContractMetadata("FVS");
    assert.ok(meta !== null);
    assert.equal(meta!.assetClass, "volatility");
  });
  it("FXXP (STOXX Europe 600) is in registry", () => {
    assert.ok(getContractMetadata("FXXP") !== null);
  });
});

describe("Apex instruments: EUREX rates futures", () => {
  const roots = ["FGBX", "FGBS", "FGBM", "FGBL"];
  for (const root of roots) {
    it(`${root} is in registry`, () => {
      const meta = getContractMetadata(root);
      assert.ok(meta !== null, `${root} must be in registry`);
      assert.equal(meta!.assetClass, "rates");
      assert.equal(meta!.exchange, "EUREX");
    });
  }
});

describe("Apex instruments: crypto futures (MBT, MET only — no full BTC/ETH)", () => {
  it("MBT is in registry as standalone (no full Bitcoin parent)", () => {
    const meta = getContractMetadata("MBT");
    assert.ok(meta !== null);
    assert.equal(meta!.parentRoot, "MBT");
    assert.equal(meta!.exposureRatioToParent, 1);
  });

  it("MET is in registry as standalone (no full Ether parent)", () => {
    const meta = getContractMetadata("MET");
    assert.ok(meta !== null);
    assert.equal(meta!.parentRoot, "MET");
    assert.equal(meta!.exposureRatioToParent, 1);
  });

  it("full-size BTC futures are NOT in the registry (not on Apex)", () => {
    assert.equal(getContractMetadata("BTC"), null);
  });

  it("full-size ETH futures are NOT in the registry (not on Apex)", () => {
    assert.equal(getContractMetadata("ETH"), null);
  });
});

// ── Phase 4: newly added registry entries ────────────────────────────────────

describe("Phase 4 registry additions — FX micros", () => {
  const FX_MICROS: Array<[string, string]> = [
    ["M6B", "6B"],
    ["M6J", "6J"],
    ["M6C", "6C"],
    ["M6S", "6S"],
  ];

  for (const [micro, parent] of FX_MICROS) {
    it(`${micro} is in the registry with parentRoot ${parent} and ratio 0.1`, () => {
      const meta = getContractMetadata(micro);
      assert.ok(meta !== null, `${micro} must be in the registry`);
      assert.equal(meta!.symbolRoot, micro);
      assert.equal(meta!.parentRoot, parent);
      assert.equal(meta!.exposureRatioToParent, 0.1);
      assert.equal(meta!.exchange, "CME");
      assert.equal(meta!.assetClass, "fx");
      assert.equal(meta!.sizeClass, "micro");
      // FX micros are not part of the verified Apex equity-index 10:1 set.
      assert.equal(meta!.supportedForMiniEquivalent, false);
    });

    it(`${micro} parent ${parent} exists in the registry`, () => {
      assert.ok(getContractMetadata(parent) !== null, `${parent} must be in the registry`);
    });
  }

  it("M6B converts 10 raw contracts to 1.0 6B-equivalent", () => {
    assert.equal(toParentEquivalentContracts(10, "M6B"), 1.0);
  });
});

describe("Phase 4 registry additions — U.S. Treasury futures", () => {
  const TREASURIES: Array<[string, number]> = [
    ["ZB", 1000],
    ["UB", 1000],
    ["ZN", 1000],
    ["ZF", 1000],
    ["ZT", 2000],
  ];

  for (const [root, pointValue] of TREASURIES) {
    it(`${root} is in the registry as a standalone CBOT rates product`, () => {
      const meta = getContractMetadata(root);
      assert.ok(meta !== null, `${root} must be in the registry`);
      assert.equal(meta!.symbolRoot, root);
      assert.equal(meta!.parentRoot, root, `${root} must be self-referential (no micro pairing)`);
      assert.equal(meta!.exposureRatioToParent, 1);
      assert.equal(meta!.exchange, "CBOT");
      assert.equal(meta!.assetClass, "rates");
      assert.equal(meta!.sizeClass, "standard");
      assert.equal(meta!.pointValueUsd, pointValue);
      assert.equal(meta!.supportedForMiniEquivalent, false);
    });
  }
});

describe("Phase 4 registry additions — KC Wheat", () => {
  it("KE is in the registry as a CBOT agriculture product", () => {
    const meta = getContractMetadata("KE");
    assert.ok(meta !== null, "KE must be in the registry");
    assert.equal(meta!.symbolRoot, "KE");
    assert.equal(meta!.parentRoot, "KE");
    assert.equal(meta!.exposureRatioToParent, 1);
    assert.equal(meta!.exchange, "CBOT");
    assert.equal(meta!.assetClass, "agriculture");
    assert.equal(meta!.sizeClass, "standard");
  });
});

describe("Phase 4 — existing micro/mini conversions still correct", () => {
  it("10 MNQ = 1 NQ-equivalent (unchanged)", () => {
    assert.equal(toParentEquivalentContracts(10, "MNQ"), 1.0);
  });

  it("10 MES = 1 ES-equivalent (unchanged)", () => {
    assert.equal(toParentEquivalentContracts(10, "MES"), 1.0);
  });

  it("10 MYM = 1 YM-equivalent (unchanged)", () => {
    assert.equal(toParentEquivalentContracts(10, "MYM"), 1.0);
  });

  it("10 M2K = 1 RTY-equivalent (unchanged)", () => {
    assert.equal(toParentEquivalentContracts(10, "M2K"), 1.0);
  });

  it("2 QM = 1 CL-equivalent (unchanged)", () => {
    assert.equal(toParentEquivalentContracts(2, "QM"), 1.0);
  });
});

describe("Phase 4 — SIL exposureRatioToParent (PENDING VERIFICATION)", () => {
  // The registry currently records SIL exposureRatioToParent = 0.001, derived
  // from the Apex instruments list (pointValue 5 vs SI 5000). This value is
  // suspected to be inconsistent with the CME E-micro Silver contract spec
  // (1,000 oz vs SI 5,000 oz → ratio 0.2). It was NOT changed in Phase A
  // because it could not be verified. SIL is excluded from the v1 symbol
  // picker until the ratio is confirmed. This test pins the current value so
  // any future change is a deliberate, reviewed decision.
  it("SIL ratio is still 0.001 — change only after CME-spec verification", () => {
    const meta = getContractMetadata("SIL");
    assert.ok(meta !== null);
    assert.equal(meta!.exposureRatioToParent, 0.001);
  });
});
