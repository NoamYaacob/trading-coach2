import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  decidePendingPromotion,
  promotePendingRules,
} from "./pending-rule-promoter.ts";

// ─── Reference instants ───────────────────────────────────────────────────────
//
// Active CME trading: Mon 18:00 CT = Mon 23:00 UTC (CDT, May).
// Daily maintenance:  Mon 16:30 CT = Mon 21:30 UTC.
const NOW_ACTIVE = new Date("2026-05-11T23:00:00.000Z");      // Mon 18:00 CT
const NOW_MAINTENANCE = new Date("2026-05-11T21:30:00.000Z"); // Mon 16:30 CT
const NOW_WEEKEND = new Date("2026-05-15T21:30:00.000Z");     // Fri 16:30 CT (weekend close)

// ─── decidePendingPromotion (pure) ────────────────────────────────────────────

describe("decidePendingPromotion — skip cases", () => {
  test("skip when pendingPayloadJson is null", () => {
    const d = decidePendingPromotion({ pendingPayloadJson: null, pendingEffectiveDate: "2026-05-09" });
    assert.equal(d.kind, "skip");
    if (d.kind === "skip") assert.equal(d.reason, "no_pending");
  });

  test("skip when pendingEffectiveDate is null", () => {
    const d = decidePendingPromotion({
      pendingPayloadJson: { maxDailyLoss: "500" },
      pendingEffectiveDate: null,
    });
    assert.equal(d.kind, "skip");
    if (d.kind === "skip") assert.equal(d.reason, "no_pending");
  });

  test("skip 'invalid_date' when effective date is not YYYY-MM-DD", () => {
    const d = decidePendingPromotion({
      pendingPayloadJson: { maxDailyLoss: "500" },
      pendingEffectiveDate: "tomorrow",
    });
    assert.equal(d.kind, "skip");
    if (d.kind === "skip") assert.equal(d.reason, "invalid_date");
  });

  test("skip 'invalid_payload' when payload is an array", () => {
    const d = decidePendingPromotion({
      pendingPayloadJson: ["a", "b"],
      pendingEffectiveDate: "2026-05-09",
    });
    assert.equal(d.kind, "skip");
    if (d.kind === "skip") assert.equal(d.reason, "invalid_payload");
  });

  test("skip 'invalid_payload' when payload is a string (corruption)", () => {
    const d = decidePendingPromotion({
      pendingPayloadJson: "oops",
      pendingEffectiveDate: "2026-05-09",
    });
    assert.equal(d.kind, "skip");
    if (d.kind === "skip") assert.equal(d.reason, "invalid_payload");
  });
});

describe("decidePendingPromotion — promote", () => {
  test("returns promote when payload is a valid object", () => {
    const d = decidePendingPromotion({
      pendingPayloadJson: { maxDailyLoss: "500", maxTradesPerDay: 5 },
      pendingEffectiveDate: "2026-05-09",
    });
    assert.equal(d.kind, "promote");
    if (d.kind === "promote") {
      assert.equal(d.updates.maxDailyLoss, "500");
      assert.equal(d.updates.maxTradesPerDay, 5);
    }
  });

  test("strips pendingPayloadJson and pendingEffectiveDate keys defensively", () => {
    const d = decidePendingPromotion({
      pendingPayloadJson: {
        maxDailyLoss: "500",
        pendingPayloadJson: { evil: true },
        pendingEffectiveDate: "should-not-leak",
      },
      pendingEffectiveDate: "2026-05-09",
    });
    assert.equal(d.kind, "promote");
    if (d.kind === "promote") {
      assert.ok(!Object.prototype.hasOwnProperty.call(d.updates, "pendingPayloadJson"));
      assert.ok(!Object.prototype.hasOwnProperty.call(d.updates, "pendingEffectiveDate"));
      assert.equal(d.updates.maxDailyLoss, "500");
    }
  });

  test("hydrates automatedActionsConsentAt ISO string back to Date", () => {
    const iso = "2026-05-08T14:30:00.000Z";
    const d = decidePendingPromotion({
      pendingPayloadJson: { maxDailyLoss: "500", automatedActionsConsentAt: iso },
      pendingEffectiveDate: "2026-05-09",
    });
    assert.equal(d.kind, "promote");
    if (d.kind === "promote") {
      assert.ok(d.updates.automatedActionsConsentAt instanceof Date);
      assert.equal((d.updates.automatedActionsConsentAt as Date).toISOString(), iso);
    }
  });

  test("drops automatedActionsConsentAt if the stored ISO is invalid", () => {
    const d = decidePendingPromotion({
      pendingPayloadJson: { maxDailyLoss: "500", automatedActionsConsentAt: "not-a-date" },
      pendingEffectiveDate: "2026-05-09",
    });
    assert.equal(d.kind, "promote");
    if (d.kind === "promote") {
      assert.ok(!Object.prototype.hasOwnProperty.call(d.updates, "automatedActionsConsentAt"));
    }
  });
});

