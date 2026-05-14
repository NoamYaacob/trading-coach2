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
  it("recognizes all CME equity futures", () => {
    for (const s of ["ES", "MES", "NQ", "MNQ", "RTY", "M2K", "NKD", "MBT", "MET"]) {
      assert.ok(getProduct(s), `expected ${s} to be recognized`);
    }
  });

  it("recognizes all CME FX futures", () => {
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

describe("getProduct — specStatus and assetClass", () => {
  it("ES, MES, NQ, MNQ, YM, MYM, RTY, M2K, CL, MCL, GC, MGC have specStatus=known", () => {
    for (const s of ["ES", "MES", "NQ", "MNQ", "YM", "MYM", "RTY", "M2K", "CL", "MCL", "GC", "MGC"]) {
      const p = getProduct(s)!;
      assert.equal(p.specStatus, "known", `${s} should be known`);
      assert.ok(p.spec, `${s} should have spec`);
    }
  });

  it("CME FX futures are recognized_only (no confirmed specs)", () => {
    for (const s of ["6A", "6E", "M6E", "E7"]) {
      const p = getProduct(s)!;
      assert.equal(p.specStatus, "recognized_only", `${s} should be recognized_only`);
      assert.equal(p.spec, undefined, `${s} should not have invented spec`);
    }
  });

  it("CBOT grains are recognized_only (no confirmed specs)", () => {
    const p = getProduct("ZC")!;
    assert.equal(p.specStatus, "recognized_only");
    assert.equal(p.spec, undefined);
  });

  it("every catalog product has assetClass=futures", () => {
    for (const p of Object.values(PRODUCTS)) {
      assert.equal(p.assetClass, "futures", `${p.symbol} should have assetClass=futures`);
    }
  });

  it("does not invent point values for recognized_only symbols", () => {
    for (const p of Object.values(PRODUCTS)) {
      if (p.specStatus === "recognized_only") {
        assert.equal(p.spec, undefined, `${p.symbol} marked recognized_only should not carry a spec`);
      }
    }
  });
});

describe("getProduct — micro/mini relationships", () => {
  it("MES is a micro of ES", () => {
    assert.equal(getProduct("MES")!.microOf, "ES");
  });

  it("MNQ is a micro of NQ", () => {
    assert.equal(getProduct("MNQ")!.microOf, "NQ");
  });

  it("M2K is a micro of RTY", () => {
    assert.equal(getProduct("M2K")!.microOf, "RTY");
  });

  it("MYM is a micro of YM", () => {
    assert.equal(getProduct("MYM")!.microOf, "YM");
  });

  it("MCL is a micro of CL", () => {
    assert.equal(getProduct("MCL")!.microOf, "CL");
  });

  it("MGC is a micro of GC", () => {
    assert.equal(getProduct("MGC")!.microOf, "GC");
  });

  it("M6E is a micro of 6E", () => {
    assert.equal(getProduct("M6E")!.microOf, "6E");
  });

  it("standard contracts have no microOf field", () => {
    assert.equal(getProduct("ES")!.microOf, undefined);
    assert.equal(getProduct("NQ")!.microOf, undefined);
    assert.equal(getProduct("CL")!.microOf, undefined);
    assert.equal(getProduct("GC")!.microOf, undefined);
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

describe("classifySymbol — assetClass detection", () => {
  it("classifies common spot forex pairs as forex", () => {
    assert.equal(classifySymbol("EURUSD").assetClass, "forex");
    assert.equal(classifySymbol("gbpusd").assetClass, "forex");
    assert.equal(classifySymbol("USDJPY").assetClass, "forex");
  });

  it("classifies common stocks", () => {
    assert.equal(classifySymbol("AAPL").assetClass, "stock");
    assert.equal(classifySymbol("tsla").assetClass, "stock");
    assert.equal(classifySymbol("SPY").assetClass, "stock");
  });

  it("classifies common crypto symbols", () => {
    assert.equal(classifySymbol("BTC").assetClass, "crypto");
    assert.equal(classifySymbol("ETH").assetClass, "crypto");
    assert.equal(classifySymbol("BTCUSD").assetClass, "crypto");
  });

  it("returns futures assetClass + product for known catalog entries", () => {
    const r = classifySymbol("nq");
    assert.equal(r.assetClass, "futures");
    assert.equal(r.product?.symbol, "NQ");
  });

  it("returns unknown for arbitrary unknown strings", () => {
    assert.equal(classifySymbol("ABCD").assetClass, "unknown");
    assert.equal(classifySymbol("XYZ").assetClass, "unknown");
    assert.equal(classifySymbol("").assetClass, "unknown");
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
