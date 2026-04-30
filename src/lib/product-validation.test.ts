import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  GENERIC_FUTURES_PROFILE,
  TOPSTEP_PROFILE,
} from "./program-rules.ts";
import {
  describeMarketState,
  getMarketStateAt,
  getSymbolStatus,
  validateSymbolForProgram,
  validateTradeTime,
} from "./product-validation.ts";
import { getProduct } from "./trading-products.ts";

// All UTC timestamps below are picked so the Chicago-time view matches the
// scenario in the test name. April → CDT (UTC-5); January → CST (UTC-6).
const MON_BEFORE_CUTOFF = new Date("2026-04-27T20:09:00Z"); // Mon 3:09 PM CT
const MON_AFTER_CUTOFF  = new Date("2026-04-27T20:11:00Z"); // Mon 3:11 PM CT
const MON_AFTER_RESUME  = new Date("2026-04-27T22:01:00Z"); // Mon 5:01 PM CT
const SUN_BEFORE_OPEN   = new Date("2026-04-26T21:00:00Z"); // Sun 4:00 PM CT
const SUN_AFTER_OPEN    = new Date("2026-04-26T22:01:00Z"); // Sun 5:01 PM CT
const SAT_ANYTIME       = new Date("2026-04-25T18:00:00Z"); // Sat 1:00 PM CT
const FRI_AFTER_RESUME  = new Date("2026-04-24T22:01:00Z"); // Fri 5:01 PM CT
const TUE_GRAIN_LATE    = new Date("2026-04-28T19:00:00Z"); // Tue 2:00 PM CT (after 1:20)
const TUE_GRAIN_EARLY   = new Date("2026-04-28T18:00:00Z"); // Tue 1:00 PM CT (before 1:20)
const TUE_LIVESTOCK_LATE = new Date("2026-04-28T18:30:00Z"); // Tue 1:30 PM CT (after 1:05)

describe("getSymbolStatus", () => {
  it("recognized_with_specs for ES", () => {
    const s = getSymbolStatus("ES");
    assert.equal(s.kind, "recognized_with_specs");
  });

  it("recognized_no_specs for 6E (no invented specs)", () => {
    const s = getSymbolStatus("6E");
    assert.equal(s.kind, "recognized_no_specs");
  });

  it("forex_spot for EURUSD", () => {
    assert.equal(getSymbolStatus("EURUSD").kind, "forex_spot");
  });

  it("stock for AAPL", () => {
    assert.equal(getSymbolStatus("AAPL").kind, "stock");
  });

  it("crypto for BTC", () => {
    assert.equal(getSymbolStatus("BTC").kind, "crypto");
  });

  it("unknown for arbitrary strings", () => {
    assert.equal(getSymbolStatus("ZZZZZ").kind, "unknown");
  });

  it("empty for blank input", () => {
    assert.equal(getSymbolStatus("").kind, "empty");
    assert.equal(getSymbolStatus("   ").kind, "empty");
  });
});

describe("validateSymbolForProgram — Topstep profile", () => {
  it("ES with known specs returns no warnings", () => {
    const w = validateSymbolForProgram("ES", TOPSTEP_PROFILE);
    assert.equal(w.length, 0);
  });

  it("6E with no specs returns a 'specs not added' hint only", () => {
    const w = validateSymbolForProgram("6E", TOPSTEP_PROFILE);
    assert.equal(w.length, 1);
    assert.equal(w[0]?.code, "specs_not_added");
    assert.equal(w[0]?.level, "hint");
  });

  it("EURUSD returns a forex_spot warning", () => {
    const w = validateSymbolForProgram("EURUSD", TOPSTEP_PROFILE);
    assert.equal(w.length, 1);
    assert.equal(w[0]?.code, "forex_spot_not_supported");
    assert.equal(w[0]?.level, "warning");
    assert.match(w[0]!.message, /6E\/M6E/);
  });

  it("AAPL returns a stocks warning", () => {
    const w = validateSymbolForProgram("AAPL", TOPSTEP_PROFILE);
    assert.equal(w[0]?.code, "stocks_not_supported");
    assert.equal(w[0]?.level, "warning");
  });

  it("BTC returns a crypto warning", () => {
    const w = validateSymbolForProgram("BTC", TOPSTEP_PROFILE);
    assert.equal(w[0]?.code, "crypto_not_supported");
  });

  it("unknown symbol returns a generic unknown warning", () => {
    const w = validateSymbolForProgram("ZZZZZ", TOPSTEP_PROFILE);
    assert.equal(w[0]?.code, "unknown_product");
  });

  it("empty input returns no warnings", () => {
    assert.equal(validateSymbolForProgram("", TOPSTEP_PROFILE).length, 0);
  });
});

describe("validateSymbolForProgram — Generic profile", () => {
  it("EURUSD becomes a hint, not a warning", () => {
    const w = validateSymbolForProgram("EURUSD", GENERIC_FUTURES_PROFILE);
    assert.equal(w[0]?.level, "hint");
    assert.equal(w[0]?.code, "forex_spot_not_supported");
  });

  it("ES returns no warnings (no allowedSymbols restriction)", () => {
    const w = validateSymbolForProgram("ES", GENERIC_FUTURES_PROFILE);
    assert.equal(w.length, 0);
  });
});

