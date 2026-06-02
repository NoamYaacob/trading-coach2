import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { reconstructRoundTrips, buildContractIdMap, resolveSymbol, type FillInput } from "./round-trips.ts";

function fill(over: Partial<FillInput> & Pick<FillInput, "occurredAt">): FillInput {
  return {
    id: over.id ?? `f-${Math.random()}`,
    externalTradeId: over.externalTradeId ?? null,
    contractId: "contractId" in over ? over.contractId : 1,
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

  it("recovers contractId from rawPayload when the DB column is null (webhook-path fills)", () => {
    // Webhook path stores the full fill object as rawPayload — contractId lives
    // there as a numeric field — but the DB contractId column may be null.
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "4700", contractId: null, rawPayload: { contractId: 4327110, id: 1 }, occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "4701", contractId: null, rawPayload: { contractId: 4327110, id: 2 }, occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.equal(trades[0]!.symbol, "MNQM6");
    assert.equal(trades[0]!.symbolResolved, true);
    assert.equal(trades[0]!.pnl, 2); // (4701-4700)*1*1*2 — $2/pt, NOT $1/pt
  });

  it("recovers contractId from rawPayload contract.id shape", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "20000", contractId: null, rawPayload: { contract: { id: 4214191 } }, occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "20005", contractId: null, rawPayload: { contract: { id: 4214191 } }, occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.equal(trades[0]!.symbol, "NQM6");
    assert.equal(trades[0]!.pnl, 100); // $20/pt
  });

  it("marks symbolResolved=false and uses $1/pt for genuinely unresolvable fills", () => {
    // No DB contractId, no payload symbol, no payload contractId → cannot resolve.
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "100", contractId: null, rawPayload: {}, occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "102", contractId: null, rawPayload: {}, occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.equal(trades[0]!.symbolResolved, false);
    assert.equal(trades[0]!.symbol, "—");
    assert.equal(trades[0]!.pnl, 2); // (102-100)*1*1*1 — low confidence
  });

  it("treats numeric-only rawPayload.symbol as a contract id, not a symbol", () => {
    // Production shape: {"symbol":"4327110","orderId":"…"}, DB contractId null.
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "4700", contractId: null, rawPayload: { symbol: "4327110", orderId: "475261340013" }, occurredAt: new Date("2026-05-04T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "4701", contractId: null, rawPayload: { symbol: "4327110", orderId: "475261340024" }, occurredAt: new Date("2026-05-04T14:30:00Z") }),
    ]);
    assert.equal(trades[0]!.symbol, "MNQM6");
    assert.equal(trades[0]!.symbolResolved, true);
    assert.equal(trades[0]!.pnl, 2); // $2/pt, NOT $1/pt
  });

  it("numeric rawPayload.symbol 4214191 resolves to NQM6 at $20/pt", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "20000", contractId: null, rawPayload: { symbol: "4214191", orderId: "x" }, occurredAt: new Date("2026-05-04T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "20005", contractId: null, rawPayload: { symbol: "4214191", orderId: "y" }, occurredAt: new Date("2026-05-04T14:30:00Z") }),
    ]);
    assert.equal(trades[0]!.symbol, "NQM6");
    assert.equal(trades[0]!.pnl, 100); // $20/pt
  });

  it("valid futures symbol in rawPayload.symbol still wins over id resolution", () => {
    const r = resolveSymbol(fill({ id: "1", contractId: null, rawPayload: { symbol: "MNQM6", orderId: "z" }, occurredAt: new Date() }));
    assert.equal(r.symbol, "MNQM6");
    assert.equal(r.source, "payload");
    assert.equal(r.resolved, true);
  });

  it("unknown numeric rawPayload.symbol is low-confidence, exposing the recovered id", () => {
    const r = resolveSymbol(fill({ id: "1", contractId: null, rawPayload: { symbol: "9999999", orderId: "z" }, occurredAt: new Date() }));
    assert.equal(r.resolved, false);
    assert.equal(r.symbol, "#9999999");
    assert.equal(r.rawContractId, 9999999);
    assert.equal(r.pointValue, 1);
  });

  it("1868411-style subset (numeric symbol, null DB contractId) reconstructs at $2/pt", () => {
    // 3 round-trips that sum to +$21.75 at $1/pt must become +$43.50 at $2/pt.
    const mk = (id: number, side: string, price: string, ms: number): FillInput =>
      fill({ id: `f${id}`, externalTradeId: String(id), side, quantity: "1", price, contractId: null, rawPayload: { symbol: "4327110", orderId: `o${id}` }, occurredAt: new Date(Date.parse("2026-05-04T13:00:00Z") + ms) });
    const trades = reconstructRoundTrips([
      mk(1, "BUY", "4700", 0), mk(2, "SELL", "4705", 60_000),
      mk(3, "BUY", "4710", 120_000), mk(4, "SELL", "4715", 180_000),
      mk(5, "SELL", "4720", 240_000), mk(6, "BUY", "4708.25", 300_000),
    ]);
    assert.equal(trades.length, 3);
    assert.ok(trades.every((tr) => tr.symbol === "MNQM6" && tr.symbolResolved));
    const gross = trades.reduce((s, tr) => s + tr.pnl, 0);
    assert.equal(gross, (5 + 5 + 11.75) * 2); // 43.50 at $2/pt
  });
});

