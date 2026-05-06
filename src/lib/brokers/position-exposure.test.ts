/**
 * Unit tests for position-exposure helper.
 *
 * Pure-function tests — no network, no DB, no broker client.
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computeMiniEquivalentExposure,
  isMaxPositionSizeBreached,
} from "./position-exposure.ts";

describe("computeMiniEquivalentExposure — required cases from product spec", () => {
  it("2 NQ = 2 mini-equivalent", () => {
    const r = computeMiniEquivalentExposure([{ symbol: "NQH6", netPos: 2 }]);
    assert.equal(r.totalMiniEquivalent, 2);
    assert.equal(r.unsupported.length, 0);
  });

  it("20 MNQ = 2 mini-equivalent", () => {
    const r = computeMiniEquivalentExposure([{ symbol: "MNQH6", netPos: 20 }]);
    assert.equal(r.totalMiniEquivalent, 2);
  });

  it("21 MNQ = 2.1 mini-equivalent", () => {
    const r = computeMiniEquivalentExposure([{ symbol: "MNQH6", netPos: 21 }]);
    assert.equal(r.totalMiniEquivalent, 2.1);
  });

  it("1 NQ + 10 MNQ = 2 mini-equivalent", () => {
    const r = computeMiniEquivalentExposure([
      { symbol: "NQH6", netPos: 1 },
      { symbol: "MNQH6", netPos: 10 },
    ]);
    assert.equal(r.totalMiniEquivalent, 2);
  });

  it("1 NQ + 11 MNQ = 2.1 mini-equivalent", () => {
    const r = computeMiniEquivalentExposure([
      { symbol: "NQH6", netPos: 1 },
      { symbol: "MNQH6", netPos: 11 },
    ]);
    assert.equal(r.totalMiniEquivalent, 2.1);
  });

  it("2 ES + 5 MES = 2.5 mini-equivalent", () => {
    const r = computeMiniEquivalentExposure([
      { symbol: "ESH6", netPos: 2 },
      { symbol: "MESH6", netPos: 5 },
    ]);
    assert.equal(r.totalMiniEquivalent, 2.5);
  });
});

describe("computeMiniEquivalentExposure — sign / magnitude semantics", () => {
  it("short positions use abs(netPos)", () => {
    const r = computeMiniEquivalentExposure([
      { symbol: "NQH6", netPos: -2 },
      { symbol: "MNQH6", netPos: -5 },
    ]);
    assert.equal(r.totalMiniEquivalent, 2.5);
  });

  it("long and short on the same root are both counted as exposure (no netting across rows)", () => {
    // If broker ever reports two rows for the same root with opposite
    // sign, we treat them as risk on both sides — abs(row.netPos)
    // applied per row, then summed.
    const r = computeMiniEquivalentExposure([
      { symbol: "NQH6", netPos: 1 },
      { symbol: "NQM6", netPos: -1 },
    ]);
    assert.equal(r.totalMiniEquivalent, 2);
  });
});

describe("computeMiniEquivalentExposure — grouping", () => {
  it("mixed roots are grouped separately", () => {
    const r = computeMiniEquivalentExposure([
      { symbol: "NQH6", netPos: 1 },
      { symbol: "ESH6", netPos: 1 },
      { symbol: "MNQH6", netPos: 5 },
    ]);
    assert.equal(r.totalMiniEquivalent, 2.5);
    assert.equal(r.byRoot.length, 2);
    const nq = r.byRoot.find((b) => b.root === "NQ");
    const es = r.byRoot.find((b) => b.root === "ES");
    assert.equal(nq?.totalMiniEquivalent, 1.5);
    assert.equal(es?.totalMiniEquivalent, 1);
  });

  it("M2K (RTY micro) groups under RTY", () => {
    const r = computeMiniEquivalentExposure([
      { symbol: "RTYH6", netPos: 1 },
      { symbol: "M2KH6", netPos: 5 },
    ]);
    assert.equal(r.totalMiniEquivalent, 1.5);
    assert.equal(r.byRoot.length, 1);
    assert.equal(r.byRoot[0].root, "RTY");
  });

  it("multiple rows in the same root preserve per-row data", () => {
    const r = computeMiniEquivalentExposure([
      { symbol: "MNQH6", netPos: 3 },
      { symbol: "MNQM6", netPos: 4 },
    ]);
    assert.equal(r.totalMiniEquivalent, 0.7);
    assert.equal(r.byRoot.length, 1);
    assert.equal(r.byRoot[0].positions.length, 2);
  });
});

describe("computeMiniEquivalentExposure — symbol parsing edge cases", () => {
  it("recognizes plain root with no month code", () => {
    const r = computeMiniEquivalentExposure([{ symbol: "NQ", netPos: 2 }]);
    assert.equal(r.totalMiniEquivalent, 2);
  });

  it("is case-insensitive", () => {
    const r = computeMiniEquivalentExposure([{ symbol: "mnqh6", netPos: 10 }]);
    assert.equal(r.totalMiniEquivalent, 1);
  });

  it("MNQ does NOT match as NQ (longest-prefix wins)", () => {
    // Regression guard: if extractRoot used shortest-first matching,
    // 1 MNQ would be misread as 1 NQ = 1.0 mini-equivalent.
    const r = computeMiniEquivalentExposure([{ symbol: "MNQH6", netPos: 1 }]);
    assert.equal(r.totalMiniEquivalent, 0.1);
  });
});

describe("computeMiniEquivalentExposure — unsupported handling", () => {
  it("unknown symbol goes to unsupported and is NOT silently absorbed", () => {
    const r = computeMiniEquivalentExposure([{ symbol: "6EH6", netPos: 1 }]);
    assert.equal(r.totalMiniEquivalent, 0);
    assert.equal(r.unsupported.length, 1);
    assert.equal(r.unsupported[0].symbol, "6EH6");
    assert.equal(r.unsupported[0].netPos, 1);
    assert.match(r.unsupported[0].reason, /unknown root/i);
  });

  it("unsupported symbols do not pollute byRoot", () => {
    const r = computeMiniEquivalentExposure([
      { symbol: "NQH6", netPos: 1 },
      { symbol: "6EH6", netPos: 5 },
    ]);
    assert.equal(r.totalMiniEquivalent, 1);
    assert.equal(r.byRoot.length, 1);
    assert.equal(r.byRoot[0].root, "NQ");
    assert.equal(r.unsupported.length, 1);
  });
});

describe("computeMiniEquivalentExposure — empty / zero handling", () => {
  it("no positions returns total 0", () => {
    const r = computeMiniEquivalentExposure([]);
    assert.equal(r.totalMiniEquivalent, 0);
    assert.equal(r.byRoot.length, 0);
    assert.equal(r.unsupported.length, 0);
  });

  it("zero netPos is ignored (documented choice)", () => {
    const r = computeMiniEquivalentExposure([
      { symbol: "NQH6", netPos: 0 },
      { symbol: "MNQH6", netPos: 5 },
    ]);
    assert.equal(r.totalMiniEquivalent, 0.5);
    assert.equal(r.byRoot.length, 1);
    assert.equal(r.byRoot[0].positions.length, 1);
  });
});

describe("computeMiniEquivalentExposure — decimal precision", () => {
  it("11 MNQ produces a stable 1.1 (no floating-point trail)", () => {
    const r = computeMiniEquivalentExposure([{ symbol: "MNQH6", netPos: 11 }]);
    assert.equal(r.totalMiniEquivalent, 1.1);
  });

  it("sum across multiple micro positions is stable for threshold compare", () => {
    // 7 MNQ + 3 MES + 1 MYM = 11 micros = 1.1 mini-equivalent
    const r = computeMiniEquivalentExposure([
      { symbol: "MNQH6", netPos: 7 },
      { symbol: "MESH6", netPos: 3 },
      { symbol: "MYMH6", netPos: 1 },
    ]);
    assert.equal(r.totalMiniEquivalent, 1.1);
  });
});

describe("isMaxPositionSizeBreached", () => {
  it("equal does NOT breach", () => {
    assert.equal(isMaxPositionSizeBreached(2, 2), false);
  });

  it("one tenth above breaches", () => {
    assert.equal(isMaxPositionSizeBreached(2.1, 2), true);
  });

  it("below does not breach", () => {
    assert.equal(isMaxPositionSizeBreached(1.9, 2), false);
  });

  it("null limit never breaches", () => {
    assert.equal(isMaxPositionSizeBreached(100, null), false);
  });

  it("zero limit + zero exposure does not breach", () => {
    assert.equal(isMaxPositionSizeBreached(0, 0), false);
  });

  it("zero limit + any exposure breaches", () => {
    assert.equal(isMaxPositionSizeBreached(0.1, 0), true);
  });

  it("negative limit is treated as no rule (never breaches)", () => {
    assert.equal(isMaxPositionSizeBreached(100, -1), false);
  });

  it("neutralizes IEEE-754 drift at the boundary", () => {
    // 11 * 0.1 === 1.1000000000000001 in JS; a naive `>` compare
    // would falsely breach a limit of 1.1. The helper uses integer
    // tenths internally, so this must NOT breach.
    const drifted = 11 * 0.1;
    assert.equal(isMaxPositionSizeBreached(drifted, 1.1), false);
  });

  it("breaches at boundary + 1 tenth even after drift", () => {
    const drifted = 11 * 0.1; // 1.1...001
    assert.equal(isMaxPositionSizeBreached(drifted, 1.0), true);
  });
});

describe("integration: helper output feeds breach helper end-to-end", () => {
  it("1 NQ + 11 MNQ vs limit=2 → breach", () => {
    const r = computeMiniEquivalentExposure([
      { symbol: "NQH6", netPos: 1 },
      { symbol: "MNQH6", netPos: 11 },
    ]);
    assert.equal(isMaxPositionSizeBreached(r.totalMiniEquivalent, 2), true);
  });

  it("1 NQ + 10 MNQ vs limit=2 → no breach", () => {
    const r = computeMiniEquivalentExposure([
      { symbol: "NQH6", netPos: 1 },
      { symbol: "MNQH6", netPos: 10 },
    ]);
    assert.equal(isMaxPositionSizeBreached(r.totalMiniEquivalent, 2), false);
  });

  it("21 MNQ vs limit=2 → breach", () => {
    const r = computeMiniEquivalentExposure([{ symbol: "MNQH6", netPos: 21 }]);
    assert.equal(isMaxPositionSizeBreached(r.totalMiniEquivalent, 2), true);
  });

  it("3 NQ vs limit=2 → breach", () => {
    const r = computeMiniEquivalentExposure([{ symbol: "NQH6", netPos: 3 }]);
    assert.equal(isMaxPositionSizeBreached(r.totalMiniEquivalent, 2), true);
  });
});
