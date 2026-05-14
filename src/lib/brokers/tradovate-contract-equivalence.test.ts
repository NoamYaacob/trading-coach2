/**
 * Unit tests for tradovate-contract-equivalence.ts
 *
 * These are pure-function tests — no network, no DB, no real credentials.
 *
 * Coverage:
 *  1. getMiniEquivalentMultiplier — known and unknown roots
 *  2. toRawContractLimit — NQ, MNQ, ES, MES, mixed; integer safety
 *  3. isSupportedSymbolRoot — positive and negative
 *  4. getSupportedSymbolRoots — completeness smoke test
 *  5. effectiveRawLimits — shape and values
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getMiniEquivalentMultiplier,
  toRawContractLimit,
  isSupportedSymbolRoot,
  getSupportedSymbolRoots,
  effectiveRawLimits,
} from "./tradovate-contract-equivalence.ts";

// ── 1. getMiniEquivalentMultiplier ───────────────────────────────────────────

describe("getMiniEquivalentMultiplier", () => {
  it("NQ is 1 mini-equivalent per contract", () => {
    assert.equal(getMiniEquivalentMultiplier("NQ"), 1);
  });

  it("MNQ is 0.1 mini-equivalent per contract", () => {
    assert.equal(getMiniEquivalentMultiplier("MNQ"), 0.1);
  });

  it("ES is 1 mini-equivalent per contract", () => {
    assert.equal(getMiniEquivalentMultiplier("ES"), 1);
  });

  it("MES is 0.1 mini-equivalent per contract", () => {
    assert.equal(getMiniEquivalentMultiplier("MES"), 0.1);
  });

  it("YM is 1 mini-equivalent per contract", () => {
    assert.equal(getMiniEquivalentMultiplier("YM"), 1);
  });

  it("MYM is 0.1 mini-equivalent per contract", () => {
    assert.equal(getMiniEquivalentMultiplier("MYM"), 0.1);
  });

  it("RTY is 1 mini-equivalent per contract", () => {
    assert.equal(getMiniEquivalentMultiplier("RTY"), 1);
  });

  it("M2K is 0.1 mini-equivalent per contract", () => {
    assert.equal(getMiniEquivalentMultiplier("M2K"), 0.1);
  });

  it("unknown root falls back to 1.0 (safe default — never understates exposure)", () => {
    assert.equal(getMiniEquivalentMultiplier("AAPL"), 1);
    assert.equal(getMiniEquivalentMultiplier(""), 1);
    assert.equal(getMiniEquivalentMultiplier("CL"), 1); // outside the equity-index scope
  });

  it("lookup is case-insensitive", () => {
    assert.equal(getMiniEquivalentMultiplier("mnq"), 0.1);
    assert.equal(getMiniEquivalentMultiplier("nq"),  1);
    assert.equal(getMiniEquivalentMultiplier("Mes"), 0.1);
  });
});

// ── 2. toRawContractLimit ────────────────────────────────────────────────────

describe("toRawContractLimit: NQ (1 mini = 1 contract)", () => {
  it("maxMiniEquivalent=1 → NQ raw limit = 1", () => {
    assert.equal(toRawContractLimit(1, "NQ"), 1);
  });

  it("maxMiniEquivalent=2 → NQ raw limit = 2", () => {
    assert.equal(toRawContractLimit(2, "NQ"), 2);
  });

  it("maxMiniEquivalent=5 → NQ raw limit = 5", () => {
    assert.equal(toRawContractLimit(5, "NQ"), 5);
  });
});

describe("toRawContractLimit: MNQ (0.1 mini = 1 contract, so 1 mini = 10 contracts)", () => {
  it("maxMiniEquivalent=1 → MNQ raw limit = 10", () => {
    assert.equal(toRawContractLimit(1, "MNQ"), 10);
  });

  it("maxMiniEquivalent=2 → MNQ raw limit = 20", () => {
    assert.equal(toRawContractLimit(2, "MNQ"), 20);
  });

  it("maxMiniEquivalent=3 → MNQ raw limit = 30", () => {
    assert.equal(toRawContractLimit(3, "MNQ"), 30);
  });
});

describe("toRawContractLimit: ES and MES", () => {
  it("maxMiniEquivalent=1 → ES raw limit = 1", () => {
    assert.equal(toRawContractLimit(1, "ES"), 1);
  });

  it("maxMiniEquivalent=1 → MES raw limit = 10", () => {
    assert.equal(toRawContractLimit(1, "MES"), 10);
  });

  it("maxMiniEquivalent=2 → MES raw limit = 20", () => {
    assert.equal(toRawContractLimit(2, "MES"), 20);
  });
});

describe("toRawContractLimit: YM/MYM and RTY/M2K", () => {
  it("maxMiniEquivalent=1 → YM raw limit = 1", () => {
    assert.equal(toRawContractLimit(1, "YM"), 1);
  });

  it("maxMiniEquivalent=1 → MYM raw limit = 10", () => {
    assert.equal(toRawContractLimit(1, "MYM"), 10);
  });

  it("maxMiniEquivalent=1 → RTY raw limit = 1", () => {
    assert.equal(toRawContractLimit(1, "RTY"), 1);
  });

  it("maxMiniEquivalent=1 → M2K raw limit = 10", () => {
    assert.equal(toRawContractLimit(1, "M2K"), 10);
  });
});

describe("toRawContractLimit: unknown roots fall back safely", () => {
  it("unknown root returns maxMiniEquivalent unchanged (1:1 mapping)", () => {
    assert.equal(toRawContractLimit(1, "UNKNOWN"), 1);
    assert.equal(toRawContractLimit(5, "UNKNOWN"), 5);
  });

  it("unknown root does not overstate broker-side enforcement", () => {
    // Returning the raw value (not scaled up) is the conservative choice —
    // it does not claim the broker enforces more than it actually does.
    assert.equal(toRawContractLimit(2, "CL"), 2);
  });

  it("case-insensitive: 'mnq' maps to 10 same as 'MNQ'", () => {
    assert.equal(toRawContractLimit(1, "mnq"), 10);
  });
});

describe("toRawContractLimit: integer arithmetic safety", () => {
  it("11 × 0.1 MNQ does not drift below 11 due to IEEE-754", () => {
    // 11 * 0.1 = 1.1000000000000001 in floating-point; tenths arithmetic must
    // not miscompute this to 10 raw contracts when the answer should be 11.
    // Note: toRawContractLimit expects the limit (maxMiniEquivalent), not position count.
    // 1.1 mini → MNQ = ceil(1.1 * 10 / 1) = ceil(11) = 11.
    assert.equal(toRawContractLimit(1.1, "MNQ"), 11);
  });

  it("0.5 mini-equivalent → MNQ raw limit = ceil(5) = 5", () => {
    assert.equal(toRawContractLimit(0.5, "MNQ"), 5);
  });
});

// ── 3. isSupportedSymbolRoot ─────────────────────────────────────────────────

describe("isSupportedSymbolRoot", () => {
  it("returns true for NQ, MNQ, ES, MES, YM, MYM, RTY, M2K", () => {
    for (const root of ["NQ", "MNQ", "ES", "MES", "YM", "MYM", "RTY", "M2K"]) {
      assert.ok(isSupportedSymbolRoot(root), `expected ${root} to be supported`);
    }
  });

  it("returns false for unknown roots", () => {
    assert.ok(!isSupportedSymbolRoot("AAPL"));
    assert.ok(!isSupportedSymbolRoot("CL"));
    assert.ok(!isSupportedSymbolRoot(""));
  });

  it("case-insensitive", () => {
    assert.ok(isSupportedSymbolRoot("mnq"));
    assert.ok(isSupportedSymbolRoot("es"));
  });
});

// ── 4. getSupportedSymbolRoots ───────────────────────────────────────────────

describe("getSupportedSymbolRoots", () => {
  it("includes all 8 CME equity index roots", () => {
    const roots = getSupportedSymbolRoots();
    const required = ["NQ", "MNQ", "ES", "MES", "YM", "MYM", "RTY", "M2K"];
    for (const r of required) {
      assert.ok(roots.includes(r), `getSupportedSymbolRoots must include ${r}`);
    }
  });

  it("returns a non-empty array", () => {
    assert.ok(getSupportedSymbolRoots().length > 0);
  });
});

// ── 5. effectiveRawLimits ────────────────────────────────────────────────────

describe("effectiveRawLimits", () => {
  it("maxMiniEquivalent=1 → NQ=1, MNQ=10, ES=1, MES=10", () => {
    const limits = effectiveRawLimits(1);
    assert.equal(limits["NQ"],  1);
    assert.equal(limits["MNQ"], 10);
    assert.equal(limits["ES"],  1);
    assert.equal(limits["MES"], 10);
    assert.equal(limits["YM"],  1);
    assert.equal(limits["MYM"], 10);
    assert.equal(limits["RTY"], 1);
    assert.equal(limits["M2K"], 10);
  });

  it("maxMiniEquivalent=2 → NQ=2, MNQ=20", () => {
    const limits = effectiveRawLimits(2);
    assert.equal(limits["NQ"],  2);
    assert.equal(limits["MNQ"], 20);
    assert.equal(limits["ES"],  2);
    assert.equal(limits["MES"], 20);
  });

  it("returns an entry for every supported root", () => {
    const limits = effectiveRawLimits(1);
    for (const root of getSupportedSymbolRoots()) {
      assert.ok(root in limits, `effectiveRawLimits must include ${root}`);
    }
  });
});
