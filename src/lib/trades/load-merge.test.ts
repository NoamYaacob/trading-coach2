/**
 * Unit tests for the pure merge/convert helpers in load.ts:
 *   - historicalFillsToFillInputs (Fills-report rows → FillInput)
 *   - reconstructMergedTrades (dedupe DB fills vs report fills, reconstruct)
 *
 * No DB, no network — these exercise only the pure functions.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { historicalFillsToFillInputs, reconstructMergedTrades } from "./merge.ts";
import type { FillInput } from "./round-trips.ts";
import type { HistoricalFillRow } from "../brokers/tradovate-fills-report.ts";

function reportRow(over: Partial<HistoricalFillRow>): HistoricalFillRow {
  return {
    fillId: over.fillId ?? "1",
    orderId: over.orderId ?? "9",
    side: over.side ?? "BUY",
    quantity: over.quantity ?? 1,
    price: over.price ?? 20000,
    contract: over.contract ?? "MNQM6",
    timestamp: over.timestamp ?? "2026-04-30T09:31:05.000Z",
    accountName: over.accountName ?? "1868411",
  };
}

function dbFill(over: Partial<FillInput>): FillInput {
  return {
    id: over.id ?? "db1",
    externalTradeId: over.externalTradeId ?? null,
    contractId: over.contractId ?? null,
    side: over.side ?? "BUY",
    quantity: over.quantity ?? "1",
    price: over.price ?? "20000",
    pnl: over.pnl ?? null,
    occurredAt: over.occurredAt ?? new Date("2026-06-02T14:00:00.000Z"),
    rawPayload: over.rawPayload ?? { symbol: "MNQM6" },
  };
}

describe("historicalFillsToFillInputs", () => {
  it("maps report rows into FillInput with fillId as externalTradeId", () => {
    const inputs = historicalFillsToFillInputs([
      reportRow({ fillId: "100001", side: "BUY", quantity: 2, price: 20000.25, contract: "MNQM6" }),
    ]);
    assert.equal(inputs.length, 1);
    const f = inputs[0]!;
    assert.equal(f.externalTradeId, "100001", "fillId becomes externalTradeId for dedupe");
    assert.equal(f.side, "BUY");
    assert.equal(f.quantity, "2");
    assert.equal(f.price, "20000.25");
    assert.equal(f.pnl, null, "report carries no per-fill P&L");
    assert.equal(f.contractId, null);
    assert.deepEqual(f.rawPayload, { symbol: "MNQM6", orderId: "9" });
    assert.equal(f.occurredAt.toISOString(), "2026-04-30T09:31:05.000Z");
  });
});

describe("reconstructMergedTrades — historical-only", () => {
  it("reconstructs a round trip purely from report fills (Apr 30)", () => {
    const report = historicalFillsToFillInputs([
      reportRow({ fillId: "1", side: "BUY", quantity: 2, price: 20000, timestamp: "2026-04-30T09:31:00.000Z" }),
      reportRow({ fillId: "2", side: "SELL", quantity: 2, price: 19980, timestamp: "2026-04-30T09:45:00.000Z" }),
    ]);
    const trades = reconstructMergedTrades([], report);
    assert.equal(trades.length, 1, "one closed round trip");
    assert.equal(trades[0]!.side, "LONG");
    assert.equal(trades[0]!.qty, 2);
    // MNQM6 point value: (19980 - 20000) * 2 * 0.5 ... computed gross is negative.
    assert.ok(trades[0]!.pnl < 0, "long that fell is a loss");
  });
});

describe("reconstructMergedTrades — dedupe", () => {
  it("drops report fills whose fillId matches an imported DB fill", () => {
    // Same Jun 2 trade present in BOTH streams: DB has it (externalTradeId 555),
    // report also returns fillId 555. Must reconstruct once, not twice.
    const db = [
      dbFill({ id: "dbA", externalTradeId: "554", side: "BUY", quantity: "1", price: "20000", occurredAt: new Date("2026-06-02T14:00:00Z") }),
      dbFill({ id: "dbB", externalTradeId: "555", side: "SELL", quantity: "1", price: "20001.5", occurredAt: new Date("2026-06-02T14:05:00Z") }),
    ];
    const report = historicalFillsToFillInputs([
      reportRow({ fillId: "554", side: "BUY", quantity: 1, price: 20000, timestamp: "2026-06-02T14:00:00.000Z" }),
      reportRow({ fillId: "555", side: "SELL", quantity: 1, price: 20001.5, timestamp: "2026-06-02T14:05:00.000Z" }),
    ]);
    const trades = reconstructMergedTrades(db, report);
    assert.equal(trades.length, 1, "duplicate fills must not double the trade");
  });

  it("keeps report fills that have no DB counterpart", () => {
    const db = [
      dbFill({ id: "dbB", externalTradeId: "555", side: "SELL", quantity: "1", price: "20001.5", occurredAt: new Date("2026-06-02T14:05:00Z") }),
      dbFill({ id: "dbA", externalTradeId: "554", side: "BUY", quantity: "1", price: "20000", occurredAt: new Date("2026-06-02T14:00:00Z") }),
    ];
    // Apr 30 trade only the report knows about.
    const report = historicalFillsToFillInputs([
      reportRow({ fillId: "1", side: "BUY", quantity: 1, price: 21000, timestamp: "2026-04-30T09:31:00.000Z" }),
      reportRow({ fillId: "2", side: "SELL", quantity: 1, price: 20950, timestamp: "2026-04-30T09:45:00.000Z" }),
    ]);
    const trades = reconstructMergedTrades(db, report);
    assert.equal(trades.length, 2, "Jun 2 (DB) + Apr 30 (report) = 2 trades");
  });

  it("does not invent trades when there are no fills at all", () => {
    assert.deepEqual(reconstructMergedTrades([], []), []);
  });
});
