import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  PRODUCTS,
  classifySymbol,
  getProduct,
  listAllowedSymbols,
  listSymbolsByGroup,
  normalizeSymbol,
} from "./trading-products.ts";

describe("normalizeSymbol", () => {
  it("trims and uppercases", () => {
    assert.equal(normalizeSymbol("  es  "), "ES");
    assert.equal(normalizeSymbol("nq"), "NQ");
    assert.equal(normalizeSymbol("6e"), "6E");
  });

  it("returns empty string for whitespace-only", () => {
    assert.equal(normalizeSymbol(""), "");
    assert.equal(normalizeSymbol("   "), "");
  });
});

describe("getProduct — Topstep-allowed symbols", () => {
  it("recognizes all CME equity futures from Topstep", () => {
    for (const s of ["ES", "MES", "NQ", "MNQ", "RTY", "M2K", "NKD", "MBT", "MET"]) {
      assert.ok(getProduct(s), `expected ${s} to be recognized`);
    }
  });

  it("recognizes all CME FX futures from Topstep", () => {
    for (const s of ["6A", "6B", "6C", "6E", "6J", "6S", "E7", "M6E", "M6A", "6M", "6N", "M6B"]) {
      assert.ok(getProduct(s), `expected ${s} to be recognized`);
    }
  });

  it("recognizes CME agriculture (livestock)", () => {
    assert.ok(getProduct("HE"));
    assert.ok(getProduct("LE"));
  });

  it("recognizes NYMEX energy/metals", () => {
    for (const s of ["CL", "QM", "NG", "QG", "MCL", "RB", "HO", "PL", "MNG"]) {
      assert.ok(getProduct(s), `expected ${s} to be recognized`);
    }
  });

  it("recognizes CBOT agriculture (grains)", () => {
    for (const s of ["ZC", "ZW", "ZS", "ZM", "ZL"]) {
      assert.ok(getProduct(s), `expected ${s} to be recognized`);
    }
  });

  it("recognizes CBOT equity", () => {
    assert.ok(getProduct("YM"));
    assert.ok(getProduct("MYM"));
  });

  it("recognizes CBOT rates", () => {
    for (const s of ["ZT", "ZF", "ZN", "TN", "ZB", "UB"]) {
      assert.ok(getProduct(s), `expected ${s} to be recognized`);
    }
  });

  it("recognizes COMEX metals", () => {
    for (const s of ["GC", "SI", "HG", "MGC", "SIL", "MHG"]) {
      assert.ok(getProduct(s), `expected ${s} to be recognized`);
    }
  });
});

describe("getProduct — known specs vs allowed_unknown_specs", () => {
  it("ES, MES, NQ, MNQ, YM, MYM, RTY, M2K, CL, MCL, GC, MGC have known specs", () => {
    for (const s of ["ES", "MES", "NQ", "MNQ", "YM", "MYM", "RTY", "M2K", "CL", "MCL", "GC", "MGC"]) {
      const p = getProduct(s)!;
      assert.equal(p.specStatus, "known", `${s} should be known`);
      assert.ok(p.spec, `${s} should have spec`);
    }
  });

  it("CME FX futures are recognized but spec-uncertain", () => {
    for (const s of ["6A", "6E", "M6E", "E7"]) {
      const p = getProduct(s)!;
      assert.equal(p.specStatus, "allowed_unknown_specs", `${s} should be allowed_unknown_specs`);
      assert.equal(p.spec, undefined, `${s} should not have invented spec`);
    }
  });

  it("CBOT grains are recognized but spec-uncertain", () => {
    const p = getProduct("ZC")!;
    assert.equal(p.specStatus, "allowed_unknown_specs");
    assert.equal(p.spec, undefined);
  });

  it("does not invent point values for uncertain symbols", () => {
    for (const p of Object.values(PRODUCTS)) {
      if (p.specStatus === "allowed_unknown_specs") {
        assert.equal(p.spec, undefined, `${p.symbol} marked unknown should not carry a spec`);
      }
    }
  });
});

describe("getProduct — early close metadata", () => {
  it("CBOT grains carry 1:20 PM CT close and 7:00 PM Sunday open", () => {
    const zc = getProduct("ZC")!;
    assert.deepEqual(zc.earlyCloseCT, { hour: 13, minute: 20 });
    assert.deepEqual(zc.sundayOpenCT, { hour: 19, minute: 0 });
  });

  it("CME livestock carry 1:05 PM CT close and 8:30 AM open (no overnight)", () => {
    const le = getProduct("LE")!;
    assert.deepEqual(le.earlyCloseCT, { hour: 13, minute: 5 });
    assert.deepEqual(le.daytimeOpenCT, { hour: 8, minute: 30 });
    assert.equal(le.sundayOpenCT, undefined);
  });

  it("standard equity futures have no early close override", () => {
    const es = getProduct("ES")!;
    assert.equal(es.earlyCloseCT, undefined);
    assert.equal(es.sundayOpenCT, undefined);
  });
});

describe("classifySymbol — non-futures detection", () => {
  it("classifies common spot forex pairs", () => {
    assert.equal(classifySymbol("EURUSD").category, "forex_spot");
    assert.equal(classifySymbol("gbpusd").category, "forex_spot");
    assert.equal(classifySymbol("USDJPY").category, "forex_spot");
  });

  it("classifies common stocks", () => {
    assert.equal(classifySymbol("AAPL").category, "stock");
    assert.equal(classifySymbol("tsla").category, "stock");
    assert.equal(classifySymbol("SPY").category, "stock");
  });

  it("classifies common crypto symbols", () => {
    assert.equal(classifySymbol("BTC").category, "crypto");
    assert.equal(classifySymbol("ETH").category, "crypto");
    assert.equal(classifySymbol("BTCUSD").category, "crypto");
  });

  it("returns futures + product for known catalog entries", () => {
    const r = classifySymbol("nq");
    assert.equal(r.category, "futures");
    assert.equal(r.product?.symbol, "NQ");
  });

  it("returns unknown for arbitrary unknown strings", () => {
    assert.equal(classifySymbol("ABCD").category, "unknown");
    assert.equal(classifySymbol("XYZ").category, "unknown");
    assert.equal(classifySymbol("").category, "unknown");
  });
});

describe("listAllowedSymbols / listSymbolsByGroup", () => {
  it("listAllowedSymbols covers every group", () => {
    const all = listAllowedSymbols();
    assert.ok(all.includes("ES"));
    assert.ok(all.includes("6E"));
    assert.ok(all.includes("ZC"));
    assert.ok(all.includes("YM"));
    assert.ok(all.includes("ZT"));
    assert.ok(all.includes("GC"));
  });

  it("listSymbolsByGroup filters by exchange/group", () => {
    const cmeEq = listSymbolsByGroup("cme-equity");
    assert.ok(cmeEq.includes("ES"));
    assert.ok(cmeEq.includes("NQ"));
    assert.ok(!cmeEq.includes("ZC"));
    const cbotAg = listSymbolsByGroup("cbot-ag");
    assert.deepEqual(cbotAg.sort(), ["ZC", "ZL", "ZM", "ZS", "ZW"]);
  });
});