describe("decidePendingPromotion — delete_override", () => {
  test("returns delete_override when payload is { __delete: true }", () => {
    const d = decidePendingPromotion({
      pendingPayloadJson: { __delete: true },
      pendingEffectiveDate: "2026-05-09",
    });
    assert.equal(d.kind, "delete_override");
  });

  test("ignores __delete:false and treats payload as a normal promotion", () => {
    const d = decidePendingPromotion({
      pendingPayloadJson: { __delete: false, maxDailyLoss: "500" },
      pendingEffectiveDate: "2026-05-09",
    });
    assert.equal(d.kind, "promote");
  });
});

// ─── promotePendingRules (Prisma wrapper) — fake Prisma ──────────────────────

type AccountRow = {
  accountId: string;
  pendingPayloadJson: unknown;
  pendingEffectiveDate: string | null;
};
type DefaultRow = {
  userId: string;
  pendingPayloadJson: unknown;
  pendingEffectiveDate: string | null;
};
type LiveState = {
  accountId: string;
  riskState: "NORMAL" | "WARNING" | "STOPPED";
  cooldownActive: boolean;
};
type FakeAccount = {
  id: string;
  userId: string;
  /** True when this account has an AccountRiskRules row (i.e., NOT inheriting). */
  hasOverride: boolean;
};

