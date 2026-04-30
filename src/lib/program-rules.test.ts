import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PROGRAM_PROFILE,
  GENERIC_FUTURES_PROFILE,
  TOPSTEP_PROFILE,
  formatTimeOfDayCT,
  getEffectiveCutoffCT,
  getEffectiveSundayOpenCT,
  getProfile,
  isSymbolAllowed,
  toChicagoTime,
} from "./program-rules.ts";
import { getProduct } from "./trading-products.ts";

describe("Topstep profile constants", () => {
  it("hard cutoff is 3:10 PM CT", () => {
    assert.deepEqual(TOPSTEP_PROFILE.hardCutoffCT, { hour: 15, minute: 10 });
  });

  it("resume is 5:00 PM CT", () => {
    assert.deepEqual(TOPSTEP_PROFILE.resumeCT, { hour: 17, minute: 0 });
  });

  it("Sunday open is 5:00 PM CT", () => {
    assert.deepEqual(TOPSTEP_PROFILE.sundayOpenCT, { hour: 17, minute: 0 });
  });

  it("disallows forex_spot, stock, and crypto", () => {
    assert.ok(TOPSTEP_PROFILE.blockedCategories.has("forex_spot"));
    assert.ok(TOPSTEP_PROFILE.blockedCategories.has("stock"));
    assert.ok(TOPSTEP_PROFILE.blockedCategories.has("crypto"));
  });

  it("noSwing is true; blockingMode is warn (not strict yet)", () => {
    assert.equal(TOPSTEP_PROFILE.noSwing, true);
    assert.equal(TOPSTEP_PROFILE.blockingMode, "warn");
  });

  it("allowedSymbols includes all Topstep groups", () => {
    for (const s of ["ES", "MES", "NQ", "MNQ", "6E", "M6E", "ZC", "ZW", "YM", "ZN", "GC", "MGC"]) {
      assert.ok(isSymbolAllowed(TOPSTEP_PROFILE, s), `${s} should be allowed`);
    }
  });

  it("allowedSymbols excludes uncatalogued symbols", () => {
    assert.equal(isSymbolAllowed(TOPSTEP_PROFILE, "AAPL"), false);
    assert.equal(isSymbolAllowed(TOPSTEP_PROFILE, "EURUSD"), false);
  });
});

describe("Generic futures profile", () => {
  it("has no cutoffs and allows any symbol", () => {
    assert.equal(GENERIC_FUTURES_PROFILE.hardCutoffCT, null);
    assert.equal(GENERIC_FUTURES_PROFILE.sundayOpenCT, null);
    assert.equal(isSymbolAllowed(GENERIC_FUTURES_PROFILE, "ES"), true);
    assert.equal(isSymbolAllowed(GENERIC_FUTURES_PROFILE, "RANDOM"), true);
  });

  it("blocks no categories", () => {
    assert.equal(GENERIC_FUTURES_PROFILE.blockedCategories.size, 0);
  });
});

describe("getProfile", () => {
  it("returns the matching profile by id", () => {
    assert.equal(getProfile("topstep_style").id, "topstep_style");
    assert.equal(getProfile("generic_futures").id, "generic_futures");
  });

  it("falls back to default for unknown/null/undefined", () => {
    assert.equal(getProfile(null).id, DEFAULT_PROGRAM_PROFILE);
    assert.equal(getProfile(undefined).id, DEFAULT_PROGRAM_PROFILE);
  });
});

