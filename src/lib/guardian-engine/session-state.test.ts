import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyFill } from "./fill-classifier.ts";
import { deriveCanonicalEntryCount, type CanonicalFill } from "./canonical-trade-count.ts";

// Simulate a sequence of fills and count how many are trade entries.
// Mirrors the webhook's position-aware classification loop: only entry and
// reversal count — scale_in does NOT count (matches Tradovate's "# of Trades").
function simulateEntryCount(
  fills: Array<{ side: "BUY" | "SELL"; qty: number }>,
): number {
  let position = 0;
  let entries = 0;
  for (const fill of fills) {
    const cls = classifyFill(position, fill.side, fill.qty);
    if (cls === "entry" || cls === "reversal") entries++;
    position += fill.side === "BUY" ? fill.qty : -fill.qty;
  }
  return entries;
}

// ── classifyFill — position state transitions ─────────────────────────────────

describe("classifyFill — position state", () => {
  it("flat → long is 'entry'", () => {
    assert.equal(classifyFill(0, "BUY", 1), "entry");
  });

  it("flat → short is 'entry'", () => {
    assert.equal(classifyFill(0, "SELL", 1), "entry");
  });

  it("long → flat is 'reduction'", () => {
    assert.equal(classifyFill(1, "SELL", 1), "reduction");
  });

  it("short → flat is 'reduction'", () => {
    assert.equal(classifyFill(-1, "BUY", 1), "reduction");
  });

  it("partial close of long is 'reduction'", () => {
    assert.equal(classifyFill(2, "SELL", 1), "reduction");
  });

  it("partial close of short is 'reduction'", () => {
    assert.equal(classifyFill(-2, "BUY", 1), "reduction");
  });

  it("add to long is 'scale_in'", () => {
    assert.equal(classifyFill(1, "BUY", 1), "scale_in");
  });

  it("add to short is 'scale_in'", () => {
    assert.equal(classifyFill(-1, "SELL", 1), "scale_in");
  });

  it("long → short without stopping at flat is 'reversal'", () => {
    assert.equal(classifyFill(1, "SELL", 2), "reversal");
  });

  it("short → long without stopping at flat is 'reversal'", () => {
    assert.equal(classifyFill(-1, "BUY", 2), "reversal");
  });
});

// ── Round-trip scenarios — required by bug report ─────────────────────────────

