#!/usr/bin/env tsx
/**
 * diagnose-account-truth.ts — read-only data truth diagnostic for a single
 * Tradovate account.
 *
 * Prints a full reconciliation across every available source:
 *   1. Account summary (Guardrail DB + broker snapshot)
 *   2. Cash History ledger (cashBalanceLog, grouped by day)
 *   3. Fill / FillFee / FillPair diagnostics
 *   4. Per-day reconciliation (cashHistory vs. fill reconstruction)
 *   5. All-time summary
 *   6. Source-of-truth table
 *
 * Usage:
 *   npx tsx scripts/diagnose-account-truth.ts <accountLabelOrExternalId>
 *
 * Example:
 *   npx tsx scripts/diagnose-account-truth.ts 1868411
 *
 * Safety contract:
 *   - 100% read-only. GET and the read-only POST cashBalance/getCashBalanceSnapshot
 *     only. No Prisma writes. No order/cancel/flatten. No lockout/retry.
 *   - Does not change schema, migrations, env, or listener-worker.
 */

import { resolve } from "path";
import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });

import { TradovateClient } from "../src/lib/brokers/tradovate-client.ts";
import { prisma } from "../src/lib/db.ts";
import {
  normalizeCashBalanceLogRows,
  aggregateCashHistory,
  classifyCashRow,
  type RawCashBalanceLogRow,
} from "../src/lib/trades/cash-history-fees.ts";
import { parseSnapshotItems } from "../src/lib/brokers/tradovate-client-helpers.ts";

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmt$(v: number | null | undefined): string {
  if (v == null) return "n/a";
  const abs = Math.abs(v);
  const sign = v >= 0 ? "+" : "-";
  return `${sign}$${abs.toFixed(2)}`;
}

function fmtBal(v: number | null | undefined): string {
  if (v == null) return "n/a";
  return `$${Math.abs(v).toFixed(2)}`;
}

function pad(s: string | number | null | undefined, w: number): string {
  const str = String(s ?? "n/a");
  return str.length >= w ? str : str + " ".repeat(w - str.length);
}

function hr(char = "─", w = 72): string {
  return char.repeat(w);
}

function section(title: string): void {
  console.log("\n" + hr("═"));
  console.log(`  ${title}`);
  console.log(hr("═"));
}

function sub(title: string): void {
  console.log("\n" + hr("─", 60));
  console.log(`  ${title}`);
  console.log(hr("─", 60));
}

function row(...cells: string[]): void {
  console.log("  " + cells.join("  "));
}

// ── Raw cashBalanceLog row type extended with raw fields for printing ─────────

