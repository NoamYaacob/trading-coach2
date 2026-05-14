import test from "node:test";
import assert from "node:assert/strict";
import {
  isInvalidCmeHour,
  cleanupInvalidHours,
  type CleanupPrisma,
} from "./cleanup-invalid-hours.ts";

// ── isInvalidCmeHour ─────────────────────────────────────────────────────────

test("isInvalidCmeHour: null is always valid", () => {
  assert.equal(isInvalidCmeHour(null), false);
});

test("isInvalidCmeHour: 0 is valid", () => {
  assert.equal(isInvalidCmeHour(0), false);
});

test("isInvalidCmeHour: 23 is valid", () => {
  assert.equal(isInvalidCmeHour(23), false);
});

test("isInvalidCmeHour: 16 is valid (daily break hour)", () => {
  assert.equal(isInvalidCmeHour(16), false);
});

test("isInvalidCmeHour: -1 is invalid", () => {
  assert.equal(isInvalidCmeHour(-1), true);
});

test("isInvalidCmeHour: 24 is invalid", () => {
  assert.equal(isInvalidCmeHour(24), true);
});

test("isInvalidCmeHour: 123 is invalid (the production allowedEndHour bug)", () => {
  assert.equal(isInvalidCmeHour(123), true);
});

test("isInvalidCmeHour: 100 is invalid", () => {
  assert.equal(isInvalidCmeHour(100), true);
});

// ── cleanupInvalidHours ──────────────────────────────────────────────────────

function makeClient(
  riskRows: { userId: string; sessionStartHour: number | null; sessionEndHour: number | null }[],
  accountRows: { accountId: string; allowedStartHour: number | null; allowedEndHour: number | null }[],
): { prisma: CleanupPrisma; riskUpdates: Map<string, Record<string, unknown>>; accountUpdates: Map<string, Record<string, unknown>> } {
  const riskUpdates = new Map<string, Record<string, unknown>>();
  const accountUpdates = new Map<string, Record<string, unknown>>();
  const prisma: CleanupPrisma = {
    riskRules: {
      findMany: async () => riskRows,
      update: async ({ where, data }) => {
        riskUpdates.set(where.userId, data);
        return {};
      },
    },
    accountRiskRules: {
      findMany: async () => accountRows,
      update: async ({ where, data }) => {
        accountUpdates.set(where.accountId, data);
        return {};
      },
    },
  };
  return { prisma, riskUpdates, accountUpdates };
}

test("cleanupInvalidHours: no rows → zero results", async () => {
  const { prisma } = makeClient([], []);
  const result = await cleanupInvalidHours(prisma);
  assert.equal(result.found.length, 0);
  assert.equal(result.clearedCount, 0);
});

test("cleanupInvalidHours: valid hours are NOT updated", async () => {
  const { prisma, riskUpdates, accountUpdates } = makeClient(
    [{ userId: "u1", sessionStartHour: 9, sessionEndHour: 16 }],
    [{ accountId: "a1", allowedStartHour: 0, allowedEndHour: 23 }],
  );
  const result = await cleanupInvalidHours(prisma);
  assert.equal(result.found.length, 0);
  assert.equal(result.clearedCount, 0);
  assert.equal(riskUpdates.size, 0);
  assert.equal(accountUpdates.size, 0);
});

test("cleanupInvalidHours: null hours are NOT updated", async () => {
  const { prisma, riskUpdates, accountUpdates } = makeClient(
    [{ userId: "u1", sessionStartHour: null, sessionEndHour: null }],
    [{ accountId: "a1", allowedStartHour: null, allowedEndHour: null }],
  );
  const result = await cleanupInvalidHours(prisma);
  assert.equal(result.found.length, 0);
  assert.equal(result.clearedCount, 0);
  assert.equal(riskUpdates.size, 0);
  assert.equal(accountUpdates.size, 0);
});

test("cleanupInvalidHours: allowedEndHour=123 is found and nulled (production bug)", async () => {
  const { prisma, accountUpdates } = makeClient(
    [],
    [{ accountId: "noam-1868411", allowedStartHour: null, allowedEndHour: 123 }],
  );
  const result = await cleanupInvalidHours(prisma);
  assert.equal(result.found.length, 1);
  assert.deepEqual(result.found[0], {
    table: "AccountRiskRules",
    id: "noam-1868411",
    column: "allowedEndHour",
    value: 123,
  });
  assert.equal(result.clearedCount, 1);
  assert.deepEqual(accountUpdates.get("noam-1868411"), { allowedEndHour: null });
});

test("cleanupInvalidHours: sessionEndHour=99 on RiskRules is found and nulled", async () => {
  const { prisma, riskUpdates } = makeClient(
    [{ userId: "u1", sessionStartHour: null, sessionEndHour: 99 }],
    [],
  );
  const result = await cleanupInvalidHours(prisma);
  assert.equal(result.found.length, 1);
  assert.deepEqual(result.found[0], {
    table: "RiskRules",
    id: "u1",
    column: "sessionEndHour",
    value: 99,
  });
  assert.equal(result.clearedCount, 1);
  assert.deepEqual(riskUpdates.get("u1"), { sessionEndHour: null });
});

test("cleanupInvalidHours: multiple invalid columns in same row are all cleared", async () => {
  const { prisma, accountUpdates } = makeClient(
    [],
    [{ accountId: "a1", allowedStartHour: -5, allowedEndHour: 100 }],
  );
  const result = await cleanupInvalidHours(prisma);
  assert.equal(result.found.length, 2);
  assert.equal(result.clearedCount, 2);
  assert.deepEqual(accountUpdates.get("a1"), { allowedStartHour: null, allowedEndHour: null });
});

test("cleanupInvalidHours: mix of valid and invalid across multiple rows", async () => {
  const { prisma, accountUpdates } = makeClient(
    [],
    [
      { accountId: "a1", allowedStartHour: 9, allowedEndHour: 123 },
      { accountId: "a2", allowedStartHour: null, allowedEndHour: 16 },
    ],
  );
  const result = await cleanupInvalidHours(prisma);
  assert.equal(result.found.length, 1);
  assert.equal(result.found[0].id, "a1");
  assert.equal(result.found[0].column, "allowedEndHour");
  assert.equal(result.clearedCount, 1);
  assert.deepEqual(accountUpdates.get("a1"), { allowedEndHour: null });
  assert.equal(accountUpdates.has("a2"), false);
});
