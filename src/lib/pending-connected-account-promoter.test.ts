import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { promotePendingConnectedAccountProtection } from "./pending-connected-account-promoter.ts";

// ── Reference instants (CME / America/Chicago) ────────────────────────────────
// Trading day key for 2026-05-27 CT:
//   - any time on 2026-05-27 local CT (after 17:00 UTC-5 the previous day)
// Using 12:00 UTC = 07:00 CT on 2026-05-28 so todayKey = "2026-05-28"
const NOW = new Date("2026-05-28T12:00:00.000Z"); // todayKey = "2026-05-28"

// ── Mock helpers ──────────────────────────────────────────────────────────────

type FakeRow = {
  id: string;
  pendingProtectionStatus: string | null;
  pendingProtectionEffectiveDate: string | null;
  protectionStatus: string;
};

function makeFakePrisma(
  rows: FakeRow[],
  opts: { failOn?: string } = {},
) {
  const updates: { id: string; data: Record<string, unknown> }[] = [];

  const prisma = {
    connectedAccount: {
      findMany: async () =>
        rows
          .filter(
            (r) =>
              r.pendingProtectionStatus === "archived" &&
              r.pendingProtectionEffectiveDate !== null,
          )
          .map((r) => ({ id: r.id, pendingProtectionEffectiveDate: r.pendingProtectionEffectiveDate })),

      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        if (opts.failOn === args.where.id) {
          throw new Error(`forced failure for ${args.where.id}`);
        }
        updates.push({ id: args.where.id, data: args.data });
        const row = rows.find((r) => r.id === args.where.id);
        if (row) {
          if (Object.prototype.hasOwnProperty.call(args.data, "protectionStatus")) {
            row.protectionStatus = args.data.protectionStatus as string;
          }
          if (Object.prototype.hasOwnProperty.call(args.data, "pendingProtectionStatus")) {
            row.pendingProtectionStatus = args.data.pendingProtectionStatus as string | null;
          }
          if (Object.prototype.hasOwnProperty.call(args.data, "pendingProtectionEffectiveDate")) {
            row.pendingProtectionEffectiveDate = args.data.pendingProtectionEffectiveDate as string | null;
          }
        }
      },
    },
  };

  return { prisma, updates };
}

// ── Case A: eligible account is archived ──────────────────────────────────────

describe("promotePendingConnectedAccountProtection — eligible promotion", () => {
  test("archives account when effectiveDate <= todayKey", async () => {
    const rows: FakeRow[] = [
      {
        id: "acct-1",
        protectionStatus: "protected",
        pendingProtectionStatus: "archived",
        pendingProtectionEffectiveDate: "2026-05-28", // today
      },
    ];
    const { prisma, updates } = makeFakePrisma(rows);
    const summary = await promotePendingConnectedAccountProtection(prisma, NOW);

    assert.equal(summary.promotedCount, 1);
    assert.equal(summary.skippedFutureDateCount, 0);
    assert.equal(summary.failedCount, 0);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].id, "acct-1");
  });

  test("sets protectionStatus = 'archived' on promoted account", async () => {
    const rows: FakeRow[] = [
      {
        id: "acct-1",
        protectionStatus: "protected",
        pendingProtectionStatus: "archived",
        pendingProtectionEffectiveDate: "2026-05-27", // yesterday — past
      },
    ];
    const { prisma } = makeFakePrisma(rows);
    await promotePendingConnectedAccountProtection(prisma, NOW);

    assert.equal(rows[0].protectionStatus, "archived");
  });

  test("clears pendingProtectionStatus after promotion", async () => {
    const rows: FakeRow[] = [
      {
        id: "acct-1",
        protectionStatus: "protected",
        pendingProtectionStatus: "archived",
        pendingProtectionEffectiveDate: "2026-05-28",
      },
    ];
    const { prisma } = makeFakePrisma(rows);
    await promotePendingConnectedAccountProtection(prisma, NOW);

    assert.equal(rows[0].pendingProtectionStatus, null);
  });

  test("clears pendingProtectionEffectiveDate after promotion", async () => {
    const rows: FakeRow[] = [
      {
        id: "acct-1",
        protectionStatus: "protected",
        pendingProtectionStatus: "archived",
        pendingProtectionEffectiveDate: "2026-05-28",
      },
    ];
    const { prisma } = makeFakePrisma(rows);
    await promotePendingConnectedAccountProtection(prisma, NOW);

    assert.equal(rows[0].pendingProtectionEffectiveDate, null);
  });

  test("promotes all eligible accounts in a batch", async () => {
    const rows: FakeRow[] = [
      {
        id: "acct-1",
        protectionStatus: "protected",
        pendingProtectionStatus: "archived",
        pendingProtectionEffectiveDate: "2026-05-27",
      },
      {
        id: "acct-2",
        protectionStatus: "monitor_only",
        pendingProtectionStatus: "archived",
        pendingProtectionEffectiveDate: "2026-05-28",
      },
    ];
    const { prisma } = makeFakePrisma(rows);
    const summary = await promotePendingConnectedAccountProtection(prisma, NOW);

    assert.equal(summary.promotedCount, 2);
    assert.equal(summary.skippedFutureDateCount, 0);
    assert.equal(rows[0].protectionStatus, "archived");
    assert.equal(rows[1].protectionStatus, "archived");
  });
});