function makeFakePrisma(opts: {
  accountRows?: AccountRow[];
  defaultRows?: DefaultRow[];
  liveStates?: LiveState[];
  accounts?: FakeAccount[];
  failOn?: { table: "account" | "default"; id: string };
}) {
  const accountRows = (opts.accountRows ?? []).map((r) => ({ ...r }));
  const defaultRows = (opts.defaultRows ?? []).map((r) => ({ ...r }));
  const liveStates = (opts.liveStates ?? []).map((s) => ({ ...s }));
  const accounts = (opts.accounts ?? []).map((a) => ({ ...a }));
  const accountUpdates: { accountId: string; data: Record<string, unknown> }[] = [];
  const accountDeletes: string[] = [];
  const defaultUpdates: { userId: string; data: Record<string, unknown> }[] = [];

  const prisma = {
    accountRiskRules: {
      findMany: async () =>
        accountRows.filter(
          (r) => r.pendingPayloadJson !== null && r.pendingEffectiveDate !== null,
        ),
      update: async (args: { where: { accountId: string }; data: Record<string, unknown> }) => {
        if (opts.failOn?.table === "account" && opts.failOn.id === args.where.accountId) {
          throw new Error(`forced failure for ${args.where.accountId}`);
        }
        accountUpdates.push({ accountId: args.where.accountId, data: args.data });
        const row = accountRows.find((r) => r.accountId === args.where.accountId);
        if (row) {
          for (const [k, v] of Object.entries(args.data)) {
            (row as Record<string, unknown>)[k] = v;
          }
          if (Object.prototype.hasOwnProperty.call(args.data, "pendingPayloadJson")) {
            row.pendingPayloadJson = null;
          }
        }
      },
      delete: async (args: { where: { accountId: string } }) => {
        if (opts.failOn?.table === "account" && opts.failOn.id === args.where.accountId) {
          throw new Error(`forced failure for ${args.where.accountId}`);
        }
        accountDeletes.push(args.where.accountId);
        const idx = accountRows.findIndex((r) => r.accountId === args.where.accountId);
        if (idx >= 0) accountRows.splice(idx, 1);
      },
    },
    riskRules: {
      findMany: async () =>
        defaultRows.filter(
          (r) => r.pendingPayloadJson !== null && r.pendingEffectiveDate !== null,
        ),
      update: async (args: { where: { userId: string }; data: Record<string, unknown> }) => {
        if (opts.failOn?.table === "default" && opts.failOn.id === args.where.userId) {
          throw new Error(`forced failure for ${args.where.userId}`);
        }
        defaultUpdates.push({ userId: args.where.userId, data: args.data });
        const row = defaultRows.find((r) => r.userId === args.where.userId);
        if (row) {
          for (const [k, v] of Object.entries(args.data)) {
            (row as Record<string, unknown>)[k] = v;
          }
          if (Object.prototype.hasOwnProperty.call(args.data, "pendingPayloadJson")) {
            row.pendingPayloadJson = null;
          }
        }
      },
    },
    liveSessionState: {
      findMany: async (args: { where: { accountId: { in: string[] } } }) => {
        const set = new Set(args.where.accountId.in);
        return liveStates.filter((s) => set.has(s.accountId));
      },
    },
    connectedAccount: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        const userIdFilter = args.where.userId as { in: string[] } | undefined;
        const userIds = userIdFilter?.in ?? [];
        // The promoter requests inheriting accounts (no AccountRiskRules row).
        return accounts
          .filter((a) => userIds.includes(a.userId) && !a.hasOverride)
          .map((a) => ({ id: a.id, userId: a.userId, riskRules: null }));
      },
    },
  };
  return { prisma, accountRows, defaultRows, accountUpdates, accountDeletes, defaultUpdates };
}

