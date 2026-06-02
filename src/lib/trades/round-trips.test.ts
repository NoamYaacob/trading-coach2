import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { reconstructRoundTrips, type FillInput } from "./round-trips.ts";

function fill(over: Partial<FillInput> & Pick<FillInput, "occurredAt">): FillInput {
  return {
    id: over.id ?? `f-${Math.random()}`,
    externalTradeId: over.externalTradeId ?? null,
    contractId: over.contractId ?? 1,
    side: over.side ?? "BUY",
    quantity: over.quantity ?? "1",
    price: over.price ?? "100",
    pnl: over.pnl ?? null,
    occurredAt: over.occurredAt,
    rawPayload: "rawPayload" in over ? over.rawPayload : { contract: { name: "TSTH5" } },
  };
}

describe("reconstructRoundTrips: basic round-trip", () => {
  it("BUY then SELL on same contract produces one LONG trade", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "2", price: "100", occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "2", price: "105", occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.equal(trades.length, 1);
    assert.equal(trades[0]!.side, "LONG");
    assert.equal(trades[0]!.qty, 2);
    assert.equal(trades[0]!.entryPrice, 100);
    assert.equal(trades[0]!.exitPrice, 105);
    assert.equal(trades[0]!.pnl, 10); // (105-100)*2
    assert.equal(trades[0]!.pnlSource, "computed");
  });

  it("SELL then BUY on same contract produces one SHORT trade", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "SELL", quantity: "1", price: "100", occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "BUY", quantity: "1", price: "95", occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.equal(trades.length, 1);
    assert.equal(trades[0]!.side, "SHORT");
    assert.equal(trades[0]!.pnl, 5); // (95-100)*1*-1
  });
});

describe("reconstructRoundTrips: scale-in and partial exits", () => {
  it("scale-in averages entry; full exit emits one trade", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "100", occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "BUY", quantity: "1", price: "104", occurredAt: new Date("2026-01-01T14:10:00Z") }),
      fill({ id: "3", side: "SELL", quantity: "2", price: "110", occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.equal(trades.length, 1);
    assert.equal(trades[0]!.qty, 2);
    assert.equal(trades[0]!.entryPrice, 102); // (100*1 + 104*1)/2
    assert.equal(trades[0]!.exitPrice, 110);
    assert.equal(trades[0]!.pnl, 16); // (110-102)*2
  });

  it("partial exit emits one trade; remaining exit emits a second", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "2", price: "100", occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "105", occurredAt: new Date("2026-01-01T14:10:00Z") }),
      fill({ id: "3", side: "SELL", quantity: "1", price: "110", occurredAt: new Date("2026-01-01T14:20:00Z") }),
    ]);
    assert.equal(trades.length, 2);
    assert.equal(trades[0]!.qty, 1);
    assert.equal(trades[0]!.pnl, 5);
    assert.equal(trades[1]!.qty, 1);
    assert.equal(trades[1]!.pnl, 10);
  });
});

describe("reconstructRoundTrips: per-contract isolation", () => {
  it("fills on different contracts do not mix", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", contractId: 1, side: "BUY", price: "100", occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", contractId: 2, side: "BUY", price: "200", occurredAt: new Date("2026-01-01T14:01:00Z") }),
      fill({ id: "3", contractId: 1, side: "SELL", price: "110", occurredAt: new Date("2026-01-01T14:30:00Z") }),
      fill({ id: "4", contractId: 2, side: "SELL", price: "210", occurredAt: new Date("2026-01-01T14:35:00Z") }),
    ]);
    assert.equal(trades.length, 2);
    const c1 = trades.find((t) => t.entryPrice === 100)!;
    const c2 = trades.find((t) => t.entryPrice === 200)!;
    assert.equal(c1.pnl, 10);
    assert.equal(c2.pnl, 10);
  });
});

describe("reconstructRoundTrips: broker pnl is preferred", () => {
  it("uses pnl from closing fill if non-null", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "100", occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "105", pnl: "7.50", occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.equal(trades[0]!.pnl, 7.5);
    assert.equal(trades[0]!.pnlSource, "broker");
  });
});

