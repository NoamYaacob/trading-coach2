/**
 * NormalizedTradeEvent deduplication guard tests.
 *
 * The unit suite has no database, so DB-level uniqueness cannot be exercised
 * directly. These are source-scan guards: they verify the schema declares the
 * unique constraint, the migration creates the index, and both ingestion paths
 * no longer rely on the race-prone findFirst-then-create pattern.
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "../../..");

const SCHEMA_SRC = readFileSync(join(REPO_ROOT, "prisma/schema.prisma"), "utf8");
const SYNC_SRC = readFileSync(join(__dirname, "tradovate-sync.ts"), "utf8");
const WEBHOOK_SRC = readFileSync(
  join(REPO_ROOT, "src/app/api/tradovate/webhook/route.ts"),
  "utf8",
);

// ── Schema: unique constraint ─────────────────────────────────────────────────

describe("NormalizedTradeEvent schema", () => {
  it("declares a unique constraint on (accountId, eventType, externalTradeId)", () => {
    assert.ok(
      SCHEMA_SRC.includes("@@unique([accountId, eventType, externalTradeId])"),
      "schema must declare the natural dedup key as @@unique",
    );
  });

  it("keeps eventType in the key so order IDs and fill IDs cannot collide", () => {
    // trade_opened carries an order ID; fill / trade_closed* carry a fill ID.
    // A unique key of (accountId, externalTradeId) alone could wrongly reject a
    // genuine event when an order ID equals a fill ID numerically.
    const uniqueLine = SCHEMA_SRC.split("\n").find((l) =>
      l.includes("@@unique([accountId, eventType, externalTradeId])"),
    );
    assert.ok(uniqueLine, "unique line must exist");
    assert.ok(uniqueLine!.includes("eventType"), "eventType must be part of the key");
  });
});

// ── Migration ─────────────────────────────────────────────────────────────────

describe("NormalizedTradeEvent dedup migration", () => {
  const migrationsDir = join(REPO_ROOT, "prisma/migrations");
  const migrationFolder = readdirSync(migrationsDir).find((d) =>
    d.endsWith("_add_normalized_trade_event_dedup_unique"),
  );

  it("a migration folder exists for the dedup unique index", () => {
    assert.ok(migrationFolder, "expected an *_add_normalized_trade_event_dedup_unique migration");
  });

  it("creates the unique index and removes pre-existing duplicates first", () => {
    const sql = readFileSync(
      join(migrationsDir, migrationFolder!, "migration.sql"),
      "utf8",
    );
    assert.ok(
      sql.includes("CREATE UNIQUE INDEX") &&
        sql.includes("NormalizedTradeEvent") &&
        sql.includes("externalTradeId"),
      "migration must create the unique index",
    );
    assert.ok(
      sql.includes('DELETE FROM "NormalizedTradeEvent"') &&
        sql.includes("ROW_NUMBER()"),
      "migration must collapse pre-existing duplicates before adding the index",
    );
  });
});

// ── Sync path: race-safe createMany ───────────────────────────────────────────

describe("cron sync trade-event ingestion", () => {
  it("uses createMany with skipDuplicates instead of findFirst-then-create", () => {
    assert.ok(
      SYNC_SRC.includes("normalizedTradeEvent.createMany") &&
        SYNC_SRC.includes("skipDuplicates: true"),
      "sync must batch-insert with skipDuplicates so it is race-safe",
    );
  });

  it("no longer probes for an existing row before storing a fill", () => {
    assert.ok(
      !SYNC_SRC.includes("normalizedTradeEvent.findFirst"),
      "the race-prone findFirst pre-check must be gone from the sync path",
    );
  });
});

// ── Webhook path: P2002 race guard ────────────────────────────────────────────

describe("webhook trade-event ingestion", () => {
  it("treats a unique-constraint violation (P2002) as a duplicate", () => {
    assert.ok(
      WEBHOOK_SRC.includes('"P2002"') &&
        WEBHOOK_SRC.includes('skipped: "duplicate_event"'),
      "a concurrent insert must be caught via P2002 and reported as a duplicate",
    );
  });

  it("wraps the normalized-event create in a try/catch", () => {
    const createIdx = WEBHOOK_SRC.indexOf("prisma.normalizedTradeEvent.create({");
    const tryIdx = WEBHOOK_SRC.lastIndexOf("try {", createIdx);
    const catchIdx = WEBHOOK_SRC.indexOf('"P2002"', createIdx);
    assert.ok(createIdx > -1, "webhook must still create the event");
    assert.ok(tryIdx > -1 && tryIdx < createIdx, "create must be inside a try block");
    assert.ok(catchIdx > createIdx, "the P2002 catch must follow the create");
  });
});
