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
  deriveMaxPositionSizeBreach,
} from "./position-exposure.ts";
import { MAX_POSITION_SIZE_COPY } from "../../app/rules/_components/position-size-copy.ts";

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
    const r = computeMiniEquivalentExposure([{ symbol: "AAPL", netPos: 1 }]);
    assert.equal(r.totalMiniEquivalent, 0);
    assert.equal(r.unsupported.length, 1);
    assert.equal(r.unsupported[0].symbol, "AAPL");
    assert.equal(r.unsupported[0].netPos, 1);
    assert.match(r.unsupported[0].reason, /registry/i);
  });

  it("unsupported symbols do not pollute byRoot", () => {
    const r = computeMiniEquivalentExposure([
      { symbol: "NQH6", netPos: 1 },
      { symbol: "AAPL", netPos: 5 },
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

describe("deriveMaxPositionSizeBreach — required scenarios from product spec", () => {
  it("2 NQ with maxContracts=2 does NOT trigger", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "NQH6", netPos: 2 }],
      maxContracts: 2,
    });
    assert.equal(d.shouldTrigger, false);
    assert.equal(d.reasonKind, null);
    assert.equal(d.totalMiniEquivalent, 2);
  });

  it("20 MNQ with maxContracts=2 does NOT trigger", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "MNQH6", netPos: 20 }],
      maxContracts: 2,
    });
    assert.equal(d.shouldTrigger, false);
    assert.equal(d.totalMiniEquivalent, 2);
  });

  it("1 NQ + 10 MNQ with maxContracts=2 does NOT trigger", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [
        { symbol: "NQH6", netPos: 1 },
        { symbol: "MNQH6", netPos: 10 },
      ],
      maxContracts: 2,
    });
    assert.equal(d.shouldTrigger, false);
    assert.equal(d.totalMiniEquivalent, 2);
  });

  it("21 MNQ with maxContracts=2 triggers max_position_size", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "MNQH6", netPos: 21 }],
      maxContracts: 2,
    });
    assert.equal(d.shouldTrigger, true);
    assert.equal(d.reasonKind, "exposure");
    assert.equal(d.totalMiniEquivalent, 2.1);
    assert.match(d.reason ?? "", /Max position size exceeded/);
    assert.match(d.reason ?? "", /2\.1/);
    assert.match(d.reason ?? "", /limit: 2/);
  });

  it("3 NQ with maxContracts=2 triggers max_position_size", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "NQH6", netPos: 3 }],
      maxContracts: 2,
    });
    assert.equal(d.shouldTrigger, true);
    assert.equal(d.reasonKind, "exposure");
    assert.equal(d.totalMiniEquivalent, 3);
  });

  it("1 NQ + 11 MNQ with maxContracts=2 triggers max_position_size", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [
        { symbol: "NQH6", netPos: 1 },
        { symbol: "MNQH6", netPos: 11 },
      ],
      maxContracts: 2,
    });
    assert.equal(d.shouldTrigger, true);
    assert.equal(d.reasonKind, "exposure");
    assert.equal(d.totalMiniEquivalent, 2.1);
  });
});

describe("deriveMaxPositionSizeBreach — boundary semantics", () => {
  it("exact equality does not trigger (totalMiniEquivalent === maxContracts)", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "NQH6", netPos: 2 }],
      maxContracts: 2,
    });
    assert.equal(d.shouldTrigger, false);
  });

  it("one decimal above triggers (e.g. 2.1 vs 2)", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "MNQH6", netPos: 21 }],
      maxContracts: 2,
    });
    assert.equal(d.shouldTrigger, true);
  });

  it("IEEE-754 drift at boundary does not falsely trigger", () => {
    // 11 micros = 1.1 mini-equivalent, limit = 1.1
    // 11 * 0.1 in floating point produces 1.1000000000000001 — must not breach.
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "MNQH6", netPos: 11 }],
      maxContracts: 1.1,
    });
    assert.equal(d.shouldTrigger, false);
  });
});