describe("validateTradeTime — Topstep profile, generic futures product", () => {
  const es = getProduct("ES");

  it("Monday 3:09 PM CT (before cutoff) → no warnings", () => {
    const w = validateTradeTime(MON_BEFORE_CUTOFF, es, TOPSTEP_PROFILE);
    assert.equal(w.length, 0);
  });

  it("Monday 3:11 PM CT (after cutoff, before resume) → after_program_cutoff", () => {
    const w = validateTradeTime(MON_AFTER_CUTOFF, es, TOPSTEP_PROFILE);
    assert.equal(w.length, 1);
    assert.equal(w[0]?.code, "after_program_cutoff");
  });

  it("Monday 5:01 PM CT (post-resume, weekday) → no warning (next session)", () => {
    const w = validateTradeTime(MON_AFTER_RESUME, es, TOPSTEP_PROFILE);
    assert.equal(w.length, 0);
  });

  it("Sunday 4:00 PM CT (before open) → before_sunday_open", () => {
    const w = validateTradeTime(SUN_BEFORE_OPEN, es, TOPSTEP_PROFILE);
    assert.equal(w.length, 1);
    assert.equal(w[0]?.code, "before_sunday_open");
  });

  it("Sunday 5:01 PM CT (after open) → no warning", () => {
    const w = validateTradeTime(SUN_AFTER_OPEN, es, TOPSTEP_PROFILE);
    assert.equal(w.length, 0);
  });

  it("Saturday → outside_program_hours warning", () => {
    const w = validateTradeTime(SAT_ANYTIME, es, TOPSTEP_PROFILE);
    assert.equal(w.length, 1);
    assert.equal(w[0]?.code, "outside_program_hours");
  });

  it("Friday 5:01 PM CT (after resume) → after_friday_close warning", () => {
    const w = validateTradeTime(FRI_AFTER_RESUME, es, TOPSTEP_PROFILE);
    assert.equal(w.length, 1);
    assert.equal(w[0]?.code, "after_friday_close");
  });
});

describe("validateTradeTime — special product close times", () => {
  it("CBOT grain (ZC) 2:00 PM CT → after product cutoff (1:20 PM)", () => {
    const zc = getProduct("ZC");
    const w = validateTradeTime(TUE_GRAIN_LATE, zc, TOPSTEP_PROFILE);
    assert.equal(w.length, 1);
    assert.equal(w[0]?.code, "after_program_cutoff");
    assert.match(w[0]!.message, /1:20 PM CT/);
  });

  it("CBOT grain (ZC) 1:00 PM CT (before product cutoff) → no warning", () => {
    const zc = getProduct("ZC");
    const w = validateTradeTime(TUE_GRAIN_EARLY, zc, TOPSTEP_PROFILE);
    assert.equal(w.length, 0);
  });

  it("CME livestock (LE) 1:30 PM CT → after product cutoff (1:05 PM)", () => {
    const le = getProduct("LE");
    const w = validateTradeTime(TUE_LIVESTOCK_LATE, le, TOPSTEP_PROFILE);
    assert.equal(w.length, 1);
    assert.equal(w[0]?.code, "after_program_cutoff");
    assert.match(w[0]!.message, /1:05 PM CT/);
  });
});

describe("validateTradeTime — Generic profile (no schedule)", () => {
  it("never warns regardless of weekday/time", () => {
    const es = getProduct("ES");
    assert.equal(validateTradeTime(MON_AFTER_CUTOFF, es, GENERIC_FUTURES_PROFILE).length, 0);
    assert.equal(validateTradeTime(SAT_ANYTIME, es, GENERIC_FUTURES_PROFILE).length, 0);
    assert.equal(validateTradeTime(SUN_BEFORE_OPEN, es, GENERIC_FUTURES_PROFILE).length, 0);
  });
});

describe("getMarketStateAt — Topstep profile", () => {
  const es = getProduct("ES");

  it("Monday 3:09 PM CT → open", () => {
    assert.equal(getMarketStateAt(es, TOPSTEP_PROFILE, MON_BEFORE_CUTOFF), "open");
  });

  it("Monday 3:11 PM CT (after cutoff, before resume) → paused", () => {
    assert.equal(getMarketStateAt(es, TOPSTEP_PROFILE, MON_AFTER_CUTOFF), "paused");
  });

  it("Monday 5:01 PM CT → open (next session)", () => {
    assert.equal(getMarketStateAt(es, TOPSTEP_PROFILE, MON_AFTER_RESUME), "open");
  });

  it("Sunday before 5:00 PM CT → pre-open", () => {
    assert.equal(getMarketStateAt(es, TOPSTEP_PROFILE, SUN_BEFORE_OPEN), "pre-open");
  });

  it("Sunday after 5:00 PM CT → open", () => {
    assert.equal(getMarketStateAt(es, TOPSTEP_PROFILE, SUN_AFTER_OPEN), "open");
  });

  it("Saturday → closed", () => {
    assert.equal(getMarketStateAt(es, TOPSTEP_PROFILE, SAT_ANYTIME), "closed");
  });

  it("Friday after resume → closed (weekend has begun)", () => {
    assert.equal(getMarketStateAt(es, TOPSTEP_PROFILE, FRI_AFTER_RESUME), "closed");
  });
});

describe("getMarketStateAt — Generic profile (no schedule) returns unknown", () => {
  it("returns unknown regardless of time when no cutoff is configured", () => {
    const es = getProduct("ES");
    assert.equal(getMarketStateAt(es, GENERIC_FUTURES_PROFILE, MON_BEFORE_CUTOFF), "unknown");
  });
});

describe("describeMarketState — trader-friendly labels", () => {
  it("uses no raw timezone strings", () => {
    for (const s of ["open", "closed", "paused", "pre-open", "unknown"] as const) {
      const text = describeMarketState(s);
      assert.doesNotMatch(text, /America\/Chicago/);
      assert.doesNotMatch(text, /UTC/);
    }
  });
});
