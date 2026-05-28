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
    rawPayload: "rawPayload" in over ? over.rawPayload : { contract: { name: "ESH5" } },
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
