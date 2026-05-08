import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  decidePendingPromotion,
  promotePendingRules,
  type PromotionSummary,
} from "./pending-rule-promoter.ts";

// ─── decidePendingPromotion (pure) ────────────────────────────────────────────

describe("decidePendingPromotion — skip cases", () => {
  test("skip when pendingPayloadJson is null", () => {
    const d = decidePendingPromotion(
      { pendingPayloadJson: null, pendingEffectiveDate: "2026-05-09" },
      "2026-05-09",
    );
    assert.equal(d.kind, "skip");
    if (d.kind === "skip") assert.equal(d.reason, "no_pending");
  });

  test("skip when pendingEffectiveDate is null", () => {
    const d = decidePendingPromotion(
      { pendingPayloadJson: { maxDailyLoss: "500" }, pendingEffectiveDate: null },
      "2026-05-09",
    );
    assert.equal(d.kind, "skip");
    if (d.kind === "skip") assert.equal(d.reason, "no_pending");
  });

  test("skip 'future' when effective date is later than today's CME key", () => {
    const d = decidePendingPromotion(
      { pendingPayloadJson: { maxDailyLoss: "500" }, pendingEffectiveDate: "2026-05-10" },
      "2026-05-09",
    );
    assert.equal(d.kind, "skip");
    if (d.kind === "skip") assert.equal(d.reason, "future");
  });

  test("skip 'invalid_date' when effective date is not YYYY-MM-DD", () => {
    const d = decidePendingPromotion(
      { pendingPayloadJson: { maxDailyLoss: "500" }, pendingEffectiveDate: "tomorrow" },
      "2026-05-09",
    );
    assert.equal(d.kind, "skip");
    if (d.kind === "skip") assert.equal(d.reason, "invalid_date");
  });

  test("skip 'invalid_payload' when payload is an array", () => {
    const d = decidePendingPromotion(
      { pendingPayloadJson: ["a", "b"], pendingEffectiveDate: "2026-05-09" },
      "2026-05-09",
    );
    assert.equal(d.kind, "skip");
    if (d.kind === "skip") assert.equal(d.reason, "invalid_payload");
  });

  test("skip 'invalid_payload' when payload is a string (corruption)", () => {
    const d = decidePendingPromotion(
      { pendingPayloadJson: "oops", pendingEffectiveDate: "2026-05-09" },
      "2026-05-09",
    );
    assert.equal(d.kind, "skip");
    if (d.kind === "skip") assert.equal(d.reason, "invalid_payload");
  });
});

describe("decidePendingPromotion — promote", () => {
  test("promotes when CME day key equals effective date", () => {
    const d = decidePendingPromotion(
      { pendingPayloadJson: { maxDailyLoss: "500", maxTradesPerDay: 5 }, pendingEffectiveDate: "2026-05-09" },
      "2026-05-09",
    );
    assert.equal(d.kind, "promote");
    if (d.kind === "promote") {
      assert.equal(d.updates.maxDailyLoss, "500");
      assert.equal(d.updates.maxTradesPerDay, 5);
    }
  });

  test("promotes when CME day key is later than effective date", () => {
    const d = decidePendingPromotion(
      { pendingPayloadJson: { maxDailyLoss: "500" }, pendingEffectiveDate: "2026-05-09" },
      "2026-05-15",
    );
    assert.equal(d.kind, "promote");
  });

  test("strips pendingPayloadJson and pendingEffectiveDate keys defensively", () => {
    const d = decidePendingPromotion(
      {
        pendingPayloadJson: {
          maxDailyLoss: "500",
          pendingPayloadJson: { evil: true },
          pendingEffectiveDate: "should-not-leak",
        },
        pendingEffectiveDate: "2026-05-09",
      },
      "2026-05-09",
    );
    assert.equal(d.kind, "promote");
    if (d.kind === "promote") {
      assert.ok(!Object.prototype.hasOwnProperty.call(d.updates, "pendingPayloadJson"));
      assert.ok(!Object.prototype.hasOwnProperty.call(d.updates, "pendingEffectiveDate"));
      assert.equal(d.updates.maxDailyLoss, "500");
    }
  });

  test("hydrates automatedActionsConsentAt ISO string back to Date", () => {
    const iso = "2026-05-08T14:30:00.000Z";
    const d = decidePendingPromotion(
      {
        pendingPayloadJson: { maxDailyLoss: "500", automatedActionsConsentAt: iso },
        pendingEffectiveDate: "2026-05-09",
      },
      "2026-05-09",
    );
    assert.equal(d.kind, "promote");
    if (d.kind === "promote") {
      assert.ok(d.updates.automatedActionsConsentAt instanceof Date);
      assert.equal((d.updates.automatedActionsConsentAt as Date).toISOString(), iso);
    }
  });

  test("drops automatedActionsConsentAt if the stored ISO is invalid", () => {
    const d = decidePendingPromotion(
      {
        pendingPayloadJson: { maxDailyLoss: "500", automatedActionsConsentAt: "not-a-date" },
        pendingEffectiveDate: "2026-05-09",
      },
      "2026-05-09",
    );
    assert.equal(d.kind, "promote");
    if (d.kind === "promote") {
      assert.ok(!Object.prototype.hasOwnProperty.call(d.updates, "automatedActionsConsentAt"));
    }
  });
});