describe("deriveMaxPositionSizeBreach — limit configuration", () => {
  it("null maxContracts skips the check (no trigger)", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "NQH6", netPos: 100 }],
      maxContracts: null,
    });
    assert.equal(d.shouldTrigger, false);
    assert.equal(d.totalMiniEquivalent, 0);
  });

  it("zero maxContracts skips the check (treated as unconfigured)", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "NQH6", netPos: 1 }],
      maxContracts: 0,
    });
    assert.equal(d.shouldTrigger, false);
  });

  it("negative maxContracts skips the check", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "NQH6", netPos: 1 }],
      maxContracts: -1,
    });
    assert.equal(d.shouldTrigger, false);
  });

  it("no positions returns no trigger even with limit set", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [],
      maxContracts: 2,
    });
    assert.equal(d.shouldTrigger, false);
    assert.equal(d.totalMiniEquivalent, 0);
  });
});

describe("deriveMaxPositionSizeBreach — unsupported policy", () => {
  it("unsupported symbol triggers with reasonKind=unsupported (NOT silently ignored)", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "AAPL", netPos: 1 }],
      maxContracts: 2,
    });
    assert.equal(d.shouldTrigger, true);
    assert.equal(d.reasonKind, "unsupported");
    assert.equal(d.hasUnsupportedPositions, true);
    assert.deepEqual(d.unsupportedSymbols, ["AAPL"]);
    assert.match(d.reason ?? "", /unsupported symbol/i);
  });

  it("unsupported symbol does NOT trigger when limit is null (no rule configured)", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "AAPL", netPos: 1 }],
      maxContracts: null,
    });
    assert.equal(d.shouldTrigger, false);
  });

  it("unsupported takes precedence over exposure when both could fire", () => {
    // 21 MNQ would breach by exposure, but the unknown symbol breach
    // is reported first (Guardrail honestly cannot verify).
    const d = deriveMaxPositionSizeBreach({
      positions: [
        { symbol: "MNQH6", netPos: 21 },
        { symbol: "AAPL", netPos: 1 },
      ],
      maxContracts: 2,
    });
    assert.equal(d.shouldTrigger, true);
    assert.equal(d.reasonKind, "unsupported");
  });

  it("supported positions alone (within limit) do not trigger even with no unsupported", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "NQH6", netPos: 1 }],
      maxContracts: 2,
    });
    assert.equal(d.shouldTrigger, false);
    assert.equal(d.hasUnsupportedPositions, false);
  });
});

describe("deriveMaxPositionSizeBreach — selection of effective limit (sync responsibility)", () => {
  // The pure helper takes a single maxContracts. Sync resolves
  // `accountRules?.maxContracts ?? defaultRules?.maxContracts ?? null`
  // before calling. These tests verify the helper accepts both override
  // and inherited values transparently.
  it("account-specific value overrides default (sync passes 3 instead of 5)", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "NQH6", netPos: 4 }],
      maxContracts: 3, // would be inherited as 5; account override = 3
    });
    assert.equal(d.shouldTrigger, true);
  });

  it("default applies when account override is null (sync passes default)", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "NQH6", netPos: 4 }],
      maxContracts: 5,
    });
    assert.equal(d.shouldTrigger, false);
  });
});

