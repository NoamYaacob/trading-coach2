#!/usr/bin/env tsx
/**
 * backfill-fill-fees.ts — backfills rawPayload.commission for NormalizedTradeEvent
 * rows that were ingested before fee data was captured.
 *
 * Usage:
 *   npx tsx scripts/backfill-fill-fees.ts <accountLabelOrId>
 *       # dry-run diagnostic — shows what would be updated without writing
 *
 *   npx tsx scripts/backfill-fill-fees.ts <accountLabelOrId> --execute
 *       # actually updates rawPayload.commission for fills with missing/stale fees
 *
 * Safety contract — dry run (no --execute):
 *   - Prisma: read-only (findMany, count). Zero writes.
 *   - TradovateClient: read-only (fillFee/list GET). No broker writes.
 *   - Does NOT create or duplicate NormalizedTradeEvent rows.
 *   - Does NOT place, cancel, or flatten orders.
 *   - Does NOT modify InternalLockEvent, LiveSessionState, or GuardianIntervention.
 *   - Does NOT change schema, migrations, or env vars.
 *
 * Safety contract — execute mode (--execute):
 *   - Only updates rawPayload on existing rows whose commission differs or is missing.
 *   - Idempotent: running twice produces identical results.
 *   - No new rows created. No rows deleted.
 */

import { resolve } from "path";
import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });

import { PrismaClient } from "@prisma/client";
import { TradovateClient } from "../src/lib/brokers/tradovate-client.ts";
import { backfillFillFees } from "../src/lib/trades/fill-fee-backfill.ts";

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  const accountArg = args[0];
  const execute = args.includes("--execute");

  if (!accountArg) {
    console.error("Usage: npx tsx scripts/backfill-fill-fees.ts <accountLabelOrId> [--execute]");
    process.exit(1);
  }

  // Resolve account by label or numeric id
  const account = await prisma.connectedAccount.findFirst({
    where: {
      OR: [
        { label: accountArg },
        ...(Number.isInteger(Number(accountArg)) ? [{ id: accountArg }] : []),
      ],
    },
    select: {
      id: true,
      userId: true,
      label: true,
      platform: true,
      connectionStatus: true,
      brokerConnection: { select: { permissionLevel: true } },
    },
  });

  if (!account) {
    console.error(`No account found matching: ${accountArg}`);
    process.exit(1);
  }

  console.log("\n── Account ─────────────────────────────────────────────────────────");
  console.log(`  id:               ${account.id}`);
  console.log(`  label:            ${account.label}`);
  console.log(`  platform:         ${account.platform}`);
  console.log(`  connectionStatus: ${account.connectionStatus}`);
  console.log(`  permissionLevel:  ${account.brokerConnection?.permissionLevel ?? "n/a"}`);

  if (account.platform !== "tradovate") {
    console.error("This script only supports Tradovate accounts.");
    process.exit(1);
  }

  // Count existing fills
  const totalFills = await prisma.normalizedTradeEvent.count({
    where: { accountId: account.id, eventType: "fill" },
  });
  const fillsWithFee = await prisma.normalizedTradeEvent.count({
    where: {
      accountId: account.id,
      eventType: "fill",
      rawPayload: { path: ["commission"], not: "null" as unknown as never },
    },
  });

  console.log("\n── Current fill state ──────────────────────────────────────────────");
  console.log(`  Total fills in DB:          ${totalFills}`);
  console.log(`  Fills with commission set:  ${fillsWithFee}`);
  console.log(`  Fills missing commission:   ${totalFills - fillsWithFee}`);

  // Initialize TradovateClient
  let client: TradovateClient;
  try {
    client = new TradovateClient(account.id, account.userId);
    await client.initialize();
  } catch (err) {
    console.error("Could not initialize TradovateClient:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  console.log("\n── Fee fetch (fillFee/list) ─────────────────────────────────────────");
  const feeByFillId = await client.getFillFeesByFillId();
  console.log(`  fillFee/list returned ${feeByFillId.size} fee records`);

  if (feeByFillId.size === 0) {
    console.log("  No fee data returned — nothing to backfill.");
    await prisma.$disconnect();
    return;
  }

  // Preview: show a sample of what would change
  const fillIds = Array.from(feeByFillId.keys()).map(String);
  const existingRows = await prisma.normalizedTradeEvent.findMany({
    where: { accountId: account.id, externalTradeId: { in: fillIds } },
    select: { id: true, externalTradeId: true, rawPayload: true, occurredAt: true },
    orderBy: { occurredAt: "desc" },
    take: 5,
  });

  console.log(`\n── Preview (up to 5 matched fills) ─────────────────────────────────`);
  for (const row of existingRows) {
    const fillId = Number(row.externalTradeId);
    const newFee = feeByFillId.get(fillId);
    const existing = row.rawPayload as Record<string, unknown> | null;
    const currentFee = existing?.commission;
    const status = currentFee === newFee ? "SKIP (same)" : currentFee == null ? "UPDATE (missing)" : "UPDATE (changed)";
    console.log(`  fill ${row.externalTradeId}: current=${currentFee ?? "null"} → new=${newFee} [${status}]`);
  }

  if (!execute) {
    console.log(`\n── Dry run complete ─────────────────────────────────────────────────`);
    // Run in dryRun mode to get counts
    const result = await backfillFillFees(account.id, client, prisma, { dryRun: true });
    console.log(`  Would update: ${result.updated} fills`);
    console.log(`  Would skip:   ${result.skipped} fills (already correct)`);
    console.log(`  Total matched: ${result.total} fills`);
    console.log(`\n  Re-run with --execute to apply updates.`);
  } else {
    console.log(`\n── Executing backfill ───────────────────────────────────────────────`);
    const result = await backfillFillFees(account.id, client, prisma, { dryRun: false });
    console.log(`  Updated: ${result.updated} fills`);
    console.log(`  Skipped: ${result.skipped} fills (already correct)`);
    console.log(`  Total matched: ${result.total} fills`);
    console.log(`\n  Done. Re-run without --execute to verify.`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