// ── Case B: future effective date is skipped ──────────────────────────────────

describe("promotePendingConnectedAccountProtection — future date skipped", () => {
  test("skips account when effectiveDate > todayKey", async () => {
    const rows: FakeRow[] = [
      {
        id: "acct-future",
        protectionStatus: "protected",
        pendingProtectionStatus: "archived",
        pendingProtectionEffectiveDate: "2026-05-29", // tomorrow
      },
    ];
    const { prisma, updates } = makeFakePrisma(rows);
    const summary = await promotePendingConnectedAccountProtection(prisma, NOW);

    assert.equal(summary.promotedCount, 0);
    assert.equal(summary.skippedFutureDateCount, 1);
    assert.equal(updates.length, 0, "must not write to a future-dated account");
  });

  test("protectionStatus unchanged for skipped account", async () => {
    const rows: FakeRow[] = [
      {
        id: "acct-future",
        protectionStatus: "protected",
        pendingProtectionStatus: "archived",
        pendingProtectionEffectiveDate: "2026-06-01",
      },
    ];
    const { prisma } = makeFakePrisma(rows);
    await promotePendingConnectedAccountProtection(prisma, NOW);

    assert.equal(rows[0].protectionStatus, "protected");
    assert.equal(rows[0].pendingProtectionStatus, "archived");
  });

  test("mixes eligible and future accounts correctly", async () => {
    const rows: FakeRow[] = [
      {
        id: "acct-past",
        protectionStatus: "protected",
        pendingProtectionStatus: "archived",
        pendingProtectionEffectiveDate: "2026-05-27",
      },
      {
        id: "acct-future",
        protectionStatus: "monitor_only",
        pendingProtectionStatus: "archived",
        pendingProtectionEffectiveDate: "2026-05-29",
      },
    ];
    const { prisma } = makeFakePrisma(rows);
    const summary = await promotePendingConnectedAccountProtection(prisma, NOW);

    assert.equal(summary.promotedCount, 1);
    assert.equal(summary.skippedFutureDateCount, 1);
    assert.equal(rows[0].protectionStatus, "archived");
    assert.equal(rows[1].protectionStatus, "monitor_only");
  });
});

// ── No-op cases ───────────────────────────────────────────────────────────────