describe("getEffectiveCutoffCT", () => {
  it("returns the program cutoff when product has no early close", () => {
    const es = getProduct("ES");
    assert.deepEqual(getEffectiveCutoffCT(TOPSTEP_PROFILE, es), { hour: 15, minute: 10 });
  });

  it("returns the product early close when earlier than the program cutoff", () => {
    const zc = getProduct("ZC"); // grains close 1:20 PM CT
    assert.deepEqual(getEffectiveCutoffCT(TOPSTEP_PROFILE, zc), { hour: 13, minute: 20 });
  });

  it("returns the product early close for CME livestock (1:05 PM CT)", () => {
    const le = getProduct("LE");
    assert.deepEqual(getEffectiveCutoffCT(TOPSTEP_PROFILE, le), { hour: 13, minute: 5 });
  });

  it("returns null for generic profile + product with no early close", () => {
    const es = getProduct("ES");
    assert.equal(getEffectiveCutoffCT(GENERIC_FUTURES_PROFILE, es), null);
  });

  it("returns the product cutoff alone if profile has no cutoff", () => {
    const zc = getProduct("ZC");
    assert.deepEqual(getEffectiveCutoffCT(GENERIC_FUTURES_PROFILE, zc), { hour: 13, minute: 20 });
  });
});

describe("getEffectiveSundayOpenCT", () => {
  it("returns later of program and product Sunday open", () => {
    const zc = getProduct("ZC"); // 7:00 PM Sunday open
    assert.deepEqual(getEffectiveSundayOpenCT(TOPSTEP_PROFILE, zc), { hour: 19, minute: 0 });
  });

  it("returns program Sunday open for products with no override", () => {
    const es = getProduct("ES");
    assert.deepEqual(getEffectiveSundayOpenCT(TOPSTEP_PROFILE, es), { hour: 17, minute: 0 });
  });
});

describe("toChicagoTime — DST-aware UTC → Central Time conversion", () => {
  it("Monday 2026-04-27 at 20:09 UTC → 3:09 PM CT (CDT, UTC-5)", () => {
    const ct = toChicagoTime(new Date("2026-04-27T20:09:00Z"));
    assert.equal(ct.weekday, 1);
    assert.equal(ct.hour, 15);
    assert.equal(ct.minute, 9);
  });

  it("Monday 2026-04-27 at 22:01 UTC → 5:01 PM CT (after resume)", () => {
    const ct = toChicagoTime(new Date("2026-04-27T22:01:00Z"));
    assert.equal(ct.hour, 17);
    assert.equal(ct.minute, 1);
  });

  it("Sunday 2026-04-26 at 21:00 UTC → 4:00 PM CT (before Sunday open)", () => {
    const ct = toChicagoTime(new Date("2026-04-26T21:00:00Z"));
    assert.equal(ct.weekday, 0);
    assert.equal(ct.hour, 16);
  });

  it("Saturday 2026-04-25 at 18:00 UTC → 1:00 PM CT", () => {
    const ct = toChicagoTime(new Date("2026-04-25T18:00:00Z"));
    assert.equal(ct.weekday, 6);
  });

  it("Winter date uses CST (UTC-6): 2026-01-13 at 21:09 UTC → 3:09 PM CT", () => {
    const ct = toChicagoTime(new Date("2026-01-13T21:09:00Z"));
    assert.equal(ct.hour, 15);
    assert.equal(ct.minute, 9);
  });
});

describe("formatTimeOfDayCT — trader-friendly labels", () => {
  it("formats 3:10 PM as '3:10 PM CT'", () => {
    assert.equal(formatTimeOfDayCT({ hour: 15, minute: 10 }), "3:10 PM CT");
  });

  it("formats 5:00 PM as '5:00 PM CT'", () => {
    assert.equal(formatTimeOfDayCT({ hour: 17, minute: 0 }), "5:00 PM CT");
  });

  it("formats 8:30 AM as '8:30 AM CT'", () => {
    assert.equal(formatTimeOfDayCT({ hour: 8, minute: 30 }), "8:30 AM CT");
  });

  it("formats midnight as '12:00 AM CT'", () => {
    assert.equal(formatTimeOfDayCT({ hour: 0, minute: 0 }), "12:00 AM CT");
  });

  it("formats noon as '12:00 PM CT'", () => {
    assert.equal(formatTimeOfDayCT({ hour: 12, minute: 0 }), "12:00 PM CT");
  });
});
