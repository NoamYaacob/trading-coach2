import { describe, it, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { backfillFillFees } from "./fill-fee-backfill.ts";

// Minimal stubs
function makeClient(fees: Map<number, number>) {
  return {
    getFillFeesByFillId: async () => fees,
  } as never;
}

function makePrisma(rows: Array<{ id: string; externalTradeId: string; rawPayload: unknown }>) {
  const updated: Array<{ id: string; data: unknown }> = [];
  return {
    _updated: updated,
    normalizedTradeEvent: {
      findMany: async ({ where }: { where: { accountId: string; externalTradeId: { in: string[] } } }) => {
        return rows.filter((r) => where.externalTradeId.in.includes(r.externalTradeId));
      },
      update: async ({ where, data }: { where: { id: string }; data: unknown }) => {
        updated.push({ id: where.id, data });
        const row = rows.find((r) => r.id === where.id);
        if (row) row.rawPayload = (data as { rawPayload: unknown }).rawPayload;
      },
    },
  } as never;
}

describe("backfillFillFees", () => {
  it("returns zeros when fee map is empty", async () => {
    const prisma = makePrisma([]);
    const result = await backfillFillFees("acct-1", makeClient(new Map()), prisma);
    assert.deepEqual(result, { updated: 0, skipped: 0, total: 0 });
  });

  it("updates a fill that is missing commission (dry_run=false)", async () => {
    const rows = [
      { id: "row-1", externalTradeId: "42", rawPayload: { symbol: "MNQM6", orderId: "ord-1" } },
    ];
    const prisma = makePrisma(rows);
    const feeMap = new Map([[42, 1.9]]);

    const result = await backfillFillFees("acct-1", makeClient(feeMap), prisma, { dryRun: false });

    assert.equal(result.updated, 1);
    assert.equal(result.skipped, 0);
    assert.equal(result.total, 1);
    assert.equal(prisma._updated.length, 1);
    assert.deepEqual(prisma._updated[0]!.id, "row-1");
    const payload = (prisma._updated[0]!.data as { rawPayload: unknown }).rawPayload as Record<string, unknown>;
    assert.equal(payload.commission, 1.9);
    assert.equal(payload.symbol, "MNQM6");
    assert.equal(payload.orderId, "ord-1");
  });

  it("skips a fill whose commission is already correct (idempotent)", async () => {
    const rows = [
      { id: "row-1", externalTradeId: "42", rawPayload: { symbol: "MNQM6", orderId: "ord-1", commission: 1.9 } },
    ];
    const prisma = makePrisma(rows);
    const feeMap = new Map([[42, 1.9]]);

    const result = await backfillFillFees("acct-1", makeClient(feeMap), prisma, { dryRun: false });

    assert.equal(result.updated, 0);
    assert.equal(result.skipped, 1);
    assert.equal(prisma._updated.length, 0);
  });

  it("updates a fill whose commission differs from the new value", async () => {
    const rows = [
      { id: "row-1", externalTradeId: "42", rawPayload: { symbol: "MNQM6", commission: 1.5 } },
    ];
    const prisma = makePrisma(rows);
    const feeMap = new Map([[42, 1.9]]);

    const result = await backfillFillFees("acct-1", makeClient(feeMap), prisma, { dryRun: false });

    assert.equal(result.updated, 1);
    const payload = (prisma._updated[0]!.data as { rawPayload: unknown }).rawPayload as Record<string, unknown>;
    assert.equal(payload.commission, 1.9);
  });

  it("dry_run does not call update", async () => {
    const rows = [
      { id: "row-1", externalTradeId: "42", rawPayload: { symbol: "MNQM6" } },
    ];
    const prisma = makePrisma(rows);
    const feeMap = new Map([[42, 1.9]]);

    const result = await backfillFillFees("acct-1", makeClient(feeMap), prisma, { dryRun: true });

    assert.equal(result.updated, 1, "dry run still counts what would be updated");
    assert.equal(prisma._updated.length, 0, "no actual DB writes in dry run");
  });

  it("1868411 scenario: gross=+1.50 fill, fee=1.90 → after backfill commission=1.90, net=-0.40", async () => {
    const rows = [
      { id: "row-1868411", externalTradeId: "1868411", rawPayload: { symbol: "MNQM6", orderId: "ord-x" } },
    ];
    const prisma = makePrisma(rows);
    const feeMap = new Map([[1868411, 1.9]]);

    await backfillFillFees("acct-x", makeClient(feeMap), prisma, { dryRun: false });

    const payload = rows[0]!.rawPayload as Record<string, unknown>;
    assert.equal(payload.commission, 1.9);

    // Verify the net P&L calculation externally:
    const grossPnl = 1.5;
    const fees = payload.commission as number;
    const netPnl = grossPnl - fees;
    assert.ok(Math.abs(netPnl - -0.4) < 1e-9, `net should be -0.40, got ${netPnl}`);
  });

  it("does not create new rows — only updates existing", async () => {
    // If fillFee/list has IDs not in the DB, no rows are inserted
    const rows = [
      { id: "row-1", externalTradeId: "99", rawPayload: { symbol: "ESH5" } },
    ];
    const prisma = makePrisma(rows);
    // fee map has fill 100 (no DB match) and fill 99 (has DB match)
    const feeMap = new Map([[100, 2.5], [99, 1.0]]);

    const result = await backfillFillFees("acct-1", makeClient(feeMap), prisma, { dryRun: false });

    assert.equal(result.total, 1, "only 1 DB row matched");
    assert.equal(result.updated, 1);
    assert.equal(prisma._updated.length, 1);
    // fill 100 was in fee map but had no DB row — it should NOT have been inserted
  });
});