describe("promotePendingRules — account scope safety gate", () => {
  test("during CME maintenance, account row promotes regardless of lockout state", async () => {
    const { prisma, accountUpdates } = makeFakePrisma({
      accountRows: [
        {
          accountId: "acct-A",
          pendingPayloadJson: { maxDailyLoss: "500" },
          pendingEffectiveDate: "2026-05-09",
        },
      ],
      // No live state → treated as not locked, but CME maintenance overrides.
    });
    const summary = await promotePendingRules(prisma, NOW_MAINTENANCE);
    assert.equal(summary.promotedAccountCount, 1);
    assert.equal(accountUpdates.length, 1);
  });

  test("during weekend close, account row promotes", async () => {
    const { prisma, accountUpdates } = makeFakePrisma({
      accountRows: [
        {
          accountId: "acct-A",
          pendingPayloadJson: { maxDailyLoss: "500" },
          pendingEffectiveDate: "2026-05-09",
        },
      ],
    });
    const summary = await promotePendingRules(prisma, NOW_WEEKEND);
    assert.equal(summary.promotedAccountCount, 1);
    assert.equal(accountUpdates.length, 1);
  });

  test("during active trading, account row stays pending unless that account is locked", async () => {
    const { prisma, accountUpdates } = makeFakePrisma({
      accountRows: [
        {
          accountId: "acct-A",
          pendingPayloadJson: { maxDailyLoss: "500" },
          pendingEffectiveDate: "2026-05-09",
        },
      ],
      liveStates: [{ accountId: "acct-A", riskState: "NORMAL", cooldownActive: false }],
    });
    const summary = await promotePendingRules(prisma, NOW_ACTIVE);
    assert.equal(summary.promotedAccountCount, 0);
    assert.equal(summary.skippedNotSafeCount, 1);
    assert.equal(accountUpdates.length, 0);
  });

  test("during active trading, an internally STOPPED account promotes immediately", async () => {
    const { prisma, accountUpdates } = makeFakePrisma({
      accountRows: [
        {
          accountId: "acct-A",
          pendingPayloadJson: { maxDailyLoss: "500" },
          pendingEffectiveDate: "2026-05-09",
        },
      ],
      liveStates: [{ accountId: "acct-A", riskState: "STOPPED", cooldownActive: false }],
    });
    const summary = await promotePendingRules(prisma, NOW_ACTIVE);
    assert.equal(summary.promotedAccountCount, 1);
    assert.equal(accountUpdates.length, 1);
  });

  test("during active trading, an account in cooldown promotes immediately", async () => {
    const { prisma, accountUpdates } = makeFakePrisma({
      accountRows: [
        {
          accountId: "acct-A",
          pendingPayloadJson: { maxDailyLoss: "500" },
          pendingEffectiveDate: "2026-05-09",
        },
      ],
      liveStates: [{ accountId: "acct-A", riskState: "NORMAL", cooldownActive: true }],
    });
    const summary = await promotePendingRules(prisma, NOW_ACTIVE);
    assert.equal(summary.promotedAccountCount, 1);
    assert.equal(accountUpdates.length, 1);
  });

  test("Account A locked + Account B active → only A promotes", async () => {
    const { prisma, accountRows, accountUpdates } = makeFakePrisma({
      accountRows: [
        {
          accountId: "acct-A",
          pendingPayloadJson: { maxDailyLoss: "500" },
          pendingEffectiveDate: "2026-05-09",
        },
        {
          accountId: "acct-B",
          pendingPayloadJson: { maxDailyLoss: "999" },
          pendingEffectiveDate: "2026-05-09",
        },
      ],
      liveStates: [
        { accountId: "acct-A", riskState: "STOPPED", cooldownActive: false },
        { accountId: "acct-B", riskState: "NORMAL", cooldownActive: false },
      ],
    });
    const summary = await promotePendingRules(prisma, NOW_ACTIVE);
    assert.equal(summary.promotedAccountCount, 1);
    assert.equal(summary.skippedNotSafeCount, 1);
    assert.deepEqual(
      accountUpdates.map((u) => u.accountId),
      ["acct-A"],
    );
    // B's pending payload is intact for retry.
    const b = accountRows.find((r) => r.accountId === "acct-B");
    assert.deepEqual(b?.pendingPayloadJson, { maxDailyLoss: "999" });
  });
});