describe("buildContractIdMap", () => {
  it("only stores valid futures symbols, rejecting numeric-only values", () => {
    const map = buildContractIdMap([
      fill({ id: "1", contractId: 4327110, rawPayload: { contract: { name: "MNQM6" } }, occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", contractId: 4214191, rawPayload: { contract: { name: "4214191" } }, occurredAt: new Date("2026-01-01T14:01:00Z") }),
    ]);
    assert.equal(map.get(4327110), "MNQM6");
    assert.equal(map.has(4214191), false); // numeric-only rejected
  });

  it("keys by the contractId recovered from rawPayload when DB column is null", () => {
    const map = buildContractIdMap([
      fill({ id: "1", contractId: null, rawPayload: { contractId: 4327110, symbol: "MNQM6" }, occurredAt: new Date("2026-01-01T14:00:00Z") }),
    ]);
    assert.equal(map.get(4327110), "MNQM6");
  });
});

describe("resolveSymbol provenance", () => {
  it("reports rawContractId and source for each resolution path", () => {
    // payload symbol
    const p = resolveSymbol(fill({ id: "1", contractId: 4327110, rawPayload: { symbol: "MNQM6" }, occurredAt: new Date() }));
    assert.equal(p.source, "payload");
    assert.equal(p.symbol, "MNQM6");
    assert.equal(p.pointValue, 2);
    assert.equal(p.resolved, true);

    // hardcoded known map (payload has no symbol)
    const k = resolveSymbol(fill({ id: "2", contractId: 4327110, rawPayload: {}, occurredAt: new Date() }));
    assert.equal(k.source, "known_map");
    assert.equal(k.symbol, "MNQM6");
    assert.equal(k.rawContractId, 4327110);

    // unresolved
    const u = resolveSymbol(fill({ id: "3", contractId: null, rawPayload: {}, occurredAt: new Date() }));
    assert.equal(u.source, "unresolved");
    assert.equal(u.resolved, false);
    assert.equal(u.pointValue, 1);
    assert.equal(u.rawContractId, null);
  });
});

describe("reconstructRoundTrips: DEMO/1868411 sample scenarios (pointValue regression)", () => {
  it("first DEMO sample (5 MNQ round-trips, contractId 4327110) reconstructs at $2/pt", () => {
    // Five 1-lot MNQM6 round-trips, each +1.0 point → +$2.00 at $2/pt (not +$1 at $1/pt).
    // Sum = +$10.00 ($2/pt) vs +$5.00 ($1/pt). Mirrors the +$184 vs +$92 production gap shape.
    const fills: FillInput[] = [];
    let t = new Date("2026-05-04T14:00:00Z").getTime();
    for (let i = 0; i < 5; i++) {
      fills.push(fill({ id: `b${i}`, externalTradeId: String(i * 2), side: "BUY", quantity: "1", price: "4700", contractId: 4327110, rawPayload: { contractId: 4327110, id: i * 2 }, occurredAt: new Date(t) }));
      t += 60_000;
      fills.push(fill({ id: `s${i}`, externalTradeId: String(i * 2 + 1), side: "SELL", quantity: "1", price: "4701", contractId: 4327110, rawPayload: { contractId: 4327110, id: i * 2 + 1 }, occurredAt: new Date(t) }));
      t += 60_000;
    }
    const trades = reconstructRoundTrips(fills);
    assert.equal(trades.length, 5);
    assert.ok(trades.every((tr) => tr.symbol === "MNQM6" && tr.symbolResolved));
    const gross = trades.reduce((s, tr) => s + tr.pnl, 0);
    assert.equal(gross, 10); // 5 × $2.00 — would be $5.00 at the buggy $1/pt
  });

  it("1868411 May-4 imported subset resolves to MNQM6 at $2/pt even with null DB contractId", () => {
    // Account whose fills carry contractId only inside rawPayload (DB column null).
    // 3 round-trips that sum to +$21.50 at $1/pt must become +$43.00 at $2/pt.
    const mk = (id: number, side: string, price: string, ms: number): FillInput =>
      fill({ id: `f${id}`, externalTradeId: String(id), side, quantity: "1", price, contractId: null, rawPayload: { contractId: 4327110, id }, occurredAt: new Date(Date.parse("2026-05-04T13:00:00Z") + ms) });
    const trades = reconstructRoundTrips([
      mk(1, "BUY", "4700", 0), mk(2, "SELL", "4705", 60_000),     // +5 pts
      mk(3, "BUY", "4710", 120_000), mk(4, "SELL", "4715", 180_000), // +5 pts
      mk(5, "SELL", "4720", 240_000), mk(6, "BUY", "4708.25", 300_000), // +11.75 pts short
    ]);
    assert.equal(trades.length, 3);
    assert.ok(trades.every((tr) => tr.symbol === "MNQM6" && tr.symbolResolved));
    const grossAt1 = (5 + 5 + 11.75) * 1; // = 21.75 at $1/pt
    const grossAt2 = (5 + 5 + 11.75) * 2; // = 43.50 at $2/pt
    const gross = trades.reduce((s, tr) => s + tr.pnl, 0);
    assert.equal(gross, grossAt2);
    assert.notEqual(gross, grossAt1);
  });
});

describe("reconstructRoundTrips: pnlType — gross vs computed labelling", () => {
  it("round-trip with broker fill pnl gets pnlType='broker_gross'", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "100", pnl: null, occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "105", pnl: "1.50", occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.equal(trades.length, 1);
    assert.equal(trades[0]!.pnlSource, "broker");
    assert.equal(trades[0]!.pnlType, "broker_gross",
      "broker fill P&L is gross (before fees) — pnlType must be 'broker_gross'");
    assert.equal(trades[0]!.pnl, 1.50);
  });

  it("round-trip without broker fill pnl gets pnlType='computed'", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "100", pnl: null, occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "103", pnl: null, occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.equal(trades.length, 1);
    assert.equal(trades[0]!.pnlSource, "computed");
    assert.equal(trades[0]!.pnlType, "computed",
      "computed P&L (no broker fill pnl) gets pnlType='computed'");
  });

  it("gross +1.50 from fills is labelled broker_gross — not final net", () => {
    // Simulates: broker fill P&L = +1.50, but actual net (after -1.90 fees) = -0.40.
    // The round-trip pnl reflects only what the fill returned — it is gross.
    // The broker session snapshot (LiveSessionState.dailyPnl) is the final net.
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "19000", pnl: null, occurredAt: new Date("2026-06-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "19000.75", pnl: "1.50", occurredAt: new Date("2026-06-01T14:30:00Z") }),
    ]);
    assert.equal(trades.length, 1);
    assert.equal(trades[0]!.pnl, 1.50, "gross P&L from fill is +1.50");
    assert.equal(trades[0]!.pnlType, "broker_gross",
      "pnlType must be broker_gross — not final net — fees (-1.90) are not deducted here");
    // Net P&L would be grossPnl + fees = 1.50 - 1.90 = -0.40, but that comes
    // from LiveSessionState.dailyPnl (broker snapshot), not from the round-trip.
  });
});

