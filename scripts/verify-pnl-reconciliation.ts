#!/usr/bin/env tsx
/**
 * P&L Reconciliation Verification Script — READ ONLY, zero writes.
 *
 * Resolves each account by id, label, displayName, or externalAccountId
 * (whichever matches first), then compares reconstructed round-trip P&L
 * from the FIXED reconstructRoundTrips() (with pointValue multiplier)
 * against official PDF report figures.
 *
 * Usage:
 *   npx tsx scripts/verify-pnl-reconciliation.ts
 *
 * Safety contract: Prisma findFirst/findMany/count only. No writes.
 */

import { resolve } from "path";
import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });

import { prisma } from "../src/lib/db.ts";
import { reconstructRoundTrips, type FillInput } from "../src/lib/trades/round-trips.ts";

// Official PDF report figures — keyed by the human-readable search string
const OFFICIAL: Record<string, {
  trades: number;
  grossPnl: number;
  fees: number;
  totalPnl: number;
}> = {
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

/** Resolve a ConnectedAccount by id, label, displayName, or externalAccountId. */
async function resolveAccount(searchKey: string) {
  return prisma.connectedAccount.findFirst({
    where: {
      OR: [
        { id: searchKey },
        { label: searchKey },
        { displayName: searchKey },
        { externalAccountId: searchKey },
      ],
    },
    select: {
      id: true,
      label: true,
      displayName: true,
      externalAccountId: true,
      accountType: true,
      brokerConnection: {
        select: {
          env: true,
          connectionStatus: true,
          platform: true,
        },
      },
    },
  });
}

async function analyzeAccount(searchKey: string) {
  const account = await resolveAccount(searchKey);

  if (!account) {
    console.log(`\nACCOUNT NOT FOUND for search key: "${searchKey}"`);
    console.log("Tried: id, label, displayName, externalAccountId");
    return;
  }

  const conn = account.brokerConnection;

  console.log(`\n${"=".repeat(72)}`);
  console.log(`SEARCH KEY: "${searchKey}"`);
  console.log(`${"=".repeat(72)}`);
  console.log(`ConnectedAccount.id:   ${account.id}`);
  console.log(`label:                 ${account.label}`);
  console.log(`displayName:           ${account.displayName ?? "(none)"}`);
  console.log(`externalAccountId:     ${account.externalAccountId ?? "(none)"}`);
  console.log(`accountType:           ${account.accountType}`);
  if (conn) {
    console.log(`brokerConnection.env:    ${conn.env}`);
    console.log(`brokerConnection.status: ${conn.connectionStatus}`);
    console.log(`brokerConnection.platform: ${conn.platform}`);
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

  // pnl null breakdown before reconstruction
  const nullPnlFills = allFills.filter((f) => f.pnl == null).length;
  const nonNullPnlFills = allFills.filter((f) => f.pnl != null).length;

  // Run reconstructRoundTrips with the FIXED version (pointValue multiplier applied)
  const roundTrips = reconstructRoundTrips(fillInputs);

  // Compute stats
  const grossPnl = roundTrips.reduce((s, t) => s + t.pnl, 0);
  const winCount = roundTrips.filter((t) => t.pnl > 0).length;
  const lossCount = roundTrips.filter((t) => t.pnl < 0).length;
  const zeroCount = roundTrips.filter((t) => t.pnl === 0).length;
  const pnlValues = roundTrips.map((t) => t.pnl);
  const largestWin = pnlValues.filter((p) => p > 0).length > 0
    ? Math.max(...pnlValues.filter((p) => p > 0))
    : null;
  const largestLoss = pnlValues.filter((p) => p < 0).length > 0
    ? Math.min(...pnlValues.filter((p) => p < 0))
    : null;

  const brokerPnlCount = roundTrips.filter((t) => t.pnlSource === "broker").length;
  const computedPnlCount = roundTrips.filter((t) => t.pnlSource === "computed").length;

  // Print DB reconstruction results
  console.log(`\n── DB Reconstruction ──`);
  console.log(`Fill count (all NormalizedTradeEvent):       ${fillCount}`);
  console.log(`Fills with valid side/qty/price used:        ${allFills.length}`);
  console.log(`  of which pnl=null (computed path):         ${nullPnlFills}`);
  console.log(`  of which pnl non-null (broker path):       ${nonNullPnlFills}`);
  console.log(`Reconstructed round-trips:                   ${roundTrips.length}`);
  console.log(`Reconstructed gross P&L:                     ${fmt$(grossPnl)}`);
  console.log(`Win: ${winCount}  |  Loss: ${lossCount}  |  Breakeven: ${zeroCount}`);
  console.log(`Largest win:  ${fmt$(largestWin)}  |  Largest loss: ${fmt$(largestLoss)}`);
  console.log(`pnlSource=broker:   ${brokerPnlCount} round-trips`);
  console.log(`pnlSource=computed: ${computedPnlCount} round-trips`);

  // Official comparison
  const official = OFFICIAL[searchKey];
  if (official) {
    const diffGross = grossPnl - official.grossPnl;
    console.log(`\n── Official Performance PDF ──`);
    console.log(`# Trades:     ${official.trades}`);
    console.log(`Gross P&L:    ${fmt$(official.grossPnl)}`);
    console.log(`Fees & Comm:  ${fmt$(official.fees)}`);
    console.log(`Total P&L:    ${fmt$(official.totalPnl)}`);
    console.log(`\nDifference (reconstructed gross − official gross): ${fmt$(diffGross)}`);
    if (Math.abs(diffGross) < 1) {
      console.log(`✓ RECONCILED within $1`);
    } else {
      console.log(`△ GAP of ${fmt$(diffGross)} — expected if fills use broker pnl path (commissions excluded)`);
      console.log(`  or if DB fill range differs from PDF date range.`);
    }
  }
}

async function run() {
  console.log(`\nP&L Reconciliation Verification — READ ONLY`);
  console.log(`Branch: claude/charming-johnson-mZlXy`);
  console.log(`Using FIXED reconstructRoundTrips() with pointValue multiplier`);
  console.log(`Resolving accounts by: id | label | displayName | externalAccountId`);

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