describe("reconstructRoundTrips: open positions and reversals", () => {
  it("does not emit a trade for an entry fill with no matching close", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "100", occurredAt: new Date("2026-01-01T14:00:00Z") }),
    ]);
    assert.equal(trades.length, 0);
  });

  it("flips LONG to SHORT (reversal): emits the LONG round-trip and leaves a SHORT open", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "100", occurredAt: new Date("2026-01-01T14:00:00Z") }),
      // Sell 2 contracts: closes the long 1 (emit) and opens a short 1 (no emit yet)
      fill({ id: "2", side: "SELL", quantity: "2", price: "105", occurredAt: new Date("2026-01-01T14:10:00Z") }),
    ]);
    assert.equal(trades.length, 1);
    assert.equal(trades[0]!.side, "LONG");
    assert.equal(trades[0]!.qty, 1);
    assert.equal(trades[0]!.entryPrice, 100);
    assert.equal(trades[0]!.exitPrice, 105);
    assert.equal(trades[0]!.pnl, 5);
  });

  it("flips SHORT to LONG (reversal): emits SHORT round-trip, leaves LONG open", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "SELL", quantity: "1", price: "100", occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "BUY", quantity: "3", price: "95", occurredAt: new Date("2026-01-01T14:10:00Z") }),
    ]);
    assert.equal(trades.length, 1);
    assert.equal(trades[0]!.side, "SHORT");
    assert.equal(trades[0]!.entryPrice, 100);
    assert.equal(trades[0]!.exitPrice, 95);
    // SHORT pnl = (95 - 100) * 1 * -1 = 5 (favourable, price dropped)
    assert.equal(trades[0]!.pnl, 5);
  });

  it("after a flip the new opposite position closes normally on next fill", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "100", occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "2", price: "105", occurredAt: new Date("2026-01-01T14:10:00Z") }),
      // Close the new short 1 at 102 — short pnl = (102-105)*1*-1 = 3
      fill({ id: "3", side: "BUY", quantity: "1", price: "102", occurredAt: new Date("2026-01-01T14:20:00Z") }),
    ]);
    assert.equal(trades.length, 2);
    assert.equal(trades[1]!.side, "SHORT");
    assert.equal(trades[1]!.entryPrice, 105);
    assert.equal(trades[1]!.exitPrice, 102);
    assert.equal(trades[1]!.pnl, 3);
  });
});

describe("reconstructRoundTrips: P&L sign correctness", () => {
  it("LONG that goes up = positive P&L", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", price: "100", occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", price: "110", occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.ok(trades[0]!.pnl > 0, `LONG up should be positive, got ${trades[0]!.pnl}`);
  });

  it("LONG that goes down = negative P&L", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", price: "100", occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", price: "95", occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.ok(trades[0]!.pnl < 0, `LONG down should be negative, got ${trades[0]!.pnl}`);
  });

  it("SHORT that goes down = positive P&L (price moved favourably)", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "SELL", price: "100", occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "BUY", price: "90", occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.ok(trades[0]!.pnl > 0, `SHORT down should be positive, got ${trades[0]!.pnl}`);
  });

  it("SHORT that goes up = negative P&L", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "SELL", price: "100", occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "BUY", price: "110", occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.ok(trades[0]!.pnl < 0, `SHORT up should be negative, got ${trades[0]!.pnl}`);
  });
});

describe("reconstructRoundTrips: edge cases", () => {
  it("returns empty array for no fills", () => {
    assert.deepEqual(reconstructRoundTrips([]), []);
  });

  it("ignores fills with zero or invalid quantity", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "0", price: "100", occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "abc", price: "105", occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.equal(trades.length, 0);
  });

  it("extracts symbol from the entry fill's rawPayload.contract.name", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", price: "100", rawPayload: { contract: { name: "MESH5" } }, occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", price: "105", rawPayload: { contract: { name: "MESH5" } }, occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.equal(trades[0]!.symbol, "MESH5");
  });

  it("falls back to contractId when symbol missing", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", contractId: 42, side: "BUY", price: "100", rawPayload: null, occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", contractId: 42, side: "SELL", price: "105", rawPayload: null, occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.equal(trades[0]!.symbol, "#42");
  });

  it("computes hold time correctly", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", price: "100", occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", price: "105", occurredAt: new Date("2026-01-01T14:15:00Z") }),
    ]);
    assert.equal(trades[0]!.holdMs, 15 * 60 * 1000);
  });
});

