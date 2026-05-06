import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyFill } from "./fill-classifier.ts";

// Simulate a sequence of fills and count how many are trade entries.
// Mirrors the webhook's position-aware classification loop.
function simulateEntryCount(
  fills: Array<{ side: "BUY" | "SELL"; qty: number }>,
): number {
  let position = 0;
  let entries = 0;
  for (const fill of fills) {
    const cls = classifyFill(position, fill.side, fill.qty);
    if (cls !== "reduction") entries++;
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

  it("6. scale-in counts as an additional trade entry", () => {
    assert.equal(
      simulateEntryCount([
        { side: "BUY", qty: 1 }, // entry: flat → long 1
        { side: "BUY", qty: 1 }, // scale-in: long 1 → long 2 (adding to position = new entry)
        { side: "SELL", qty: 2 }, // close all
      ]),
      2,
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