describe("promotePendingConnectedAccountProtection — no-op cases", () => {
  test("returns zero counts when no pending archived accounts exist", async () => {
    const { prisma } = makeFakePrisma([]);
    const summary = await promotePendingConnectedAccountProtection(prisma, NOW);

    assert.equal(summary.promotedCount, 0);
    assert.equal(summary.skippedFutureDateCount, 0);
    assert.equal(summary.failedCount, 0);
  });

  test("ignores accounts with pendingProtectionStatus = null (already clean)", async () => {
    const rows: FakeRow[] = [
      {
        id: "acct-clean",
        protectionStatus: "protected",
        pendingProtectionStatus: null,
        pendingProtectionEffectiveDate: null,
      },
    ];
    const { prisma, updates } = makeFakePrisma(rows);
    const summary = await promotePendingConnectedAccountProtection(prisma, NOW);

    assert.equal(summary.promotedCount, 0);
    assert.equal(updates.length, 0);
  });

  test("ignores accounts with non-archived pending status", async () => {
    const rows: FakeRow[] = [
      {
        id: "acct-other",
        protectionStatus: "protected",
        pendingProtectionStatus: "monitor_only",
        pendingProtectionEffectiveDate: "2026-05-28",
      },
    ];
    const { prisma, updates } = makeFakePrisma(rows);
    const summary = await promotePendingConnectedAccountProtection(prisma, NOW);

    assert.equal(summary.promotedCount, 0);
    assert.equal(updates.length, 0);
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe("promotePendingConnectedAccountProtection — error handling", () => {
  test("continues promoting other accounts when one fails", async () => {
    const rows: FakeRow[] = [
      {
        id: "acct-bad",
        protectionStatus: "protected",
        pendingProtectionStatus: "archived",
        pendingProtectionEffectiveDate: "2026-05-28",
      },
      {
        id: "acct-good",
        protectionStatus: "monitor_only",
        pendingProtectionStatus: "archived",
        pendingProtectionEffectiveDate: "2026-05-28",
      },
    ];
    const { prisma } = makeFakePrisma(rows, { failOn: "acct-bad" });
    const summary = await promotePendingConnectedAccountProtection(prisma, NOW);

    assert.equal(summary.promotedCount, 1);
    assert.equal(summary.failedCount, 1);
    assert.equal(summary.errors.length, 1);
    assert.equal(summary.errors[0].id, "acct-bad");
    // The good account must still be promoted.
    assert.equal(rows[1].protectionStatus, "archived");
    // The bad account must keep its pending state for retry.
    assert.equal(rows[0].protectionStatus, "protected");
  });

  test("error record contains account id and message", async () => {
    const rows: FakeRow[] = [
      {
        id: "acct-err",
        protectionStatus: "protected",
        pendingProtectionStatus: "archived",
        pendingProtectionEffectiveDate: "2026-05-27",
      },
    ];
    const { prisma } = makeFakePrisma(rows, { failOn: "acct-err" });
    const summary = await promotePendingConnectedAccountProtection(prisma, NOW);

    assert.equal(summary.errors[0].id, "acct-err");
    assert.ok(summary.errors[0].message.includes("forced failure"));
  });
});

// ── Case C: source-scan — no forbidden table operations ──────────────────────

describe("pending-connected-account-promoter — safety: no forbidden deletes", () => {
  const src = readFileSync(
    resolve(import.meta.dirname, "pending-connected-account-promoter.ts"),
    "utf8",
  );

  for (const forbidden of [
    "normalizedTradeEvent",
    "accountRiskRules",
    "internalLockEvent",
    "guardianStatus",
    "brokerOrderActionLog",
    "ruleChangeAudit",
    "deleteMany",
    ".delete(",
  ]) {
    test(`promoter source must not reference '${forbidden}'`, () => {
      assert.ok(
        !src.includes(forbidden),
        `pending-connected-account-promoter.ts must not reference '${forbidden}'`,
      );
    });
  }

  test("promoter only calls connectedAccount.update (not delete)", () => {
    assert.ok(
      src.includes("connectedAccount.update"),
      "promoter must use connectedAccount.update to archive",
    );
    assert.ok(
      !src.includes("connectedAccount.delete"),
      "promoter must never delete connectedAccount rows",
    );
  });

  test("promoter sets protectionStatus to 'archived'", () => {
    assert.ok(
      src.includes('protectionStatus: "archived"'),
      "promoter must set protectionStatus to 'archived'",
    );
  });

  test("promoter clears both pending fields", () => {
    assert.ok(
      src.includes("pendingProtectionStatus: null"),
      "promoter must clear pendingProtectionStatus",
    );
    assert.ok(
      src.includes("pendingProtectionEffectiveDate: null"),
      "promoter must clear pendingProtectionEffectiveDate",
    );
  });
});
