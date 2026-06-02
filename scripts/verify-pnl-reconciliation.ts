#!/usr/bin/env tsx
/**
 * P&L Reconciliation Verification Script — READ ONLY, zero writes.
 *
 * Resolves each account by id | label | displayName | externalAccountId,
 * then prints per-fill symbol extraction, per-round-trip P&L detail, and
 * compares against official Tradovate Performance PDF figures.
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
import {
  reconstructRoundTrips,
  buildContractIdMap,
  resolveSymbol,
  getContractPointValue,
  type FillInput,
} from "../src/lib/trades/round-trips.ts";

// ── Official PDF figures ────────────────────────────────────────────────────
const OFFICIAL: Record<string, {
  trades: number;
  grossPnl: number;
  fees: number;
  totalPnl: number;
  /** Set when the DB only holds a subset of the official report's period.
   *  Reconciliation against the full report is then EXPECTED to differ — the
   *  DB figure represents imported/partial history only, not all-time. */
  partialHistoryNote?: string;
}> = {
  DEMO7433035: { trades: 33, grossPnl: -145.50, fees: -320.12, totalPnl: -465.62 },
  "1868411":   {
    trades: 15, grossPnl: -133.00, fees: -43.70, totalPnl: -176.70,
    partialHistoryNote:
      "Official report covers Apr 30 + May 4. The DB only imported May 4 onward — " +
      "April 30 fills were never ingested. The full report therefore will NOT reconcile; " +
      "only the imported May 4 subset can. UI must label this as imported/partial history.",
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function fmt$(v: number | null): string {
  if (v == null) return "(null)";
  const abs = Math.abs(v);
  const sign = v >= 0 ? "+" : "-";
  return `${sign}$${abs.toFixed(2)}`;
}

function fmtDate(d: Date): string {
  return d.toISOString().replace("T", " ").substring(0, 19) + " UTC";
}

/** Resolve by id | label | displayName | externalAccountId. */
async function resolveAccount(searchKey: string) {
  return prisma.connectedAccount.findFirst({
    where: { OR: [
      { id: searchKey },
      { label: searchKey },
      { displayName: searchKey },
      { externalAccountId: searchKey },
    ]},
    select: {
      id: true, label: true, displayName: true,
      externalAccountId: true, accountType: true,
      createdAt: true,
      brokerConnection: { select: { env: true, connectionStatus: true, platform: true, createdAt: true } },
    },
  });
}

// ── Per-account analysis ─────────────────────────────────────────────────────
async function analyzeAccount(searchKey: string) {
  const account = await resolveAccount(searchKey);

  if (!account) {
    console.log(`\n${"!".repeat(72)}`);
    console.log(`ACCOUNT NOT FOUND: "${searchKey}" — tried id, label, displayName, externalAccountId`);
    return;
  }

  const conn = account.brokerConnection;
  const hr = "─".repeat(72);

  console.log(`\n${"=".repeat(72)}`);
  console.log(`SEARCH KEY: "${searchKey}"`);
  console.log(`${"=".repeat(72)}`);
  console.log(`ConnectedAccount.id:     ${account.id}`);
  console.log(`label:                   ${account.label}`);
  console.log(`displayName:             ${account.displayName ?? "(none)"}`);
  console.log(`externalAccountId:       ${account.externalAccountId ?? "(none)"}`);
  console.log(`accountType:             ${account.accountType}`);
  console.log(`ConnectedAccount.createdAt: ${fmtDate(account.createdAt)}`);
  if (conn) {
    console.log(`BrokerConnection.createdAt: ${fmtDate(conn.createdAt)}`);
    console.log(`env: ${conn.env}  status: ${conn.connectionStatus}  platform: ${conn.platform}`);
  }

  // Fetch ALL fills
  const allFills = await prisma.normalizedTradeEvent.findMany({
    where: { accountId: account.id },
    select: {
      id: true, externalTradeId: true, contractId: true,
      side: true, quantity: true, price: true, pnl: true,
      occurredAt: true, rawPayload: true,
    },
    orderBy: { occurredAt: "asc" },
  });

  const fillCount = allFills.length;
  const validFills = allFills.filter(
    (f) => f.side != null && f.quantity != null && f.price != null
  );

  // Convert ALL fills to FillInput so resolveSymbol() (which inspects rawPayload
  // for a recovered contractId) sees exactly what reconstruction sees.
  const toFillInput = (f: (typeof allFills)[number]): FillInput => ({
    id: f.id,
    externalTradeId: f.externalTradeId,
    contractId: f.contractId,
    side: f.side,
    quantity: f.quantity != null ? String(f.quantity) : null,
    price: f.price != null ? String(f.price) : null,
    pnl: f.pnl != null ? String(f.pnl) : null,
    occurredAt: f.occurredAt,
    rawPayload: f.rawPayload,
  });
  const allFillInputs: FillInput[] = allFills.map(toFillInput);
  const fillInputs: FillInput[] = validFills.map(toFillInput);

  // Build contractId → symbol map (shared with the app loader). Valid futures
  // symbols only — numeric-only values like "4327110" are rejected.
  const contractIdMap = buildContractIdMap(allFillInputs);

  console.log(`\nContract ID → Symbol mapping discovered (valid futures symbols only):`);
  if (contractIdMap.size === 0) {
    console.log(`  (none discovered from rawPayload — resolution relies on the hardcoded known-contract map)`);
  } else {
    for (const [cid, sym] of contractIdMap) {
      console.log(`  ${cid} → ${sym}`);
    }
  }

  console.log(`\n${hr}`);
  console.log(`RAW FILLS (total: ${fillCount}, valid: ${validFills.length})`);
  console.log(`${hr}`);

  const unresolvedPayloadDumps: { idx: number; rawContractId: number | null; payload: unknown }[] = [];

  if (fillCount === 0) {
    console.log("No fills found in DB for this account.");
  } else {
    const earliest = allFills[0]!.occurredAt;
    const latest = allFills[allFills.length - 1]!.occurredAt;
    console.log(`Fill date range: ${fmtDate(earliest)}  →  ${fmtDate(latest)}`);
    console.log(`  pnl=null: ${allFills.filter(f => f.pnl == null).length}  |  pnl non-null: ${allFills.filter(f => f.pnl != null).length}`);
    console.log();
    console.log(`  #  | Date/Time (UTC)     | Side | Qty | Price      | BkrPnl  | rawContractId | resolvedSymbol | PointValue | Source`);
    console.log(`  ---+--------------------+------+-----+------------+---------+---------------+----------------+------------+--------`);
    for (let i = 0; i < allFills.length; i++) {
      const f = allFills[i]!;
      const res = resolveSymbol(allFillInputs[i]!, contractIdMap);
      const dt = f.occurredAt.toISOString().substring(0, 19).replace("T", " ");
      const side = (f.side ?? "?").padEnd(4);
      const qty = String(f.quantity ?? "?").padStart(3);
      const price = String(f.price ?? "?").padStart(10);
      const bpnl = f.pnl != null ? fmt$(Number(f.pnl)).padStart(7) : "  (null)";
      const rcid = (res.rawContractId != null ? String(res.rawContractId) : "(null)").padStart(13);
      const symPad = res.symbol.padEnd(14);
      const pvStr = `$${res.pointValue}/pt`.padEnd(10);
      const flag = res.resolved ? res.source : "UNRESOLVED";
      console.log(`  ${String(i + 1).padStart(2)} | ${dt} | ${side} | ${qty} | ${price} | ${bpnl} | ${rcid} | ${symPad} | ${pvStr} | ${flag}`);
      if (!res.resolved) {
        unresolvedPayloadDumps.push({ idx: i + 1, rawContractId: res.rawContractId, payload: f.rawPayload });
      }
    }
  }

  // Dump the rawPayload for any fill we could NOT resolve, so the exact contract
  // id / symbol fields present can be inspected and added to the known map.
  if (unresolvedPayloadDumps.length > 0) {
    console.log(`\n${hr}`);
    console.log(`UNRESOLVED FILLS — rawPayload dump (${unresolvedPayloadDumps.length}) — $1/pt is LOW CONFIDENCE`);
    console.log(`${hr}`);
    for (const d of unresolvedPayloadDumps) {
      console.log(`  fill #${d.idx}  rawContractId=${d.rawContractId ?? "(null)"}`);
      console.log(`    rawPayload: ${JSON.stringify(d.payload)}`);
    }
  }

  const roundTrips = reconstructRoundTrips(fillInputs, contractIdMap);
  const unresolvedTrips = roundTrips.filter((t) => !t.symbolResolved);

  // Summary stats
  const grossPnl = roundTrips.reduce((s, t) => s + t.pnl, 0);
  const wins = roundTrips.filter((t) => t.pnl > 0);
  const losses = roundTrips.filter((t) => t.pnl < 0);
  const largestWin = wins.length > 0 ? Math.max(...wins.map((t) => t.pnl)) : null;
  const largestLoss = losses.length > 0 ? Math.min(...losses.map((t) => t.pnl)) : null;
  const brokerSrc = roundTrips.filter((t) => t.pnlSource === "broker").length;
  const computedSrc = roundTrips.filter((t) => t.pnlSource === "computed").length;

  console.log(`\n${hr}`);
  console.log(`RECONSTRUCTED ROUND-TRIPS (${roundTrips.length} total)`);
  console.log(`${hr}`);
  console.log(`Gross P&L: ${fmt$(grossPnl)}  |  Win: ${wins.length}  Loss: ${losses.length}`);
  console.log(`Largest win: ${fmt$(largestWin)}  |  Largest loss: ${fmt$(largestLoss)}`);
  console.log(`pnlSource=broker: ${brokerSrc}  |  pnlSource=computed: ${computedSrc}`);
  if (unresolvedTrips.length > 0) {
    const unresolvedPnl = unresolvedTrips.reduce((s, t) => s + t.pnl, 0);
    console.log(`⚠ LOW CONFIDENCE: ${unresolvedTrips.length}/${roundTrips.length} round-trips have an UNRESOLVED symbol`);
    console.log(`  (defaulted to $1/pt — P&L for these is NOT trustworthy: ${fmt$(unresolvedPnl)})`);
  } else {
    console.log(`✓ All ${roundTrips.length} round-trips resolved to a real futures symbol (point-value trusted).`);
  }
  console.log();

  // Per-symbol P&L subtotals
  const bySymbol = new Map<string, { pnl: number; count: number; pv: number }>();
  for (const t of roundTrips) {
    const sym = t.symbol.match(/^([A-Z]+)[FGHJKMNQUVXZ]\d{1,2}$/)?.[1] ?? t.symbol;
    const entry = bySymbol.get(sym) ?? { pnl: 0, count: 0, pv: getContractPointValue(t.symbol) };
    entry.pnl += t.pnl;
    entry.count++;
    bySymbol.set(sym, entry);
  }
  console.log(`Per-root-symbol subtotals:`);
  for (const [sym, s] of bySymbol) {
    console.log(`  ${sym.padEnd(6)} | ${s.count} trips | ${fmt$(s.pnl)} | pointValue=$${s.pv}/pt`);
  }
  console.log();

  // Per-round-trip detail table
  if (roundTrips.length > 0) {
    console.log(` # | Symbol   | S | Qty | Entry      | Exit       | PointVal | Raw pts | P&L      | Src  | OpenedAt (UTC)      `);
    console.log(`---+----------+---+-----+------------+------------+----------+---------+----------+------+---------------------`);
    for (let i = 0; i < roundTrips.length; i++) {
      const t = roundTrips[i]!;
      const pv = getContractPointValue(t.symbol);
      const rawPts = (t.exitPrice - t.entryPrice) * t.qty * (t.side === "LONG" ? 1 : -1);
      const num = String(i + 1).padStart(2);
      const sym = t.symbol.padEnd(8);
      const sd = t.side === "LONG" ? "L" : "S";
      const qty = String(t.qty).padStart(3);
      const entry = String(t.entryPrice).padStart(10);
      const exit = String(t.exitPrice).padStart(10);
      const pvStr = `$${pv}`.padEnd(8);
      const rawStr = rawPts.toFixed(2).padStart(7);
      const pnlStr = fmt$(t.pnl).padStart(8);
      const src = t.pnlSource === "broker" ? "brkr" : "comp";
      const oa = t.openedAt.toISOString().substring(0, 19).replace("T", " ");
      console.log(` ${num} | ${sym} | ${sd} | ${qty} | ${entry} | ${exit} | ${pvStr} | ${rawStr} | ${pnlStr} | ${src} | ${oa}`);
    }
  }

  // Official comparison
  const official = OFFICIAL[searchKey];
  if (official) {
    const diffGross = grossPnl - official.grossPnl;
    console.log(`\n${hr}`);
    console.log(`OFFICIAL PDF vs DB RECONSTRUCTION`);
    console.log(`${hr}`);
    console.log(`                       Official PDF    DB Reconstructed`);
    console.log(`# Trades / round-trips: ${String(official.trades).padStart(8)}       ${String(roundTrips.length).padStart(8)}`);
    console.log(`Gross P&L:             ${fmt$(official.grossPnl).padStart(8)}       ${fmt$(grossPnl).padStart(8)}`);
    console.log(`Fees & Comm:           ${fmt$(official.fees).padStart(8)}       (not tracked by Guardrail)`);
    console.log(`Total P&L:             ${fmt$(official.totalPnl).padStart(8)}       (gross - fees = ${fmt$(grossPnl + official.fees)})`);
    console.log();
    console.log(`Difference (DB gross − official gross): ${fmt$(diffGross)}`);
    if (Math.abs(diffGross) < 0.50) {
      console.log(`✓  RECONCILED (within $0.50)`);
    } else if (official.partialHistoryNote) {
      console.log(`◐  PARTIAL HISTORY — full-report reconciliation is NOT expected:`);
      console.log(`   ${official.partialHistoryNote}`);
      const fillRange = fillCount > 0
        ? `${fmtDate(allFills[0]!.occurredAt)} → ${fmtDate(allFills[allFills.length - 1]!.occurredAt)}`
        : "(no fills)";
      console.log(`   DB fill range: ${fillRange}`);
      console.log(`   Imported subset gross (this is the only figure that can reconcile): ${fmt$(grossPnl)}`);
      if (unresolvedTrips.length > 0) {
        console.log(`   ⚠ ${unresolvedTrips.length} round-trip(s) still unresolved → imported subset gross is LOW CONFIDENCE.`);
      }
    } else {
      console.log(`△  GAP: ${fmt$(diffGross)}`);
      console.log(`   If gap ≠ 0 and trade count matches, investigate:`);
      console.log(`   1. Are symbols resolved correctly (see rawContractId/resolvedSymbol columns)?`);
      console.log(`   2. Are any symbols falling back to pointValue=$1 instead of MNQ=$2 or NQ=$20?`);
      console.log(`   3. Does Tradovate's pairing differ from FIFO (e.g. partial lot splits)?`);
      console.log(`   4. Are there fills with externalTradeId=null that sort incorrectly?`);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log(`\nP&L Reconciliation Verification — READ ONLY`);
  console.log(`Branch: claude/charming-johnson-mZlXy`);
  console.log(`reconstructRoundTrips() with pointValue multiplier`);
  console.log(`Account lookup: id | label | displayName | externalAccountId`);

  await analyzeAccount("DEMO7433035");
  await analyzeAccount("1868411");

  console.log(`\n${"=".repeat(72)}`);
  console.log(`Done. No DB writes performed.`);
  console.log(`${"=".repeat(72)}\n`);

  await prisma.$disconnect();
}

run().catch(async (err) => {
  console.error("Script error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