describe("trade entry counting — round-trip scenarios", () => {
  it("1. entry + manual exit = 1 trade", () => {
    assert.equal(
      simulateEntryCount([
        { side: "BUY", qty: 1 },  // entry: flat → long
        { side: "SELL", qty: 1 }, // exit: long → flat
      ]),
      1,
    );
  });

  it("2. entry + stop-loss exit = 1 trade", () => {
    // Stop-loss exit is mechanically identical to manual exit for position tracking.
    assert.equal(
      simulateEntryCount([
        { side: "BUY", qty: 1 },
        { side: "SELL", qty: 1 },
      ]),
      1,
    );
  });

  it("3. entry + take-profit exit = 1 trade", () => {
    assert.equal(
      simulateEntryCount([
        { side: "BUY", qty: 1 },
        { side: "SELL", qty: 1 },
      ]),
      1,
    );
  });

  it("4. entry + exit + re-entry = 2 trades", () => {
    assert.equal(
      simulateEntryCount([
        { side: "BUY", qty: 1 },  // entry 1
        { side: "SELL", qty: 1 }, // exit
        { side: "BUY", qty: 1 },  // entry 2 (flat again, so this is a new entry)
      ]),
      2,
    );
  });

  it("5. partial exit does not increment count", () => {
    assert.equal(
      simulateEntryCount([
        { side: "BUY", qty: 2 },  // entry: flat → long 2
        { side: "SELL", qty: 1 }, // partial exit: long 2 → long 1 (reduction, no count)
        { side: "SELL", qty: 1 }, // full close: long 1 → flat (reduction, no count)
      ]),
      1,
    );
  });

  it("6. scale-in does NOT count as a trade entry (matches Tradovate '# of Trades')", () => {
    assert.equal(
      simulateEntryCount([
        { side: "BUY", qty: 1 }, // entry: flat → long 1
        { side: "BUY", qty: 1 }, // scale-in: long 1 → long 2 (adds to position, NOT a new trade)
        { side: "SELL", qty: 2 }, // close all
      ]),
      1,
    );
  });

  it("7. direction flip (reversal) counts as 1 additional entry for the new side", () => {
    // Long 1 → flip to short 1 in one fill → original entry + reversal entry = 2 total.
    assert.equal(
      simulateEntryCount([
        { side: "BUY", qty: 1 },  // entry 1: flat → long 1
        { side: "SELL", qty: 2 }, // reversal: long 1 → short 1 (entry 2)
        { side: "BUY", qty: 1 },  // close short
      ]),
      2,
    );
  });

  it("8. raw fill count regression: two fills from one round trip must not show 2 trades", () => {
    // Root cause of the reported bug: Tradovate sends profit: 0 on entry fills in DEMO,
    // which the old code counted as a trade (pnl != null). With position-aware
    // classification the entry fill is correctly identified as 'entry' and the exit as
    // 'reduction', giving a total of 1 — not 2.
    assert.equal(
      simulateEntryCount([
        { side: "BUY", qty: 1 },  // entry fill (was incorrectly counted by old code)
        { side: "SELL", qty: 1 }, // exit fill
      ]),
      1,
      "one round trip must show exactly 1 trade, not 2",
    );
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe("classifyFill — edge cases", () => {
  it("short entry + short exit + short re-entry = 2 trades", () => {
    assert.equal(
      simulateEntryCount([
        { side: "SELL", qty: 1 }, // entry: flat → short 1
        { side: "BUY", qty: 1 },  // exit: short 1 → flat
        { side: "SELL", qty: 1 }, // re-entry: flat → short 1
      ]),
      2,
    );
  });

  it("oversized close (exit > position) treated as reversal = 1 additional entry", () => {
    // e.g. long 1 contract, sell 3: closes 1 long, opens 2 short
    assert.equal(classifyFill(1, "SELL", 3), "reversal");
  });

  it("multiple partial exits before re-entry = 1 original entry", () => {
    assert.equal(
      simulateEntryCount([
        { side: "BUY", qty: 4 },  // entry: flat → long 4
        { side: "SELL", qty: 1 }, // partial
        { side: "SELL", qty: 1 }, // partial
        { side: "SELL", qty: 2 }, // full close
      ]),
      1,
    );
  });
});

// ── deriveCanonicalEntryCount — deduplication and cross-path correctness ─────
// Reproduces the DEMO7433035 live bug: one round trip was showing count=4
// because the sync used fetchAccountScopedOrders() (counts completed orders,
// not position entries) and overwrote the webhook's correct count of 1.
// The canonical function uses fill records + position-aware classification.

function t(offsetMs: number): Date {
  return new Date(1_700_000_000_000 + offsetMs);
}

function fill(
  externalTradeId: string | null,
  contractId: number | null,
  side: "BUY" | "SELL",
  qty: number,
  offsetMs: number,
  rawPayload: unknown = null,
  price: string | null = null,
): CanonicalFill {
  return {
    externalTradeId,
    contractId,
    side,
    quantity: String(qty),
    price,
    occurredAt: t(offsetMs),
    rawPayload,
  };
}

describe("deriveCanonicalEntryCount — canonical trade counting", () => {
  it("1. one entry + one exit = 1 trade", () => {
    const fills = [
      fill("f1", 1, "BUY",  1, 0),
      fill("f2", 1, "SELL", 1, 1),
    ];
    assert.equal(deriveCanonicalEntryCount(fills), 1);
  });

  it("2. same fill stored twice (same externalTradeId) is deduplicated to 1 trade", () => {
    // Reproduces double-storage when sync and webhook both record the same fill.
    const fills = [
      fill("f1", 1, "BUY",  1, 0),
      fill("f1", 1, "BUY",  1, 0), // duplicate
      fill("f2", 1, "SELL", 1, 1),
      fill("f2", 1, "SELL", 1, 1), // duplicate
    ];
    assert.equal(deriveCanonicalEntryCount(fills), 1);
  });

  it("3. sync-before-webhook dedup: fill without contractId then fill with contractId = 1 trade", () => {
    // Sync stores first (no contractId), then webhook stores the same fill with contractId.
    // deriveCanonicalEntryCount prefers the entry with contractId for grouping.
    const fills = [
      fill("f1", null, "BUY",  1, 0, { symbol: "NQ" }), // sync version
      fill("f1", 1234, "BUY",  1, 0),                   // webhook version
      fill("f2", 1234, "SELL", 1, 1),
    ];
    assert.equal(deriveCanonicalEntryCount(fills), 1);
  });

  it("4. position-aware count vs. order count: bracket round trip = 1 trade", () => {
    // fetchAccountScopedOrders() would return 4 completed orders
    // (entry + SL bracket + TP bracket + manual exit) = 4. Bug count.
    // Canonical fill-based count: 1 entry fill + 1 exit fill = 1 trade. Correct.
    const fills = [
      fill("f1", 1, "BUY",  1, 0), // entry fill
      fill("f2", 1, "SELL", 1, 1), // exit fill (one bracket leg executed)
    ];
    assert.equal(deriveCanonicalEntryCount(fills), 1, "bracket round trip must count as 1 trade");
  });

  it("5. entry + partial exit + final exit = 1 trade", () => {
    const fills = [
      fill("f1", 1, "BUY",  2, 0),
      fill("f2", 1, "SELL", 1, 1), // partial close
      fill("f3", 1, "SELL", 1, 2), // full close
    ];
    assert.equal(deriveCanonicalEntryCount(fills), 1);
  });

  it("6. entry + exit + new entry + exit = 2 trades", () => {
    const fills = [
      fill("f1", 1, "BUY",  1, 0),
      fill("f2", 1, "SELL", 1, 1),
      fill("f3", 1, "BUY",  1, 2), // second trade
      fill("f4", 1, "SELL", 1, 3),
    ];
    assert.equal(deriveCanonicalEntryCount(fills), 2);
  });

  it("7. fills without externalTradeId (pre-connection activity) are counted as-is", () => {
    // Legacy or pre-connection fills have no ID and cannot be deduped — included verbatim.
    const fills = [
      fill(null, 1, "BUY",  1, 0),
      fill(null, 1, "SELL", 1, 1),
    ];
    assert.equal(deriveCanonicalEntryCount(fills), 1);
  });

  it("8. fills for two different contracts are counted independently", () => {
    // NQ entry/exit (contractId=100) + MNQ entry/exit (contractId=200) = 2 trades.
    const fills = [
      fill("f1", 100, "BUY",  1, 0),
      fill("f2", 100, "SELL", 1, 1),
      fill("f3", 200, "BUY",  1, 2),
      fill("f4", 200, "SELL", 1, 3),
    ];
    assert.equal(deriveCanonicalEntryCount(fills), 2);
  });

  it("9. sync-only fills (no contractId, symbol in rawPayload) are counted correctly", () => {
    // Sync-before-webhook scenario: "fill" events stored with symbol but no contractId.
    // Should still count 1 entry for one round trip in the same symbol.
    const fills = [
      fill("f1", null, "BUY",  1, 0, { symbol: "NQ" }),
      fill("f2", null, "SELL", 1, 1, { symbol: "NQ" }),
    ];
    assert.equal(deriveCanonicalEntryCount(fills), 1);
  });

  it("10. two round trips on same contract with same-ms timestamps = 2 trades (sort stability)", () => {
    // THE KEY BUG scenario for DEMO7433035: two separate round trips executed in the
    // same millisecond get Tradovate fill IDs 101→102→103→104 (monotonically increasing).
    // Without stable sort, same-timestamp fills can arrive as [BUY1,BUY2,SELL1,SELL2]
    // and the second BUY is mis-classified as scale_in → count=1 (wrong).
    // With secondary sort by numeric fill ID the order is [101:BUY,102:SELL,103:BUY,104:SELL]
    // → two entries → count=2 (correct).
    const T = 0; // all four fills share the same millisecond timestamp
    const fills = [
      fill("101", 1, "BUY",  1, T),
      fill("102", 1, "SELL", 1, T),
      fill("103", 1, "BUY",  1, T),
      fill("104", 1, "SELL", 1, T),
    ];
    assert.equal(
      deriveCanonicalEntryCount(fills),
      2,
      "two same-ms round trips must show 2 trades via stable fill-ID sort",
    );
  });

  it("11. two round trips same qty/contract but different timestamps and prices = 2 trades", () => {
    // Confirms that fills with the same quantity are NOT falsely deduplicated —
    // dedup only applies within the same externalTradeId, not by shape similarity.
    const fills = [
      fill("f1", 1, "BUY",  1, 0,    null, "5000.00"),
      fill("f2", 1, "SELL", 1, 1000, null, "5005.00"),
      fill("f3", 1, "BUY",  1, 5000, null, "5010.00"),
      fill("f4", 1, "SELL", 1, 6000, null, "5015.00"),
    ];
    assert.equal(deriveCanonicalEntryCount(fills), 2);
  });

  it("12. reversal (long→short in one fill) counts as a new trade", () => {
    // Sell 2 while long 1: closes 1 long AND opens 1 short in the same fill.
    // Canonical count: original entry + reversal = 2 trades.
    const fills = [
      fill("f1", 1, "BUY",  1, 0), // entry: flat → long 1
      fill("f2", 1, "SELL", 2, 1), // reversal: long 1 → short 1
      fill("f3", 1, "BUY",  1, 2), // exit short
    ];
    assert.equal(deriveCanonicalEntryCount(fills), 2, "reversal must count as a new trade entry");
  });

  it("13. null-ID fills with different timestamps/prices are NOT collapsed", () => {
    // Composite dedup key includes occurredAt + price, so two physically distinct
    // fills without an externalTradeId are kept separate and counted independently.
    const fills = [
      fill(null, 1, "BUY",  1, 0,    null, "5000"),
      fill(null, 1, "SELL", 1, 1000, null, "5005"),
      fill(null, 1, "BUY",  1, 5000, null, "4995"), // different time + price → new fill
      fill(null, 1, "SELL", 1, 6000, null, "5000"),
    ];
    assert.equal(
      deriveCanonicalEntryCount(fills),
      2,
      "null-ID fills with distinct composite keys must each be counted",
    );
  });
});