describe("reconstructRoundTrips: pointValue multiplier", () => {
  it("MNQ contract applies pointValue=2 to computed P&L", () => {
    // 1 MNQ long, entry 20000, exit 20001 → (1 pt) * 2 = $2
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "20000", rawPayload: { contract: { name: "MNQM6" } }, occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "20001", rawPayload: { contract: { name: "MNQM6" } }, occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.equal(trades[0]!.pnlSource, "computed");
    assert.equal(trades[0]!.pnl, 2); // (20001-20000)*1*1*2
  });

  it("ES contract applies pointValue=50 to computed P&L", () => {
    // 1 ES long, entry 5000, exit 5001 → (1 pt) * 50 = $50
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "5000", rawPayload: { contract: { name: "ESH5" } }, occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "5001", rawPayload: { contract: { name: "ESH5" } }, occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.equal(trades[0]!.pnlSource, "computed");
    assert.equal(trades[0]!.pnl, 50); // (5001-5000)*1*1*50
  });

  it("broker pnl is used as-is (no multiplier) when present", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "20000", rawPayload: { contract: { name: "MNQM6" } }, occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "20010", pnl: "17.50", rawPayload: { contract: { name: "MNQM6" } }, occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.equal(trades[0]!.pnlSource, "broker");
    assert.equal(trades[0]!.pnl, 17.5); // broker value used directly
  });

  it("unknown symbol falls back to pointValue=1", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "100", rawPayload: { contract: { name: "XYZQ6" } }, occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "102", rawPayload: { contract: { name: "XYZQ6" } }, occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.equal(trades[0]!.pnl, 2); // (102-100)*1*1*1
  });
});

describe("reconstructRoundTrips: contractId resolution", () => {
  it("numeric-only payload symbol is rejected, uses hardcoded mapping instead", () => {
    // rawPayload has "4327110" (numeric), which should be rejected as invalid symbol
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "4700", contractId: 4327110, rawPayload: { contract: { name: "4327110" } }, occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "4702", contractId: 4327110, rawPayload: { contract: { name: "4327110" } }, occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    // Should resolve to MNQM6 (pointValue=$2) via hardcoded mapping, not use numeric contract ID
    assert.equal(trades[0]!.symbol, "MNQM6");
    assert.equal(trades[0]!.pnl, 4); // (4702-4700)*1*1*2
  });

  it("4327110 resolves to MNQM6 with pointValue=$2/pt via hardcoded mapping", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "4700", contractId: 4327110, rawPayload: {}, occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "4701", contractId: 4327110, rawPayload: {}, occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.equal(trades[0]!.symbol, "MNQM6");
    assert.equal(trades[0]!.pnl, 2); // (4701-4700)*1*1*2 with pointValue=$2
  });

  it("4214191 resolves to NQM6 with pointValue=$20/pt via hardcoded mapping", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "20000", contractId: 4214191, rawPayload: {}, occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "20005", contractId: 4214191, rawPayload: {}, occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.equal(trades[0]!.symbol, "NQM6");
    assert.equal(trades[0]!.pnl, 100); // (20005-20000)*1*1*20 with pointValue=$20
  });

  it("valid symbol in payload takes precedence over hardcoded mapping", () => {
    // rawPayload has valid "MNQH6" which should be used instead of hardcoded "MNQM6"
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "4700", contractId: 4327110, rawPayload: { contract: { name: "MNQH6" } }, occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "4701", contractId: 4327110, rawPayload: { contract: { name: "MNQH6" } }, occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.equal(trades[0]!.symbol, "MNQH6");
    assert.equal(trades[0]!.pnl, 2); // Still pointValue=$2 for MNQ
  });

  it("contractIdMap with valid symbol overrides hardcoded mapping", () => {
    const map = new Map<number, string>();
    map.set(4327110, "MNQH6");
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "4700", contractId: 4327110, rawPayload: {}, occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "4701", contractId: 4327110, rawPayload: {}, occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ], map);
    assert.equal(trades[0]!.symbol, "MNQH6");
  });

  it("numeric-only contractIdMap entry is rejected (uses hardcoded instead)", () => {
    const map = new Map<number, string>();
    map.set(4327110, "4327110"); // Numeric-only, should be rejected
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "4700", contractId: 4327110, rawPayload: {}, occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "4701", contractId: 4327110, rawPayload: {}, occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ], map);
    // Should fall back to hardcoded MNQM6, not the invalid map entry
    assert.equal(trades[0]!.symbol, "MNQM6");
    assert.equal(trades[0]!.pnl, 2);
  });
});
