#!/usr/bin/env tsx
/**
 * inspect-tradovate-fee-sources.ts — read-only probe of every Tradovate
 * endpoint that might expose fees / commissions / net P&L for an account.
 *
 * Prints raw shapes and counts so we can see which source actually carries
 * the day-level Gross P/L, fees, and Net P/L (the Account Report shows
 * +1.50 / -1.90 / -0.40 for account 1868411, but fillFee/list returns 0).
 *
 * Usage:
 *   npx tsx scripts/inspect-tradovate-fee-sources.ts <accountLabelOrId> [YYYY-MM-DD]
 *
 * Safety contract:
 *   - 100% read-only. Every broker call is a GET or the read-only report POST
 *     (reports/requestreport returns a document; it does not mutate state).
 *   - No Prisma writes. No order/cancel/flatten. No lockout/retry paths.
 *   - Does NOT change schema, migrations, env, or the listener-worker.
 */

import { resolve } from "path";
import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });

import { TradovateClient } from "../src/lib/brokers/tradovate-client.ts";
import { parsePerformanceReportPnl } from "../src/lib/brokers/tradovate-reports-parser.ts";
import { prisma } from "../src/lib/db.ts";

function preview(items: unknown[], n = 3): void {
  console.log(`  count: ${items.length}`);
  for (const item of items.slice(0, n)) {
    console.log(`  · ${JSON.stringify(item)}`);
  }
  if (items.length > n) console.log(`  … (${items.length - n} more)`);
}

async function probe(label: string, fn: () => Promise<unknown[]>): Promise<void> {
  console.log(`\n── ${label} ───────────────────────────────────────────────`);
  try {
    const items = await fn();
    preview(items);
  } catch (err) {
    console.log(`  (failed) ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const accountArg = args[0];
  const dayKey = args[1] ?? new Date().toLocaleDateString("en-CA");

  if (!accountArg) {
    console.error("Usage: npx tsx scripts/inspect-tradovate-fee-sources.ts <accountLabelOrId> [YYYY-MM-DD]");
    process.exit(1);
  }

  const account = await prisma.connectedAccount.findFirst({
    where: {
      OR: [
        { label: accountArg },
        ...(Number.isInteger(Number(accountArg)) ? [{ id: accountArg }] : []),
      ],
    },
    select: { id: true, userId: true, label: true, platform: true, connectionStatus: true },
  });

  if (!account) {
    console.error(`No account found matching: ${accountArg}`);
    process.exit(1);
  }
  if (account.platform !== "tradovate") {
    console.error("This script only supports Tradovate accounts.");
    process.exit(1);
  }

  console.log("── Account ─────────────────────────────────────────────────");
  console.log(`  id:               ${account.id}`);
  console.log(`  label:            ${account.label}`);
  console.log(`  connectionStatus: ${account.connectionStatus}`);
  console.log(`  trading day:      ${dayKey}`);

  let client: TradovateClient;
  try {
    client = new TradovateClient(account.id, account.userId);
    await client.initialize();
  } catch (err) {
    console.error("Could not initialize TradovateClient:", err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const tvAccountId = client.getTvAccountId();
  console.log(`  tvAccountId:      ${tvAccountId ?? "n/a"}`);

  // ── 1. fillFee/list (already used by the backfill — shown for comparison) ──
  console.log("\n── fillFee/list (per-fill fee totals) ──────────────────────");
  try {
    const feeMap = await client.getFillFeesByFillId();
    console.log(`  fillFee records: ${feeMap.size}`);
    let i = 0;
    for (const [fillId, total] of feeMap) {
      console.log(`  · fillId=${fillId} feeTotal=${total}`);
      if (++i >= 5) break;
    }
  } catch (err) {
    console.log(`  (failed) ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 2. cashBalance / cashBalanceLog family ─────────────────────────────────
  await probe("cashBalance/list", () => client.debugRawList("cashBalance/list"));
  await probe("cashBalanceLog/list", () => client.debugRawList("cashBalanceLog/list"));
  if (tvAccountId != null) {
    await probe(`cashBalanceLog/deps?masterid=${tvAccountId}`, () =>
      client.debugRawList(`cashBalanceLog/deps?masterid=${tvAccountId}`),
    );
  }

  // ── 3. Performance Report — raw body + parsed P&L ──────────────────────────
  console.log("\n── Performance Report (reports/requestreport) ──────────────");
  try {
    const accountName = await client.getAccountName();
    console.log(`  accountName: ${accountName ?? "n/a"}`);
    if (accountName) {
      const report = await client.fetchPerformanceReport({ accountName, tradingDayKey: dayKey });
      if (!report) {
        console.log("  (report unavailable — reports URL not configured or network error)");
      } else {
        console.log(`  status: ${report.status}  contentType: ${report.contentType}  bodyLength: ${report.body.length}`);
        console.log(`  body (first 600 chars):`);
        console.log("  " + report.body.slice(0, 600).replace(/\n/g, "\n  "));
        const pnl = parsePerformanceReportPnl({ body: report.body, contentType: report.contentType });
        console.log(`\n  parsed → grossPnl=${pnl.grossPnl}  fees=${pnl.fees}  netPnl=${pnl.netPnl}`);
      }
    }
  } catch (err) {
    console.log(`  (failed) ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log("\n── Done (read-only) ─────────────────────────────────────────");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