describe("deriveMaxPositionSizeBreach — generic limits (1, 3, 10)", () => {
  // maxContracts = 1
  it("maxContracts=1: 1 NQ (1.0 mini-equivalent) does not breach", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "NQH6", netPos: 1 }],
      maxContracts: 1,
    });
    assert.equal(d.shouldTrigger, false);
    assert.equal(d.totalMiniEquivalent, 1);
  });

  it("maxContracts=1: 10 MNQ (1.0 mini-equivalent) does not breach", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "MNQH6", netPos: 10 }],
      maxContracts: 1,
    });
    assert.equal(d.shouldTrigger, false);
    assert.equal(d.totalMiniEquivalent, 1);
  });

  it("maxContracts=1: 11 MNQ (1.1 mini-equivalent) breaches", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "MNQH6", netPos: 11 }],
      maxContracts: 1,
    });
    assert.equal(d.shouldTrigger, true);
    assert.equal(d.reasonKind, "exposure");
    assert.equal(d.totalMiniEquivalent, 1.1);
  });

  it("maxContracts=1: 2 NQ (2.0 mini-equivalent) breaches", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "NQH6", netPos: 2 }],
      maxContracts: 1,
    });
    assert.equal(d.shouldTrigger, true);
    assert.equal(d.totalMiniEquivalent, 2);
  });

  // maxContracts = 3
  it("maxContracts=3: 3 NQ (3.0 mini-equivalent) does not breach", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "NQH6", netPos: 3 }],
      maxContracts: 3,
    });
    assert.equal(d.shouldTrigger, false);
    assert.equal(d.totalMiniEquivalent, 3);
  });

  it("maxContracts=3: 30 MNQ (3.0 mini-equivalent) does not breach", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "MNQH6", netPos: 30 }],
      maxContracts: 3,
    });
    assert.equal(d.shouldTrigger, false);
    assert.equal(d.totalMiniEquivalent, 3);
  });

  it("maxContracts=3: 31 MNQ (3.1 mini-equivalent) breaches", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "MNQH6", netPos: 31 }],
      maxContracts: 3,
    });
    assert.equal(d.shouldTrigger, true);
    assert.equal(d.reasonKind, "exposure");
    assert.equal(d.totalMiniEquivalent, 3.1);
  });

  // maxContracts = 10
  it("maxContracts=10: 10 NQ (10.0 mini-equivalent) does not breach", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "NQH6", netPos: 10 }],
      maxContracts: 10,
    });
    assert.equal(d.shouldTrigger, false);
    assert.equal(d.totalMiniEquivalent, 10);
  });

  it("maxContracts=10: 100 MNQ (10.0 mini-equivalent) does not breach", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "MNQH6", netPos: 100 }],
      maxContracts: 10,
    });
    assert.equal(d.shouldTrigger, false);
    assert.equal(d.totalMiniEquivalent, 10);
  });

  it("maxContracts=10: 101 MNQ (10.1 mini-equivalent) breaches", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "MNQH6", netPos: 101 }],
      maxContracts: 10,
    });
    assert.equal(d.shouldTrigger, true);
    assert.equal(d.reasonKind, "exposure");
    assert.equal(d.totalMiniEquivalent, 10.1);
  });
});

describe("isMaxPositionSizeBreached — sub-tenth precision", () => {
  it("2.1 (one micro above 2-mini limit) triggers", () => {
    // 21 MNQ = 2.1 mini-equivalent. This is the minimum realizable breach
    // above a limit of 2 since positions are whole contracts (1 micro = 0.1 mini).
    assert.equal(isMaxPositionSizeBreached(2.1, 2), true);
  });

  it("sub-tenth float 2.0001 rounds to nearest milli — does not falsely trigger at limit 2", () => {
    // Positions are whole contracts; the minimum real increment is 0.1 (one micro).
    // A sub-tenth value like 2.0001 is not achievable from positions and rounds to
    // 2000 millis in the integer-millis system, so it correctly does not breach.
    assert.equal(isMaxPositionSizeBreached(2.0001, 2), false);
  });
});

describe("UI copy — MAX_POSITION_SIZE_COPY", () => {
  it("label is 'Max standard-equivalent contracts' (Apex prop-firm framing)", () => {
    assert.equal(MAX_POSITION_SIZE_COPY.label, "Max standard-equivalent contracts");
    assert.ok(MAX_POSITION_SIZE_COPY.label.includes("standard-equivalent"));
  });

  it("hint explains the Apex 1 NQ = 10 MNQ rule", () => {
    assert.match(MAX_POSITION_SIZE_COPY.hint, /1 NQ equal 10 MNQ/i);
    assert.match(MAX_POSITION_SIZE_COPY.hint, /standard/i);
  });

  it("hint does not imply fractional tradable contracts", () => {
    // The hint must not describe fractional contract sizes (e.g. '0.5 NQ', 'half a
    // contract', 'fractional') — actual trades are always placed as whole contracts.
    assert.ok(!MAX_POSITION_SIZE_COPY.hint.includes("fractional"));
    assert.ok(!MAX_POSITION_SIZE_COPY.hint.match(/\d+\.\d+ NQ/));
    assert.ok(!MAX_POSITION_SIZE_COPY.hint.match(/\d+\.\d+ ES/));
    assert.ok(!MAX_POSITION_SIZE_COPY.hint.match(/\d+\.\d+ MNQ/));
  });
});