describe("reconstructRoundTrips: net P&L after fees (broker commission)", () => {
  it("gross +1.50 with 1.90 fees → netPnl -0.40 (the production 1868411 case)", () => {
    // commission split across the open (0.95) and close (0.95) fills → 1.90 total.
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "19000", pnl: null,
        rawPayload: { contract: { name: "MNQM6" }, commission: 0.95 },
        occurredAt: new Date("2026-06-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "19000.75", pnl: "1.50",
        rawPayload: { contract: { name: "MNQM6" }, commission: 0.95 },
        occurredAt: new Date("2026-06-01T14:30:00Z") }),
    ]);
    assert.equal(trades.length, 1);
    assert.equal(trades[0]!.pnl, 1.50, "gross from fill is +1.50");
    assert.equal(trades[0]!.fees, 1.90, "fees sum to 1.90 (0.95 entry + 0.95 close)");
    assert.equal(trades[0]!.feesAvailable, true);
    assert.ok(Math.abs(trades[0]!.netPnl - -0.40) < 1e-9, "netPnl = 1.50 - 1.90 = -0.40");
  });

  it("commission only on the closing fill is still counted", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "100", pnl: null,
        rawPayload: { contract: { name: "ESH5" } },
        occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "105", pnl: "1.50",
        rawPayload: { contract: { name: "ESH5" }, commission: 1.90 },
        occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.equal(trades.length, 1);
    assert.equal(trades[0]!.fees, 1.90);
    assert.equal(trades[0]!.feesAvailable, true);
    assert.ok(Math.abs(trades[0]!.netPnl - -0.40) < 1e-9);
  });

  it("no commission anywhere → fees=null, feesAvailable=false, netPnl == gross (no fabrication)", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "100", pnl: null,
        rawPayload: { contract: { name: "ESH5" } },
        occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "105", pnl: "1.50",
        rawPayload: { contract: { name: "ESH5" } },
        occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.equal(trades.length, 1);
    assert.equal(trades[0]!.fees, null, "fees must be null when broker reports none — never fabricated as 0");
    assert.equal(trades[0]!.feesAvailable, false);
    assert.equal(trades[0]!.netPnl, trades[0]!.pnl, "netPnl falls back to gross when no fee data");
  });

  it("partial close prorates the entry-lot fee", () => {
    // Open 2 @ commission 2.00 (1.00/unit), close 1 → entry fee 1.00 + close fee 0.50.
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "2", price: "100", pnl: null,
        rawPayload: { contract: { name: "ESH5" }, commission: 2.00 },
        occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "110", pnl: "10",
        rawPayload: { contract: { name: "ESH5" }, commission: 0.50 },
        occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.equal(trades.length, 1);
    assert.equal(trades[0]!.fees, 1.50, "entry 1.00 (1 of 2 lots) + close 0.50 = 1.50");
    assert.ok(Math.abs(trades[0]!.netPnl - 8.50) < 1e-9, "netPnl = 10 - 1.50 = 8.50");
  });

  it("commission reported negative is normalised to a positive cost", () => {
    const trades = reconstructRoundTrips([
      fill({ id: "1", side: "BUY", quantity: "1", price: "100", pnl: null,
        rawPayload: { contract: { name: "ESH5" }, commission: -0.95 },
        occurredAt: new Date("2026-01-01T14:00:00Z") }),
      fill({ id: "2", side: "SELL", quantity: "1", price: "105", pnl: "1.50",
        rawPayload: { contract: { name: "ESH5" }, commission: -0.95 },
        occurredAt: new Date("2026-01-01T14:30:00Z") }),
    ]);
    assert.equal(trades.length, 1);
    assert.equal(trades[0]!.fees, 1.90, "negative commission is treated as a positive cost magnitude");
    assert.ok(Math.abs(trades[0]!.netPnl - -0.40) < 1e-9);
  });
});