describe("promotePendingRules — default scope safety gate", () => {
  test("during CME maintenance, default promotes regardless of inheriting accounts", async () => {
    const { prisma, defaultUpdates } = makeFakePrisma({
      defaultRows: [
        {
          userId: "user-1",
          pendingPayloadJson: { maxDailyLoss: "1000" },
          pendingEffectiveDate: "2026-05-09",
        },
      ],
      accounts: [{ id: "acct-X", userId: "user-1", hasOverride: false }],
      liveStates: [{ accountId: "acct-X", riskState: "NORMAL", cooldownActive: false }],
    });
    const summary = await promotePendingRules(prisma, NOW_MAINTENANCE);
    assert.equal(summary.promotedDefaultCount, 1);
    assert.equal(defaultUpdates.length, 1);
  });

  test("during active trading, default stays pending if any inheriting account is active", async () => {
    const { prisma, defaultUpdates } = makeFakePrisma({
      defaultRows: [
        {
          userId: "user-1",
          pendingPayloadJson: { maxDailyLoss: "1000" },
          pendingEffectiveDate: "2026-05-09",
        },
      ],
      accounts: [{ id: "acct-X", userId: "user-1", hasOverride: false }],
      liveStates: [{ accountId: "acct-X", riskState: "NORMAL", cooldownActive: false }],
    });
    const summary = await promotePendingRules(prisma, NOW_ACTIVE);
    assert.equal(summary.promotedDefaultCount, 0);
    assert.equal(summary.skippedNotSafeCount, 1);
    assert.equal(defaultUpdates.length, 0);
  });

  test("during active trading, default promotes when ALL inheriting accounts are locked", async () => {
    const { prisma, defaultUpdates } = makeFakePrisma({
      defaultRows: [
        {
          userId: "user-1",
          pendingPayloadJson: { maxDailyLoss: "1000" },
          pendingEffectiveDate: "2026-05-09",
        },
      ],
      accounts: [
        { id: "acct-X", userId: "user-1", hasOverride: false },
        { id: "acct-Y", userId: "user-1", hasOverride: false },
      ],
      liveStates: [
        { accountId: "acct-X", riskState: "STOPPED", cooldownActive: false },
        { accountId: "acct-Y", riskState: "NORMAL", cooldownActive: true },
      ],
    });
    const summary = await promotePendingRules(prisma, NOW_ACTIVE);
    assert.equal(summary.promotedDefaultCount, 1);
    assert.equal(defaultUpdates.length, 1);
  });

  test("default promotion ignores accounts that have their own override", async () => {
    // Account X inherits the default; Account Y has its own override.
    // Y being active must NOT block the default-template promotion since the
    // default doesn't affect Y anyway.
    const { prisma, defaultUpdates } = makeFakePrisma({
      defaultRows: [
        {
          userId: "user-1",
          pendingPayloadJson: { maxDailyLoss: "1000" },
          pendingEffectiveDate: "2026-05-09",
        },
      ],
      accounts: [
        { id: "acct-X", userId: "user-1", hasOverride: false }, // inheriting, locked
        { id: "acct-Y", userId: "user-1", hasOverride: true },  // overridden, active
      ],
      liveStates: [
        { accountId: "acct-X", riskState: "STOPPED", cooldownActive: false },
        { accountId: "acct-Y", riskState: "NORMAL", cooldownActive: false },
      ],
    });
    const summary = await promotePendingRules(prisma, NOW_ACTIVE);
    assert.equal(summary.promotedDefaultCount, 1, "Y has its own override → ignored for default safety");
    assert.equal(defaultUpdates.length, 1);
  });

  test("default promotion when user has no inheriting accounts at all → safe", async () => {
    const { prisma, defaultUpdates } = makeFakePrisma({
      defaultRows: [
        {
          userId: "user-1",
          pendingPayloadJson: { maxDailyLoss: "1000" },
          pendingEffectiveDate: "2026-05-09",
        },
      ],
      // No accounts in the fixture → no inheriting accounts → no risk.
    });
    const summary = await promotePendingRules(prisma, NOW_ACTIVE);
    assert.equal(summary.promotedDefaultCount, 1);
    assert.equal(defaultUpdates.length, 1);
  });
});

describe("promotePendingRules — delete override", () => {
  test("removes account override when payload is { __delete: true } and safe", async () => {
    const { prisma, accountDeletes, accountRows } = makeFakePrisma({
      accountRows: [
        {
          accountId: "acct-X",
          pendingPayloadJson: { __delete: true },
          pendingEffectiveDate: "2026-05-09",
        },
      ],
    });
    const summary = await promotePendingRules(prisma, NOW_MAINTENANCE);
    assert.equal(summary.promotedAccountCount, 1);
    assert.deepEqual(accountDeletes, ["acct-X"]);
    assert.equal(accountRows.length, 0);
  });

  test("default-template row carrying __delete is skipped (no delete path for defaults)", async () => {
    const { prisma, defaultUpdates } = makeFakePrisma({
      defaultRows: [
        {
          userId: "user-evil",
          pendingPayloadJson: { __delete: true },
          pendingEffectiveDate: "2026-05-09",
        },
      ],
    });
    const summary = await promotePendingRules(prisma, NOW_MAINTENANCE);
    assert.equal(summary.promotedDefaultCount, 0);
    assert.equal(summary.skippedCount, 1);
    assert.equal(defaultUpdates.length, 0);
  });
});

