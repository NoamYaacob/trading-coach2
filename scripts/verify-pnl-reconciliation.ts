#!/usr/bin/env tsx
/**
 * P&L Reconciliation Verification Script — READ ONLY, zero writes.
 *
 * Compares reconstructed round-trip P&L from the FIXED reconstructRoundTrips()
 * (with pointValue multiplier) against official PDF report figures for two accounts.
 *
 * Safety contract: Prisma findFirst/findMany/count only. No writes.
 */

import { resolve } from "path";
import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });

import { prisma } from "../src/lib/db.ts";
import { reconstructRoundTrips, type FillInput } from "../src/lib/trades/round-trips.ts";

// Official PDF report figures
const OFFICIAL = {
  DEMO7433035: {
    trades: 33,
    grossPnl: -145.50,
    fees: -320.12,
    totalPnl: -465.62,
  },
  "1868411": {
    trades: 15,
    grossPnl: -133.00,
    fees: -43.70,
    totalPnl: -176.70,
  },
};

function fmt$(v: number | null): string {
  if (v == null) return "(null)";
  const abs = Math.abs(v);
  const sign = v >= 0 ? "+" : "-";
  return `${sign}$${abs.toFixed(2)}`;
}

async function analyzeAccount(externalId: string) {
  // Look up the ConnectedAccount
  const account = await prisma.connectedAccount.findFirst({
    where: { externalAccountId: externalId },
    select: {
      id: true,
      externalAccountId: true,
      label: true,
      accountType: true,
    },
  });

  if (!account) {
    console.log(`ACCOUNT NOT FOUND: externalAccountId = "${externalId}"`);
    return;
  }

  // Count all NormalizedTradeEvent fills for this account
  const fillCount = await prisma.normalizedTradeEvent.count({
    where: { accountId: account.id },
  });

  // Fetch ALL fills (full history) for round-trip reconstruction
  const allFills = await prisma.normalizedTradeEvent.findMany({
    where: {
      accountId: account.id,
      side: { not: null },
      quantity: { not: null },
      price: { not: null },
    },
    select: {
      id: true,
      externalTradeId: true,
      contractId: true,
      side: true,
      quantity: true,
      price: true,
      pnl: true,
      occurredAt: true,
      rawPayload: true,
    },
    orderBy: { occurredAt: "asc" },
  });

  // Convert to FillInput
  const fillInputs: FillInput[] = allFills.map((f) => ({
    id: f.id,
    externalTradeId: f.externalTradeId,
    contractId: f.contractId,
    side: f.side,
    quantity: f.quantity != null ? String(f.quantity) : null,
    price: f.price != null ? String(f.price) : null,
    pnl: f.pnl != null ? String(f.pnl) : null,
    occurredAt: f.occurredAt,
    rawPayload: f.rawPayload,
  }));

  // Run reconstructRoundTrips with the FIXED version (pointValue multiplier applied)
  const roundTrips = reconstructRoundTrips(fillInputs);

  // Compute stats
  const grossPnl = roundTrips.reduce((s, t) => s + t.pnl, 0);
  const winCount = roundTrips.filter((t) => t.pnl > 0).length;
  const lossCount = roundTrips.filter((t) => t.pnl < 0).length;
  const pnlValues = roundTrips.map((t) => t.pnl);
  const largestWin = pnlValues.filter((p) => p > 0).length > 0
    ? Math.max(...pnlValues.filter((p) => p > 0))
    : 0;
  const largestLoss = pnlValues.filter((p) => p < 0).length > 0
    ? Math.min(...pnlValues.filter((p) => p < 0))
    : 0;

  const official = OFFICIAL[externalId as keyof typeof OFFICIAL];
  const diffGross = official ? grossPnl - official.grossPnl : null;

  console.log(`\n${"=".repeat(72)}`);
  console.log(`ACCOUNT: externalAccountId = ${externalId}`);
  console.log(`${"=".repeat(72)}`);
  console.log(`ConnectedAccount.id:            ${account.id}`);
  console.log(`externalAccountId:              ${account.externalAccountId}`);
  console.log(`label:                          ${account.label}`);
  console.log(`accountType:                    ${account.accountType}`);
  console.log(`Fill count (NormalizedTradeEvent, all-time): ${fillCount}`);
  console.log(`Fills with valid side/qty/price used:        ${allFills.length}`);
  console.log(`Reconstructed round-trips:      ${roundTrips.length}`);
  console.log(`Reconstructed gross P&L:        ${fmt$(grossPnl)}`);
  console.log(`Win count: ${winCount}  |  Loss count: ${lossCount}`);
  console.log(`Largest win: ${fmt$(largestWin)}  |  Largest loss: ${fmt$(largestLoss)}`);

  // pnlSource breakdown
  const brokerPnlCount = roundTrips.filter((t) => t.pnlSource === "broker").length;
  const computedPnlCount = roundTrips.filter((t) => t.pnlSource === "computed").length;
  console.log(`pnlSource=broker:               ${brokerPnlCount} round-trips`);
  console.log(`pnlSource=computed:             ${computedPnlCount} round-trips`);

  if (official) {
    console.log(`---`);
    console.log(`Official report # trades:       ${official.trades}`);
    console.log(`Official report Gross P&L:      ${fmt$(official.grossPnl)}`);
    console.log(`Official report Fees:           ${fmt$(official.fees)}`);
    console.log(`Official report Total P&L:      ${fmt$(official.totalPnl)}`);
    console.log(`Difference (reconstructed - official gross): ${fmt$(diffGross!)}`);
  }
}

async function run() {
  console.log(`\nP&L Reconciliation Verification — READ ONLY`);
  console.log(`Branch: claude/charming-johnson-mZlXy`);
  console.log(`Using FIXED reconstructRoundTrips() with pointValue multiplier`);

  await analyzeAccount("DEMO7433035");
  await analyzeAccount("1868411");

  console.log(`\n${"=".repeat(72)}`);
  console.log(`Done. No DB mutations performed.`);
  console.log(`${"=".repeat(72)}\n`);

  await prisma.$disconnect();
}

run().catch(async (err) => {
  console.error("Script error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