describe("decidePendingPromotion — delete_override", () => {
  test("returns delete_override when payload is { __delete: true }", () => {
    const d = decidePendingPromotion(
      { pendingPayloadJson: { __delete: true }, pendingEffectiveDate: "2026-05-09" },
      "2026-05-09",
    );
    assert.equal(d.kind, "delete_override");
  });

  test("does NOT return delete_override before effective date", () => {
    const d = decidePendingPromotion(
      { pendingPayloadJson: { __delete: true }, pendingEffectiveDate: "2026-06-01" },
      "2026-05-09",
    );
    assert.equal(d.kind, "skip");
  });

  test("ignores __delete:false and treats payload as a normal promotion", () => {
    const d = decidePendingPromotion(
      { pendingPayloadJson: { __delete: false, maxDailyLoss: "500" }, pendingEffectiveDate: "2026-05-09" },
      "2026-05-09",
    );
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

/**
 * Build a fake Prisma client over in-memory arrays. We track every update /
 * delete call so tests can assert isolation, idempotency, and that the
 * helper never wrote outside the row it was scoped to.
 */
function makeFakePrisma(opts: {
  accountRows?: AccountRow[];
  defaultRows?: DefaultRow[];
  failOn?: { table: "account" | "default"; id: string };
}) {
  const accountRows = (opts.accountRows ?? []).map((r) => ({ ...r }));
  const defaultRows = (opts.defaultRows ?? []).map((r) => ({ ...r }));
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
          // Simulate Prisma.JsonNull semantics for the in-memory store: any
          // explicit null on the JSON column counts as "cleared".
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
  };
  return { prisma, accountRows, defaultRows, accountUpdates, accountDeletes, defaultUpdates };
}

// "now" deep inside Tuesday's CME session: 18:00 CT 2026-05-12 = 2026-05-12 23:00Z (CDT, UTC-5).
// CME trading-day key for that instant is "2026-05-12".
const NOW_TUE_18CT = new Date("2026-05-12T23:00:00.000Z");

describe("promotePendingRules — promotion paths", () => {
  test("promotes account row whose effective date has been reached", async () => {
    const { prisma, accountRows, accountUpdates } = makeFakePrisma({
      accountRows: [
        {
          accountId: "acct-A",
          pendingPayloadJson: { maxDailyLoss: "500", maxTradesPerDay: 3, allowedEndHour: 16 },
          pendingEffectiveDate: "2026-05-12",
        },
      ],
    });
    const summary = await promotePendingRules(prisma, NOW_TUE_18CT);
    assert.equal(summary.promotedAccountCount, 1);
    assert.equal(summary.promotedDefaultCount, 0);
    assert.equal(summary.failedCount, 0);
    // The active update spreads pending values AND clears the pending columns.
    assert.equal(accountUpdates.length, 1);
    assert.equal(accountUpdates[0].data.maxDailyLoss, "500");
    assert.equal(accountUpdates[0].data.maxTradesPerDay, 3);
    assert.equal(accountUpdates[0].data.allowedEndHour, 16);
    assert.equal(accountUpdates[0].data.pendingEffectiveDate, null);
    // After promotion the row's pending columns are cleared.
    assert.equal(accountRows[0].pendingPayloadJson, null);
    assert.equal(accountRows[0].pendingEffectiveDate, null);
  });

  test("promotes default row whose effective date has been reached", async () => {
    const { prisma, defaultUpdates } = makeFakePrisma({
      defaultRows: [
        {
          userId: "user-1",
          pendingPayloadJson: { maxDailyLoss: "1000", dailyProfitTarget: "2000" },
          pendingEffectiveDate: "2026-05-12",
        },
      ],
    });
    const summary = await promotePendingRules(prisma, NOW_TUE_18CT);
    assert.equal(summary.promotedDefaultCount, 1);
    assert.equal(summary.promotedAccountCount, 0);
    assert.equal(defaultUpdates[0].data.maxDailyLoss, "1000");
    assert.equal(defaultUpdates[0].data.dailyProfitTarget, "2000");
    assert.equal(defaultUpdates[0].data.pendingEffectiveDate, null);
  });

  test("removes account override when payload is { __delete: true }", async () => {
    const { prisma, accountDeletes, accountRows } = makeFakePrisma({
      accountRows: [
        {
          accountId: "acct-X",
          pendingPayloadJson: { __delete: true },
          pendingEffectiveDate: "2026-05-12",
        },
      ],
    });
    const summary = await promotePendingRules(prisma, NOW_TUE_18CT);
    assert.equal(summary.promotedAccountCount, 1);
    assert.deepEqual(accountDeletes, ["acct-X"]);
    assert.equal(accountRows.length, 0, "row was deleted");
  });
});

describe("promotePendingRules — skip / future / idempotency", () => {
  test("skips rows whose effective date is still in the future", async () => {
    const { prisma, accountUpdates } = makeFakePrisma({
      accountRows: [
        {
          accountId: "acct-future",
          pendingPayloadJson: { maxDailyLoss: "500" },
          pendingEffectiveDate: "2099-12-31",
        },
      ],
    });
    const summary = await promotePendingRules(prisma, NOW_TUE_18CT);
    assert.equal(summary.promotedAccountCount, 0);
    assert.equal(summary.skippedCount, 1);
    assert.equal(accountUpdates.length, 0);
  });

  test("idempotent: a second run after promotion is a no-op", async () => {
    const { prisma } = makeFakePrisma({
      accountRows: [
        {
          accountId: "acct-A",
          pendingPayloadJson: { maxDailyLoss: "500" },
          pendingEffectiveDate: "2026-05-12",
        },
      ],
    });
    const first = await promotePendingRules(prisma, NOW_TUE_18CT);
    assert.equal(first.promotedAccountCount, 1);
    const second = await promotePendingRules(prisma, NOW_TUE_18CT);
    assert.equal(second.promotedAccountCount, 0);
    assert.equal(second.skippedCount, 0, "the cleared row falls out of the findMany filter");
  });

  test("skips default-template row carrying __delete payload (no delete path for defaults)", async () => {
    const { prisma, defaultUpdates } = makeFakePrisma({
      defaultRows: [
        {
          userId: "user-evil",
          pendingPayloadJson: { __delete: true },
          pendingEffectiveDate: "2026-05-12",
        },
      ],
    });
    const summary = await promotePendingRules(prisma, NOW_TUE_18CT);
    assert.equal(summary.promotedDefaultCount, 0);
    assert.equal(summary.skippedCount, 1);
    assert.equal(defaultUpdates.length, 0);
  });
});

describe("promotePendingRules — isolation guarantees", () => {
  test("Account A promotion does not affect Account B", async () => {
    const { prisma, accountUpdates, accountRows } = makeFakePrisma({
      accountRows: [
        {
          accountId: "acct-A",
          pendingPayloadJson: { maxDailyLoss: "500" },
          pendingEffectiveDate: "2026-05-12",
        },
        {
          accountId: "acct-B",
          pendingPayloadJson: { maxDailyLoss: "999" },
          pendingEffectiveDate: "2099-12-31",
        },
      ],
    });
    await promotePendingRules(prisma, NOW_TUE_18CT);
    // Only A was updated; B's pending payload is intact for a future run.
    assert.deepEqual(
      accountUpdates.map((u) => u.accountId),
      ["acct-A"],
    );
    const b = accountRows.find((r) => r.accountId === "acct-B");
    assert.deepEqual(b?.pendingPayloadJson, { maxDailyLoss: "999" });
    assert.equal(b?.pendingEffectiveDate, "2099-12-31");
  });

  test("default-template promotion does not touch any account override", async () => {
    const { prisma, accountUpdates, defaultUpdates } = makeFakePrisma({
      accountRows: [
        {
          accountId: "acct-A",
          pendingPayloadJson: { maxDailyLoss: "500" },
          pendingEffectiveDate: "2099-12-31", // not yet eligible
        },
      ],
      defaultRows: [
        {
          userId: "user-1",
          pendingPayloadJson: { maxDailyLoss: "1000" },
          pendingEffectiveDate: "2026-05-12",
        },
      ],
    });
    const summary = await promotePendingRules(prisma, NOW_TUE_18CT);
    assert.equal(summary.promotedDefaultCount, 1);
    assert.equal(summary.promotedAccountCount, 0);
    assert.equal(accountUpdates.length, 0, "no account override was touched");
    assert.equal(defaultUpdates.length, 1);
  });

  test("account override promotion does not touch the default template", async () => {
    const { prisma, defaultUpdates, accountUpdates } = makeFakePrisma({
      accountRows: [
        {
          accountId: "acct-A",
          pendingPayloadJson: { maxDailyLoss: "500" },
          pendingEffectiveDate: "2026-05-12",
        },
      ],
      defaultRows: [
        {
          userId: "user-1",
          pendingPayloadJson: { maxDailyLoss: "1000" },
          pendingEffectiveDate: "2099-12-31", // not yet eligible
        },
      ],
    });
    await promotePendingRules(prisma, NOW_TUE_18CT);
    assert.equal(accountUpdates.length, 1);
    assert.equal(defaultUpdates.length, 0, "no default template row was touched");
  });
});

describe("promotePendingRules — failure handling", () => {
  test("a failing row does NOT clear its pending payload; other rows still promote", async () => {
    const { prisma, accountRows, accountUpdates } = makeFakePrisma({
      accountRows: [
        {
          accountId: "acct-fails",
          pendingPayloadJson: { maxDailyLoss: "500" },
          pendingEffectiveDate: "2026-05-12",
        },
        {
          accountId: "acct-ok",
          pendingPayloadJson: { maxDailyLoss: "750" },
          pendingEffectiveDate: "2026-05-12",
        },
      ],
      failOn: { table: "account", id: "acct-fails" },
    });
    const summary = await promotePendingRules(prisma, NOW_TUE_18CT);
    assert.equal(summary.promotedAccountCount, 1);
    assert.equal(summary.failedCount, 1);
    assert.equal(summary.errors.length, 1);
    assert.equal(summary.errors[0].id, "acct-fails");
    // The failing row still has its pending payload intact for retry.
    const fails = accountRows.find((r) => r.accountId === "acct-fails");
    assert.deepEqual(fails?.pendingPayloadJson, { maxDailyLoss: "500" });
    assert.equal(fails?.pendingEffectiveDate, "2026-05-12");
    // The healthy row was promoted.
    const ok = accountRows.find((r) => r.accountId === "acct-ok");
    assert.equal(ok?.pendingPayloadJson, null);
    assert.deepEqual(
      accountUpdates.map((u) => u.accountId),
      ["acct-ok"],
    );
  });
});

// ─── No-Tradovate guarantee ───────────────────────────────────────────────────

describe("promotePendingRules — Tradovate isolation", () => {
  test("promotion does not invoke any broker client / Tradovate method", async () => {
    // The promoter receives only the rule tables. If a future change tried to
    // call a broker SDK from inside, it would either need a new dependency
    // injection or it would throw because the fake Prisma here exposes only
    // riskRules + accountRiskRules. The result is that we capture no
    // network or broker calls — verified by the fact that the test runs
    // without import-side-effects loading any Tradovate module.
    const { prisma, accountUpdates } = makeFakePrisma({
      accountRows: [
        {
          accountId: "acct-A",
          pendingPayloadJson: {
            maxDailyLoss: "500",
            dailyProfitTarget: "1000", // would be a broker risk-settings field on breach
          },
          pendingEffectiveDate: "2026-05-12",
        },
      ],
    });
    const summary: PromotionSummary = await promotePendingRules(prisma, NOW_TUE_18CT);
    assert.equal(summary.promotedAccountCount, 1);
    // Only one DB write per promoted row — no extra broker call accounted for.
    assert.equal(accountUpdates.length, 1);
  });
});