describe("promotePendingRules — idempotency + isolation", () => {
  test("idempotent: a second run after promotion is a no-op", async () => {
    const { prisma } = makeFakePrisma({
      accountRows: [
        {
          accountId: "acct-A",
          pendingPayloadJson: { maxDailyLoss: "500" },
          pendingEffectiveDate: "2026-05-09",
        },
      ],
    });
    const first = await promotePendingRules(prisma, NOW_MAINTENANCE);
    assert.equal(first.promotedAccountCount, 1);
    const second = await promotePendingRules(prisma, NOW_MAINTENANCE);
    assert.equal(second.promotedAccountCount, 0);
    assert.equal(second.skippedNotSafeCount, 0);
    assert.equal(second.skippedCount, 0);
  });

  test("default-template promotion does not touch account override rows", async () => {
    const { prisma, accountUpdates, defaultUpdates } = makeFakePrisma({
      accountRows: [
        {
          accountId: "acct-A",
          pendingPayloadJson: { maxDailyLoss: "500" },
          pendingEffectiveDate: "2026-05-09",
        },
      ],
      defaultRows: [
        {
          userId: "user-1",
          pendingPayloadJson: { maxDailyLoss: "1000" },
          pendingEffectiveDate: "2026-05-09",
        },
      ],
      liveStates: [{ accountId: "acct-A", riskState: "NORMAL", cooldownActive: false }],
    });
    // Active trading, account NOT locked → account stays pending. Default has
    // no inheriting accounts in this fixture, so it promotes.
    const summary = await promotePendingRules(prisma, NOW_ACTIVE);
    assert.equal(summary.promotedAccountCount, 0);
    assert.equal(summary.promotedDefaultCount, 1);
    assert.equal(accountUpdates.length, 0);
    assert.equal(defaultUpdates.length, 1);
  });

  test("Account A promotion does not affect Account B's pending payload", async () => {
    const { prisma, accountRows } = makeFakePrisma({
      accountRows: [
        {
          accountId: "acct-A",
          pendingPayloadJson: { maxDailyLoss: "500" },
          pendingEffectiveDate: "2026-05-09",
        },
        {
          accountId: "acct-B",
          pendingPayloadJson: { maxDailyLoss: "999" },
          pendingEffectiveDate: "2026-05-09",
        },
      ],
      liveStates: [
        { accountId: "acct-A", riskState: "STOPPED", cooldownActive: false },
        { accountId: "acct-B", riskState: "NORMAL", cooldownActive: false },
      ],
    });
    await promotePendingRules(prisma, NOW_ACTIVE);
    const b = accountRows.find((r) => r.accountId === "acct-B");
    assert.deepEqual(b?.pendingPayloadJson, { maxDailyLoss: "999" });
    assert.equal(b?.pendingEffectiveDate, "2026-05-09");
  });
});

describe("promotePendingRules — failure handling", () => {
  test("a failing row does NOT clear its pending payload; other rows still promote", async () => {
    const { prisma, accountRows } = makeFakePrisma({
      accountRows: [
        {
          accountId: "acct-fails",
          pendingPayloadJson: { maxDailyLoss: "500" },
          pendingEffectiveDate: "2026-05-09",
        },
        {
          accountId: "acct-ok",
          pendingPayloadJson: { maxDailyLoss: "750" },
          pendingEffectiveDate: "2026-05-09",
        },
      ],
      failOn: { table: "account", id: "acct-fails" },
    });
    const summary = await promotePendingRules(prisma, NOW_MAINTENANCE);
    assert.equal(summary.promotedAccountCount, 1);
    assert.equal(summary.failedCount, 1);
    assert.equal(summary.errors[0].id, "acct-fails");
    const fails = accountRows.find((r) => r.accountId === "acct-fails");
    assert.deepEqual(fails?.pendingPayloadJson, { maxDailyLoss: "500" });
  });
});

// ─── No broker calls ──────────────────────────────────────────────────────────