describe("deriveMaxPositionSizeBreach — all four Apex equity-index pairs at max=1", () => {
  // NQ/MNQ already covered in the "generic limits" block; this block adds MES, MYM, M2K
  // and verifies 6E is recognised as a supported (non-unsupported) registry entry.

  it("maxContracts=1: 10 MES (1.0 standard-equivalent) does not breach", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "MESH6", netPos: 10 }],
      maxContracts: 1,
    });
    assert.equal(d.shouldTrigger, false);
    assert.equal(d.totalMiniEquivalent, 1);
    assert.equal(d.hasUnsupportedPositions, false);
  });

  it("maxContracts=1: 11 MES (1.1 standard-equivalent) breaches", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "MESH6", netPos: 11 }],
      maxContracts: 1,
    });
    assert.equal(d.shouldTrigger, true);
    assert.equal(d.reasonKind, "exposure");
    assert.equal(d.totalMiniEquivalent, 1.1);
  });

  it("maxContracts=1: 10 MYM (1.0 standard-equivalent) does not breach", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "MYMH6", netPos: 10 }],
      maxContracts: 1,
    });
    assert.equal(d.shouldTrigger, false);
    assert.equal(d.totalMiniEquivalent, 1);
  });

  it("maxContracts=1: 11 MYM (1.1 standard-equivalent) breaches", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "MYMH6", netPos: 11 }],
      maxContracts: 1,
    });
    assert.equal(d.shouldTrigger, true);
    assert.equal(d.reasonKind, "exposure");
    assert.equal(d.totalMiniEquivalent, 1.1);
  });

  it("maxContracts=1: 10 M2K (1.0 RTY-equivalent) does not breach", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "M2KH6", netPos: 10 }],
      maxContracts: 1,
    });
    assert.equal(d.shouldTrigger, false);
    assert.equal(d.totalMiniEquivalent, 1);
    assert.equal(d.hasUnsupportedPositions, false);
  });

  it("maxContracts=1: 11 M2K (1.1 RTY-equivalent) breaches", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "M2KH6", netPos: 11 }],
      maxContracts: 1,
    });
    assert.equal(d.shouldTrigger, true);
    assert.equal(d.reasonKind, "exposure");
    assert.equal(d.totalMiniEquivalent, 1.1);
  });

  it("maxContracts=1: 1 6E (1.0 standard-equivalent) is recognised from registry and does not breach", () => {
    // 6E (Euro FX) is in the registry with exposureRatioToParent=1; it must NOT be
    // classified as unsupported now that the registry covers all Apex-listed contracts.
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "6EH6", netPos: 1 }],
      maxContracts: 1,
    });
    assert.equal(d.shouldTrigger, false);
    assert.equal(d.hasUnsupportedPositions, false);
    assert.equal(d.totalMiniEquivalent, 1);
  });

  it("maxContracts=1: 2 6E (2.0 standard-equivalent) breaches", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "6EH6", netPos: 2 }],
      maxContracts: 1,
    });
    assert.equal(d.shouldTrigger, true);
    assert.equal(d.reasonKind, "exposure");
    assert.equal(d.totalMiniEquivalent, 2);
    assert.equal(d.hasUnsupportedPositions, false);
  });

  it("AAPL (not a futures root) is unsupported — safe fallback, does NOT claim exact enforcement", () => {
    const d = deriveMaxPositionSizeBreach({
      positions: [{ symbol: "AAPL", netPos: 1 }],
      maxContracts: 1,
    });
    assert.equal(d.shouldTrigger, true);
    assert.equal(d.reasonKind, "unsupported");
    assert.equal(d.hasUnsupportedPositions, true);
    assert.deepEqual(d.unsupportedSymbols, ["AAPL"]);
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