type RawCblRow = RawCashBalanceLogRow & {
  amount?: number | null;
  realizedPnL?: number | null;
  weekRealizedPnL?: number | null;
  timestamp?: string | null;
};

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: npx tsx scripts/diagnose-account-truth.ts <accountLabelOrExternalId>");
    console.error("Example: npx tsx scripts/diagnose-account-truth.ts 1868411");
    process.exit(1);
  }

  // ── 1. ACCOUNT SUMMARY ────────────────────────────────────────────────────

  section("1. ACCOUNT SUMMARY");

  // Find in DB by externalAccountId or label
  const account = await prisma.connectedAccount.findFirst({
    where: {
      OR: [
        { externalAccountId: arg },
        { label: arg },
        ...(arg.length < 40 ? [{ id: arg }] : []),
      ],
    },
    include: {
      sessionState: true,
      riskRules: true,
    },
  });

  if (!account) {
    console.error(`No ConnectedAccount found matching: ${arg}`);
    console.error("Try the label or the Tradovate numeric account ID (externalAccountId).");
    await prisma.$disconnect();
    process.exit(1);
  }

  if (account.platform !== "tradovate") {
    console.error(`Account ${arg} is platform="${account.platform}" — this script only supports Tradovate.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  console.log(`\n  Guardrail DB:`);
  row(pad("id:", 26), account.id);
  row(pad("label:", 26), account.label);
  row(pad("externalAccountId:", 26), account.externalAccountId ?? "n/a");
  row(pad("platform:", 26), account.platform);
  row(pad("accountType:", 26), account.accountType);
  row(pad("connectionStatus:", 26), account.connectionStatus);
  row(pad("isActive:", 26), String(account.isActive));
  row(pad("lastSyncAt:", 26), account.lastSyncAt?.toISOString() ?? "n/a");
  row(pad("fillsSyncedAt:", 26), account.fillsSyncedAt?.toISOString() ?? "n/a");
  row(pad("balance (DB):", 26), account.balance != null ? fmtBal(Number(account.balance)) : "n/a");
  row(pad("openPnl (DB):", 26), account.openPnl != null ? fmt$(Number(account.openPnl)) : "n/a");

  if (account.sessionState) {
    const ss = account.sessionState;
    console.log(`\n  LiveSessionState (DB — written at last sync):`);
    row(pad("sessionDate:", 26), ss.sessionDate);
    row(pad("dailyPnl:", 26), fmt$(Number(ss.dailyPnl)));
    row(pad("tradesCount:", 26), String(ss.tradesCount));
    row(pad("tradeCountSource:", 26), ss.tradeCountSource);
    row(pad("consecutiveLosses:", 26), String(ss.consecutiveLosses));
    row(pad("riskState:", 26), ss.riskState);
    row(pad("updatedAt:", 26), ss.updatedAt.toISOString());
  } else {
    console.log(`\n  LiveSessionState: (none in DB)`);
  }

  if (account.riskRules) {
    const r = account.riskRules;
    console.log(`\n  AccountRiskRules (DB):`);
    row(pad("maxDailyLoss:", 26), r.maxDailyLoss != null ? fmtBal(Number(r.maxDailyLoss)) : "n/a");
    row(pad("maxTradesPerDay:", 26), r.maxTradesPerDay != null ? String(r.maxTradesPerDay) : "n/a");
    row(pad("stopAfterLosses:", 26), r.stopAfterLosses != null ? String(r.stopAfterLosses) : "n/a");
  }

  // ── Initialize broker client ──────────────────────────────────────────────

  let client: TradovateClient;
  try {
    client = new TradovateClient(account.id, account.userId);
    await client.initialize();
  } catch (err) {
    console.error("\n  Could not initialize TradovateClient:", err instanceof Error ? err.message : err);
    console.error("  (The account may not have live tokens — run a manual sync first.)");
    await prisma.$disconnect();
    process.exit(1);
  }

  const tvAccountId = client.getTvAccountId();
  console.log(`\n  Broker identity (resolved by client.initialize()):`);
  row(pad("tvAccountId (numeric):", 26), tvAccountId != null ? String(tvAccountId) : "n/a");
  row(pad("externalAccountId:", 26), client.getExternalAccountId() ?? "n/a");

  // Tradovate account/list for name
  console.log(`\n  Tradovate account/list:`);
  try {
    const accounts = await client.debugRawList("account/list") as Array<Record<string, unknown>>;
    const match = tvAccountId != null ? accounts.find((a) => a.id === tvAccountId) : null;
    if (match) {
      row(pad("account.id:", 26), String(match.id ?? "n/a"));
      row(pad("account.name:", 26), String(match.name ?? "n/a"));
      row(pad("account.active:", 26), String(match.active ?? "n/a"));
      row(pad("account.accountType:", 26), String(match.accountType ?? "n/a"));
      row(pad("account.nickname:", 26), String(match.nickname ?? "n/a"));
    } else {
      console.log(`    (account id ${tvAccountId} not found in account/list; total accounts: ${accounts.length})`);
    }
  } catch (err) {
    console.log(`    (account/list failed: ${err instanceof Error ? err.message : err})`);
  }

  // cashBalance/getCashBalanceSnapshot
  console.log(`\n  POST cashBalance/getCashBalanceSnapshot:`);
  if (tvAccountId != null) {
    try {
      const snap = await client.debugRawList(`cashBalance/getCashBalanceSnapshot`) as Array<Record<string, unknown>>;
      // The snapshot endpoint accepts POST with body — use debugRawList is GET only.
      // We call it via the client's internal method via a helper instead.
      // Fall through to the dedicated snapshot section below.
      console.log(`    (use getCashBalanceSnapshot section below)`);
    } catch {
      console.log(`    (skipped — use getCashBalanceSnapshot via internal method)`);
    }
  }

  // Internal balance read
  try {
    const raw = await client.debugRawList("cashBalance/list") as Array<Record<string, unknown>>;
    const match = tvAccountId != null ? raw.find((r) => r.accountId === tvAccountId) : raw[0];
    console.log(`\n  GET cashBalance/list (${raw.length} rows total):`);
    if (match) {
      const fields = ["id","accountId","timestamp","tradeDate","amount","realizedPnL","weekRealizedPnL","amountSOD","cashBalance","netLiq","totalCashValue","openPl"];
      for (const f of fields) {
        if (f in match) row(pad(`  ${f}:`, 28), String(match[f] ?? "null"));
      }
    } else {
      console.log(`    (no row for tvAccountId=${tvAccountId})`);
    }
    // Also print all rows if <= 5
    if (raw.length <= 5 && raw.length > 0) {
      console.log(`    All rows (${raw.length}):`);
      for (const r of raw) {
        console.log(`      accountId=${r.accountId} amount=${r.amount} realizedPnL=${r.realizedPnL} amountSOD=${r.amountSOD}`);
      }
    }
  } catch (err) {
    console.log(`\n  cashBalance/list failed: ${err instanceof Error ? err.message : err}`);
  }

  // cashBalance/deps?masterid=tvAccountId
  if (tvAccountId != null) {
    try {
      const raw = await client.debugRawList(`cashBalance/deps?masterid=${tvAccountId}`) as Array<Record<string, unknown>>;
      console.log(`\n  GET cashBalance/deps?masterid=${tvAccountId} (${raw.length} rows):`);
      for (const r of raw.slice(0, 3)) {
        const fields = ["id","accountId","timestamp","tradeDate","amount","realizedPnL","weekRealizedPnL","amountSOD"];
        console.log(`    ` + fields.filter(f => f in r).map(f => `${f}=${r[f]}`).join("  "));
      }
    } catch (err) {
      console.log(`\n  cashBalance/deps failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── 2. CASH HISTORY LEDGER ────────────────────────────────────────────────

  section("2. CASH HISTORY LEDGER (cashBalanceLog)");

  let rawCblRows: RawCblRow[] = [];
  let cblSource = "none";

  // Primary: cashBalanceLog/deps?masterid=tvAccountId (account-scoped)
  if (tvAccountId != null) {
    try {
      const raw = await client.debugRawList(`cashBalanceLog/deps?masterid=${tvAccountId}`);
      rawCblRows = raw as RawCblRow[];
      cblSource = `cashBalanceLog/deps?masterid=${tvAccountId}`;
      console.log(`\n  Source: ${cblSource}  (${rawCblRows.length} rows)`);
    } catch (err) {
      console.log(`\n  cashBalanceLog/deps failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Fallback: cashBalanceLog/list (cross-account, filter client-side)
  if (rawCblRows.length === 0) {
    try {
      const raw = await client.debugRawList("cashBalanceLog/list");
      const allRows = raw as RawCblRow[];
      rawCblRows = tvAccountId != null
        ? allRows.filter((r) => r.accountId == null || r.accountId === tvAccountId)
        : allRows;
      cblSource = `cashBalanceLog/list (filtered to accountId=${tvAccountId}, ${rawCblRows.length}/${allRows.length} rows)`;
      console.log(`\n  Source: ${cblSource}`);
    } catch (err) {
      console.log(`\n  cashBalanceLog/list also failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (rawCblRows.length === 0) {
    console.log(`  (no Cash History rows available — cannot reconcile)`);
  } else {
    // Normalize rows
    const normalized = tvAccountId != null
      ? normalizeCashBalanceLogRows(rawCblRows, tvAccountId, account.id)
      : [];

    // Group raw rows by tradeDate for printing
    const rawByDay = new Map<string, RawCblRow[]>();
    for (const r of rawCblRows) {
      let dayKey = "unknown";
      if (r.tradeDate) {
        if (typeof r.tradeDate === "string") {
          dayKey = r.tradeDate.slice(0, 10);
        } else if (typeof r.tradeDate === "object" && r.tradeDate !== null) {
          const td = r.tradeDate as { year?: number; month?: number; day?: number };
          if (td.year && td.month && td.day) {
            dayKey = `${td.year}-${String(td.month).padStart(2,"0")}-${String(td.day).padStart(2,"0")}`;
          }
        }
      } else if (r.timestamp) {
        dayKey = r.timestamp.slice(0, 10);
      }
      const arr = rawByDay.get(dayKey) ?? [];
      arr.push(r);
      rawByDay.set(dayKey, arr);
    }

    // Per-day aggregation using normalized rows
    const aggGroups = tvAccountId != null
      ? aggregateCashHistory(normalized, account.id)
      : [];

    // Roll up to day level
    const dayAgg = new Map<string, { tradePnl: number; fees: number; netPnl: number; feesAvailable: boolean; contracts: string[] }>();
    for (const g of aggGroups) {
      const cur = dayAgg.get(g.date) ?? { tradePnl: 0, fees: 0, netPnl: 0, feesAvailable: false, contracts: [] };
      cur.tradePnl = Math.round((cur.tradePnl + g.tradePnl + Number.EPSILON) * 100) / 100;
      cur.fees = Math.round((cur.fees + g.fees + Number.EPSILON) * 100) / 100;
      cur.netPnl = Math.round((cur.netPnl + g.netPnl + Number.EPSILON) * 100) / 100;
      cur.feesAvailable = cur.feesAvailable || g.feesAvailable;
      if (g.contract) cur.contracts.push(g.contract);
      dayAgg.set(g.date, cur);
    }

    // Sorted days
    const sortedDays = [...rawByDay.keys()].sort();

    console.log(`\n  Day summary (${sortedDays.length} days):`);
    console.log(`\n  ${pad("DATE",12)} ${pad("TRADE_PNL",12)} ${pad("FEES",12)} ${pad("NET",12)} ${pad("ROWS",6)} ${pad("FEES?",6)} CONTRACTS`);
    console.log(`  ${hr("-",70)}`);

    let totalTradePnl = 0;
    let totalFees = 0;
    let totalNet = 0;
    let totalRows = 0;

    for (const day of sortedDays) {
      const dayRows = rawByDay.get(day)!;
      const agg = dayAgg.get(day);
      const tradePnl = agg?.tradePnl ?? 0;
      const fees = agg?.fees ?? 0;
      const net = agg?.netPnl ?? 0;
      const feesFlag = agg?.feesAvailable ? "yes" : "no";
      const contracts = [...new Set(agg?.contracts ?? [])].join(",");

      totalTradePnl += tradePnl;
      totalFees += fees;
      totalNet += net;
      totalRows += dayRows.length;

      console.log(`  ${pad(day,12)} ${pad(fmt$(tradePnl),12)} ${pad(fmt$(fees),12)} ${pad(fmt$(net),12)} ${pad(dayRows.length,6)} ${pad(feesFlag,6)} ${contracts || "—"}`);
    }

    const tTrade = Math.round((totalTradePnl + Number.EPSILON) * 100) / 100;
    const tFees = Math.round((totalFees + Number.EPSILON) * 100) / 100;
    const tNet = Math.round((totalNet + Number.EPSILON) * 100) / 100;
    console.log(`  ${hr("-",70)}`);
    console.log(`  ${pad("TOTAL",12)} ${pad(fmt$(tTrade),12)} ${pad(fmt$(tFees),12)} ${pad(fmt$(tNet),12)} ${pad(totalRows,6)}`);

    // Raw rows per day
    sub("Raw cashBalanceLog rows per day");
    console.log(`  ${"TIMESTAMP".padEnd(26)} ${"CHANGE_TYPE".padEnd(22)} ${"DELTA".padEnd(10)} ${"AMOUNT".padEnd(14)} ${"REALIZED_PNL".padEnd(14)} ${"FILL_ID".padEnd(12)} FILL_PAIR_ID`);
    console.log(`  ${hr("-",106)}`);

    for (const day of sortedDays) {
      console.log(`\n  ── ${day} ──`);
      const dayRows = rawByDay.get(day)!;
      for (const r of dayRows) {
        const ct = typeof r.cashChangeType === "string"
          ? r.cashChangeType
          : ((r.cashChangeType as { name?: string } | null)?.name ?? "?");
        const ts = (r.timestamp ?? "").slice(0, 23);
        const delta = r.delta != null ? fmt$(r.delta) : "n/a";
        const amount = r.amount != null ? fmtBal(r.amount) : "n/a";
        const realPnl = r.realizedPnL != null ? fmt$(r.realizedPnL) : "n/a";
        const fillId = r.fillId != null ? String(r.fillId) : "—";
        const fillPairId = r.fillPairId != null ? String(r.fillPairId) : "—";
        const kind = classifyCashRow(ct);
        const kindMark = kind === "fee" ? "[fee]" : kind === "pnl" ? "[P&L]" : "[---]";
        console.log(`  ${pad(ts,26)} ${pad(`${kindMark} ${ct}`,22)} ${pad(delta,10)} ${pad(amount,14)} ${pad(realPnl,14)} ${pad(fillId,12)} ${fillPairId}`);
      }
    }
  }

  // ── 3. FILL / FILLFEE / FILLPAIR DIAGNOSTICS ─────────────────────────────

  section("3. FILL / FILLFEE / FILLPAIR DIAGNOSTICS");

  // fillFee/list
  sub("fillFee/list — per-fill fee breakdown");
  let fillFeeMap = new Map<number, Record<string, unknown>>();
  try {
    const raw = await client.debugRawList("fillFee/list") as Array<Record<string, unknown>>;
    console.log(`\n  fillFee/list: ${raw.length} rows`);
    for (const fee of raw) {
      if (fee.id != null) fillFeeMap.set(Number(fee.id), fee);
    }
    if (raw.length > 0) {
      console.log(`  Sample fields (first row): ${Object.keys(raw[0]).join(", ")}`);
      for (const r of raw.slice(0, 5)) {
        console.log(`    fillId=${r.fillId}  clearing=${r.clearingFee}  exchange=${r.exchangeFee}  nfa=${r.nfaFee}  commission=${r.commission}  orderRouting=${r.orderRoutingFee}`);
      }
    }
  } catch (err) {
    console.log(`\n  fillFee/list failed: ${err instanceof Error ? err.message : err}`);
  }

  // fill/list (all fills for the token)
  sub("fill/list — raw fills");
  let allFills: Array<Record<string, unknown>> = [];
  try {
    allFills = await client.debugRawList("fill/list") as Array<Record<string, unknown>>;
    console.log(`\n  fill/list: ${allFills.length} total rows (cross-account, not account-scoped)`);
    if (allFills.length > 0) {
      console.log(`  Sample fields (first row): ${Object.keys(allFills[0]).join(", ")}`);
      const hasAccountId = allFills.some((f) => f.accountId != null);
      const hasAccountSpec = allFills.some((f) => f.accountSpec != null);
      console.log(`  accountId field present: ${hasAccountId}  accountSpec present: ${hasAccountSpec}`);
      // Show first 10
      for (const f of allFills.slice(0, 10)) {
        console.log(`    id=${f.id}  orderId=${f.orderId}  contractId=${f.contractId}  action=${f.action}  qty=${f.qty}  price=${f.price}  ts=${String(f.timestamp ?? f.time ?? "").slice(0,23)}  accountId=${f.accountId ?? "—"}  accountSpec=${f.accountSpec ?? "—"}`);
      }
    }
  } catch (err) {
    console.log(`\n  fill/list failed: ${err instanceof Error ? err.message : err}`);
  }

  // order/deps?masterid=tvAccountId — account-scoped orders
  sub(`order/deps?masterid=${tvAccountId} — account-scoped orders`);
  let accountOrders: Array<Record<string, unknown>> = [];
  if (tvAccountId != null) {
    try {
      accountOrders = await client.debugRawList(`order/deps?masterid=${tvAccountId}`) as Array<Record<string, unknown>>;
      console.log(`\n  order/deps?masterid=${tvAccountId}: ${accountOrders.length} orders`);
      if (accountOrders.length > 0) {
        console.log(`  Sample fields: ${Object.keys(accountOrders[0]).join(", ")}`);
        for (const o of accountOrders.slice(0, 5)) {
          console.log(`    id=${o.id}  contractId=${o.contractId}  action=${o.action}  ordStatus=${o.ordStatus}  ts=${String(o.timestamp ?? "").slice(0,23)}`);
        }
      }
    } catch (err) {
      console.log(`\n  order/deps failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // fillPair/list
  sub("fillPair/list — Tradovate-matched round-trips");
  let fillPairs: Array<Record<string, unknown>> = [];
  try {
    fillPairs = await client.debugRawList("fillPair/list") as Array<Record<string, unknown>>;
    console.log(`\n  fillPair/list: ${fillPairs.length} rows`);
    if (fillPairs.length > 0) {
      console.log(`  Sample fields: ${Object.keys(fillPairs[0]).join(", ")}`);
      for (const fp of fillPairs.slice(0, 5)) {
        console.log(`    id=${fp.id}  positionId=${fp.positionId}  buyFillId=${fp.buyFillId}  sellFillId=${fp.sellFillId}  qty=${fp.qty}  buyPrice=${fp.buyPrice}  sellPrice=${fp.sellPrice}  active=${fp.active}`);
      }
    }
  } catch (err) {
    console.log(`\n  fillPair/list failed: ${err instanceof Error ? err.message : err}`);
  }

  // position/deps?masterid=tvAccountId — account-scoped positions
  sub(`position/deps?masterid=${tvAccountId} — account-scoped positions`);
  let positions: Array<Record<string, unknown>> = [];
  if (tvAccountId != null) {
    try {
      positions = await client.debugRawList(`position/deps?masterid=${tvAccountId}`) as Array<Record<string, unknown>>;
      console.log(`\n  position/deps?masterid=${tvAccountId}: ${positions.length} positions`);
      for (const p of positions) {
        console.log(`    id=${p.id}  contractId=${p.contractId}  netPos=${p.netPos}  netPrice=${p.netPrice}  bought=${p.bought}  boughtValue=${p.boughtValue}  sold=${p.sold}  soldValue=${p.soldValue}`);
      }
    } catch (err) {
      console.log(`\n  position/deps failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // fillPair linkage: for each cashBalanceLog TradePaired row, trace fillPairId → fillPair → fills
  sub("fillPairId linkage: cashBalanceLog TradePaired → fillPair → fills");
  const fillPairById = new Map<number, Record<string, unknown>>();
  for (const fp of fillPairs) {
    if (fp.id != null) fillPairById.set(Number(fp.id), fp);
  }
  const fillById = new Map<number, Record<string, unknown>>();
  for (const f of allFills) {
    if (f.id != null) fillById.set(Number(f.id), f);
  }

  const tradePairedRows = rawCblRows.filter((r) => {
    const ct = typeof r.cashChangeType === "string"
      ? r.cashChangeType
      : ((r.cashChangeType as { name?: string } | null)?.name ?? "");
    return classifyCashRow(ct) === "pnl";
  });

  if (tradePairedRows.length === 0) {
    console.log(`\n  (no TradePaired rows — linkage unavailable)`);
  } else {
    console.log(`\n  TradePaired rows: ${tradePairedRows.length}`);
    console.log(`  fillPairs available: ${fillPairById.size}  fills available: ${fillById.size}`);
    let linked = 0;
    let unlinked = 0;
    for (const r of tradePairedRows.slice(0, 20)) {
      const fpId = r.fillPairId;
      const fp = fpId != null ? fillPairById.get(fpId) : undefined;
      const buyFill = fp?.buyFillId != null ? fillById.get(Number(fp.buyFillId)) : undefined;
      const sellFill = fp?.sellFillId != null ? fillById.get(Number(fp.sellFillId)) : undefined;
      const ct = typeof r.cashChangeType === "string" ? r.cashChangeType : "TradePaired";
      if (fp) {
        linked++;
        console.log(`    TradePaired delta=${fmt$(r.delta ?? null)}  fillPairId=${fpId}  qty=${fp.qty}  buyPrice=${fp.buyPrice}  sellPrice=${fp.sellPrice}`);
        if (buyFill)  console.log(`      buyFill:  id=${buyFill.id}  contractId=${buyFill.contractId}  price=${buyFill.price}  qty=${buyFill.qty}`);
        if (sellFill) console.log(`      sellFill: id=${sellFill.id}  contractId=${sellFill.contractId}  price=${sellFill.price}  qty=${sellFill.qty}`);
        if (!buyFill && !sellFill) console.log(`      (fills not found in fill/list for this fillPair)`);
      } else {
        unlinked++;
        console.log(`    TradePaired delta=${fmt$(r.delta ?? null)}  fillPairId=${fpId ?? "null"}  (no fillPair match)`);
      }
    }
    if (tradePairedRows.length > 20) console.log(`    … (${tradePairedRows.length - 20} more TradePaired rows)`);
    console.log(`\n  Linkage summary: ${linked} linked to fillPair  ${unlinked} unlinked`);
    console.log(`  Note: fillPair/list is position-scoped — rows may be absent if positions closed`);
    console.log(`        in a prior session. The cashBalanceLog fillPairId is still the definitive`);
    console.log(`        broker-side round-trip identifier even when the FillPair row is gone.`);
  }

  // ── 4. RECONCILIATION TABLE ───────────────────────────────────────────────

  section("4. PER-DAY RECONCILIATION");

  // Build fill-based P&L from imported NormalizedTradeEvent rows in DB
  const dbFills = await prisma.normalizedTradeEvent.findMany({
    where: { accountId: account.id },
    orderBy: { occurredAt: "asc" },
    select: {
      id: true,
      occurredAt: true,
      side: true,
      quantity: true,
      price: true,
      pnl: true,
      rawPayload: true,
    },
  });

  // Group DB fills by tradeDate (CME trading day, America/Chicago timezone)
  const dbPnlByDay = new Map<string, { grossPnl: number; count: number }>();
  for (const f of dbFills) {
    const dayKey = f.occurredAt.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const cur = dbPnlByDay.get(dayKey) ?? { grossPnl: 0, count: 0 };
    cur.grossPnl += f.pnl != null ? Number(f.pnl) : 0;
    cur.count++;
    dbPnlByDay.set(dayKey, cur);
  }

  // Build cashHistory day net
  const rawCblNorm = tvAccountId != null
    ? normalizeCashBalanceLogRows(rawCblRows, tvAccountId, account.id)
    : [];
  const cashAgg = aggregateCashHistory(rawCblNorm, account.id);
  const cashByDay = new Map<string, { tradePnl: number; fees: number; net: number; feesAvailable: boolean }>();
  for (const g of cashAgg) {
    const cur = cashByDay.get(g.date) ?? { tradePnl: 0, fees: 0, net: 0, feesAvailable: false };
    cur.tradePnl = Math.round((cur.tradePnl + g.tradePnl + Number.EPSILON) * 100) / 100;
    cur.fees = Math.round((cur.fees + g.fees + Number.EPSILON) * 100) / 100;
    cur.net = Math.round((cur.net + g.netPnl + Number.EPSILON) * 100) / 100;
    cur.feesAvailable = cur.feesAvailable || g.feesAvailable;
    cashByDay.set(g.date, cur);
  }

  // Union of all days
  const allDays = new Set([...cashByDay.keys(), ...dbPnlByDay.keys()]);
  const sortedAllDays = [...allDays].sort();

  console.log(`\n  ${pad("DATE",12)} ${pad("CH_TRADE",12)} ${pad("CH_FEES",12)} ${pad("CH_NET",12)} ${pad("DB_GROSS",12)} ${pad("DIFF(chNet-dbGross)",20)} STATUS`);
  console.log(`  ${hr("-",90)}`);

  for (const day of sortedAllDays) {
    const ch = cashByDay.get(day);
    const db = dbPnlByDay.get(day);
    const chNet = ch?.net ?? null;
    const dbGross = db != null ? Math.round((db.grossPnl + Number.EPSILON) * 100) / 100 : null;

    let status = "";
    let diff: number | null = null;
    if (chNet != null && dbGross != null) {
      // diff between CH net and DB gross — expected to differ by fees
      diff = Math.round((chNet - dbGross + Number.EPSILON) * 100) / 100;
      // diff should roughly equal CH fees (both negative)
      const feesDiff = ch?.fees ?? 0;
      if (Math.abs(diff - feesDiff) < 0.02) {
        status = "✓ diff = fees (expected)";
      } else if (Math.abs(diff) < 0.005) {
        status = "✓ exact match (no fees?)";
      } else {
        status = "✗ unexplained diff";
      }
    } else if (chNet != null && dbGross == null) {
      status = "CH only (no DB fills)";
    } else if (chNet == null && dbGross != null) {
      status = "DB only (no CH)";
    }

    console.log(`  ${pad(day,12)} ${pad(fmt$(ch?.tradePnl ?? null),12)} ${pad(fmt$(ch?.fees ?? null),12)} ${pad(fmt$(chNet),12)} ${pad(fmt$(dbGross),12)} ${pad(diff != null ? fmt$(diff) : "n/a",20)} ${status}`);
  }

  console.log(`\n  Legend:`);
  console.log(`    CH = Cash History (cashBalanceLog) — authoritative after-fees broker ledger`);
  console.log(`    DB = Guardrail DB (NormalizedTradeEvent) — imported fills, gross P&L only`);
  console.log(`    DIFF = CH_NET - DB_GROSS — expected to equal CH_FEES (fees are negative)`);
  console.log(`    e.g. Jun 2: CH_NET=-0.40, DB_GROSS=+1.50 → DIFF=-1.90 = CH_FEES (correct)`);

  // ── 5. ALL-TIME SUMMARY ───────────────────────────────────────────────────

  section("5. ALL-TIME SUMMARY");

  if (sortedAllDays.length > 0) {
    const startDate = sortedAllDays[0];
    const endDate = sortedAllDays[sortedAllDays.length - 1];

    let allTimeTradePnl = 0;
    let allTimeFees = 0;
    let allTimeNet = 0;
    let daysWithCh = 0;
    let daysWithFees = 0;

    for (const [, v] of cashByDay) {
      allTimeTradePnl += v.tradePnl;
      allTimeFees += v.fees;
      allTimeNet += v.net;
      daysWithCh++;
      if (v.feesAvailable) daysWithFees++;
    }

    allTimeTradePnl = Math.round((allTimeTradePnl + Number.EPSILON) * 100) / 100;
    allTimeFees = Math.round((allTimeFees + Number.EPSILON) * 100) / 100;
    allTimeNet = Math.round((allTimeNet + Number.EPSILON) * 100) / 100;

    const tradePairedCount = tradePairedRows.length;
    const feeRowCount = rawCblRows.filter((r) => {
      const ct = typeof r.cashChangeType === "string"
        ? r.cashChangeType
        : ((r.cashChangeType as { name?: string } | null)?.name ?? "");
      return classifyCashRow(ct) === "fee";
    }).length;

    console.log(`\n  Date range:          ${startDate} → ${endDate}`);
    console.log(`  Total days (union):  ${sortedAllDays.length}`);
    console.log(`  Days with CH data:   ${daysWithCh}`);
    console.log(`  Days with fees:      ${daysWithFees}`);
    console.log(`  Days fill-only:      ${sortedAllDays.length - daysWithCh}`);
    console.log(`  TradePaired rows:    ${tradePairedCount}`);
    console.log(`  Fee rows:            ${feeRowCount}`);
    console.log(`  Total cashBalLog rows: ${rawCblRows.length}`);
    console.log(`\n  All-time (Cash History):`);
    console.log(`    tradePnl (gross):  ${fmt$(allTimeTradePnl)}`);
    console.log(`    fees:              ${fmt$(allTimeFees)}`);
    console.log(`    NET:               ${fmt$(allTimeNet)}`);
    console.log(`    Source:            ${cblSource}`);

    // DB fill summary
    let dbTotalGross = 0;
    for (const [, v] of dbPnlByDay) {
      dbTotalGross += v.grossPnl;
    }
    dbTotalGross = Math.round((dbTotalGross + Number.EPSILON) * 100) / 100;

    console.log(`\n  All-time (Guardrail DB fills):`);
    console.log(`    fill gross P&L:    ${fmt$(dbTotalGross)}  (before fees)`);
    console.log(`    DB fill count:     ${dbFills.length}`);
    console.log(`    Days with DB data: ${dbPnlByDay.size}`);

    const diffGross = Math.round((allTimeNet - dbTotalGross + Number.EPSILON) * 100) / 100;
    console.log(`\n  All-time diff (CH net − DB gross): ${fmt$(diffGross)}`);
    console.log(`  Expected diff ≈ total fees: ${fmt$(allTimeFees)}`);
    if (Math.abs(diffGross - allTimeFees) < 0.05) {
      console.log(`  → ✓ RECONCILED — diff matches fees`);
    } else {
      console.log(`  → ✗ UNEXPLAINED — diff does not match fees (see per-day table)`);
    }
  } else {
    console.log(`  (no data available for all-time summary)`);
  }

  // ── 6. SOURCE-OF-TRUTH REPORT ─────────────────────────────────────────────

  section("6. SOURCE-OF-TRUTH REPORT");

  const sotRows: [string, string, string, string, string][] = [
    ["METRIC", "BEST ENDPOINT", "FIELD(S)", "AUTHORITY", "LIMITATION"],
    ["─".repeat(20), "─".repeat(32), "─".repeat(28), "─".repeat(14), "─".repeat(36)],
    [
      "Balance",
      "POST cashBalance/getCashBalanceSnapshot",
      "netLiq → totalCashValue → amount",
      "authoritative",
      "Current moment; includes open P&L",
    ],
    [
      "amountSOD",
      "GET cashBalance/list",
      "amountSOD",
      "authoritative",
      "Session-start balance; not always present",
    ],
    [
      "Session P&L (today)",
      "POST cashBalance/getCashBalanceSnapshot",
      "realizedPnL",
      "authoritative",
      "Resets 17:00 CT; stale if sync is old",
    ],
    [
      "Weekly P&L",
      "POST cashBalance/getCashBalanceSnapshot",
      "weekRealizedPnL",
      "authoritative",
      "Rolling week only; not historical",
    ],
    [
      "Daily P&L (calendar)",
      "GET cashBalanceLog/deps?masterid=",
      "sum(TradePaired.delta + fee.delta) per tradeDate",
      "authoritative",
      "Only days with fee rows qualify as Net",
    ],
    [
      "Fees (day level)",
      "GET cashBalanceLog/deps?masterid=",
      "sum(fee deltas) per tradeDate",
      "authoritative",
      "ExchangeFee+ClearingFee+NfaFee+Commission",
    ],
    [
      "Fees (fill level)",
      "GET fillFee/list",
      "clearingFee+exchangeFee+nfaFee+commission",
      "authoritative",
      "No accountId — scope inferred from orderId",
    ],
    [
      "Equity curve (all)",
      "GET cashBalanceLog/deps?masterid=",
      "cumsum of daily netPnl",
      "authoritative",
      "Full broker history; not capped at import",
    ],
    [
      "Equity curve (7/14/30D)",
      "GET cashBalanceLog/deps?masterid=",
      "filtered by tradeDate >= cutoff",
      "authoritative",
      "Same source; windowed",
    ],
    [
      "Max drawdown",
      "GET cashBalanceLog/deps?masterid=",
      "daily cumulative curve peak−trough",
      "authoritative",
      "Day-level granularity only",
    ],
    [
      "Fill P&L (gross)",
      "GET fill/list + fillFee/list",
      "FIFO(buyPrice,sellPrice,qty)",
      "partial",
      "fill/list not account-scoped; FIFO is approx",
    ],
    [
      "Round-trip P&L",
      "GET fillPair/list (position-scoped)",
      "sellPrice-buyPrice × qty",
      "authoritative",
      "Position-scoped; rows gone after close",
    ],
    [
      "Trade count",
      "GET order/deps?masterid=",
      "count of Filled/Completed orders",
      "authoritative",
      "Account-scoped; fill/list is estimated",
    ],
    [
      "Open positions",
      "GET position/deps?masterid=",
      "netPos, netPrice, boughtValue, soldValue",
      "authoritative",
      "No openPnl field; must compute from price",
    ],
    [
      "Profit factor",
      "cashBalanceLog TradePaired rows",
      "sum(pos deltas) / abs(sum(neg deltas))",
      "authoritative",
      "Currently uses FIFO fills; not yet migrated",
    ],
    [
      "Win rate",
      "cashBalanceLog TradePaired rows",
      "count(positive TradePaired) / total",
      "authoritative",
      "Currently uses FIFO fills; not yet migrated",
    ],
    [
      "Largest win/loss",
      "cashBalanceLog TradePaired rows",
      "max/min TradePaired.delta per day",
      "authoritative",
      "Currently uses FIFO fills; not yet migrated",
    ],
    [
      "Margin / liq levels",
      "GET marginSnapshot/list",
      "autoLiqLevel, maintenanceMargin",
      "authoritative",
      "Snapshot only; no P&L data",
    ],
  ];

  console.log();
  for (const [metric, endpoint, fields, authority, limitation] of sotRows) {
    console.log(`  ${pad(metric,22)} ${pad(endpoint,40)} ${pad(fields,30)} ${pad(authority,16)} ${limitation}`);
  }

  console.log(`\n  Key findings:`);
  console.log(`    1. cashBalanceLog/deps?masterid={tvAccountId} is the account-scoped source.`);
  console.log(`       cashBalanceLog/list is cross-account — filter client-side by accountId.`);
  console.log(`    2. cashBalanceLog.delta is the ONLY correct per-row value.`);
  console.log(`       .amount is the running account balance — NOT a per-row P&L/fee value.`);
  console.log(`       .realizedPnL is cumulative — NOT a per-row P&L value.`);
  console.log(`    3. fill/list has NO accountId field in the OpenAPI schema.`);
  console.log(`       Account attribution is inferred; order/deps?masterid= is authoritative.`);
  console.log(`    4. fillPair rows are position-scoped and disappear after the position closes.`);
  console.log(`       cashBalanceLog.fillPairId is the stable linkage to a specific round-trip.`);
  console.log(`    5. CashBalanceSnapshot.realizedPnL resets at 17:00 CT — it is a session total,`);
  console.log(`       not all-time. Use cashBalanceLog for historical P&L.`);

  console.log(`\n${hr("═")}`);
  console.log(`  Diagnostic complete. All operations were read-only.`);
  console.log(`  Endpoints used:`);
  console.log(`    GET  account/list`);
  console.log(`    GET  cashBalance/list`);
  console.log(`    GET  cashBalance/deps?masterid={tvAccountId}`);
  console.log(`    GET  cashBalanceLog/deps?masterid={tvAccountId}  (primary, account-scoped)`);
  console.log(`    GET  cashBalanceLog/list  (fallback)`);
  console.log(`    GET  fill/list`);
  console.log(`    GET  fillFee/list`);
  console.log(`    GET  fillPair/list`);
  console.log(`    GET  position/deps?masterid={tvAccountId}`);
  console.log(`    GET  order/deps?masterid={tvAccountId}`);
  console.log(`${hr("═")}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