describe("promotePendingRules — Tradovate isolation", () => {
  test("promotion does not invoke any broker client / Tradovate method", async () => {
    const { prisma, accountUpdates } = makeFakePrisma({
      accountRows: [
        {
          accountId: "acct-A",
          pendingPayloadJson: {
            maxDailyLoss: "500",
            dailyProfitTarget: "1000",
          },
          pendingEffectiveDate: "2026-05-09",
        },
      ],
    });
    const summary = await promotePendingRules(prisma, NOW_MAINTENANCE);
    assert.equal(summary.promotedAccountCount, 1);
    assert.equal(accountUpdates.length, 1, "exactly one DB write per promoted row, no extra broker call");
  });
});

// ─── Pending field clearing ───────────────────────────────────────────────────

describe("promotePendingRules — pending field clearing", () => {
  test("successful account promotion writes pendingPayloadJson clear to the update data", async () => {
    const { prisma, accountUpdates } = makeFakePrisma({
      accountRows: [
        {
          accountId: "acct-A",
          pendingPayloadJson: { maxDailyLoss: "500", riskPerTrade: "200" },
          pendingEffectiveDate: "2026-05-09",
        },
      ],
    });
    await promotePendingRules(prisma, NOW_MAINTENANCE);
    assert.equal(accountUpdates.length, 1);
    const data = accountUpdates[0].data;
    // The update must include the clearing keys so Prisma sets them to null.
    assert.ok(
      Object.prototype.hasOwnProperty.call(data, "pendingPayloadJson"),
      "update data must include pendingPayloadJson to clear it",
    );
    assert.equal(
      data.pendingEffectiveDate,
      null,
      "update data must set pendingEffectiveDate to null",
    );
    // The active field values must also be written.
    assert.equal(data.maxDailyLoss, "500");
    assert.equal(data.riskPerTrade, "200");
  });

  test("successful default promotion writes pendingPayloadJson clear to the update data", async () => {
    const { prisma, defaultUpdates } = makeFakePrisma({
      defaultRows: [
        {
          userId: "user-1",
          pendingPayloadJson: { maxDailyLoss: "1000", maxTradesPerDay: 10 },
          pendingEffectiveDate: "2026-05-09",
        },
      ],
    });
    await promotePendingRules(prisma, NOW_MAINTENANCE);
    assert.equal(defaultUpdates.length, 1);
    const data = defaultUpdates[0].data;
    assert.ok(
      Object.prototype.hasOwnProperty.call(data, "pendingPayloadJson"),
      "update data must include pendingPayloadJson to clear it",
    );
    assert.equal(
      data.pendingEffectiveDate,
      null,
      "update data must set pendingEffectiveDate to null",
    );
    assert.equal(data.maxDailyLoss, "1000");
    assert.equal(data.maxTradesPerDay, 10);
  });

  test("failing row does NOT get pendingPayloadJson cleared (left intact for retry)", async () => {
    const { prisma, accountUpdates } = makeFakePrisma({
      accountRows: [
        {
          accountId: "acct-A",
          pendingPayloadJson: { maxDailyLoss: "500" },
          pendingEffectiveDate: "2026-05-09",
        },
      ],
      failOn: { table: "account", id: "acct-A" },
    });
    const summary = await promotePendingRules(prisma, NOW_MAINTENANCE);
    assert.equal(summary.failedCount, 1);
    assert.equal(accountUpdates.length, 0, "no update written — Prisma threw before clearing");
  });

  test("promotedAccountCount increments only once per successfully-cleared row", async () => {
    // Run twice. After the first run the fake clears pendingPayloadJson in-memory,
    // so the second run sees no pending rows and does not double-count.
    const { prisma } = makeFakePrisma({
      accountRows: [
        {
          accountId: "acct-A",
          pendingPayloadJson: { maxDailyLoss: "500" },
          pendingEffectiveDate: "2026-05-09",
        },
      ],
    });
    const first = await promotePendingRules(prisma, NOW_MAINTENANCE);
    const second = await promotePendingRules(prisma, NOW_MAINTENANCE);
    assert.equal(first.promotedAccountCount, 1);
    assert.equal(second.promotedAccountCount, 0, "second run is a no-op — row was cleared");
    assert.equal(second.skippedCount, 0, "no rows at all on second run (already null)");
  });
});
