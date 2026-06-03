#!/usr/bin/env tsx
/**
 * diagnose-tradovate-history-coverage.ts — read-only history coverage probe.
 *
 * Tests every plausible Tradovate endpoint that could expose historical P&L
 * for account 1868411 / tvAccountId 1734393 (or any account passed as arg).
 * Primary question: does a large losing day (~-$200) exist somewhere in the
 * Tradovate API that our current cashBalanceLog/deps pipeline is missing?
 *
 * Endpoints probed (read-only only):
 *   cashBalanceLog/deps?masterid=<tvId>  — primary account-scoped ledger
 *   cashBalanceLog/list                  — cross-account ledger (all sub-accounts)
 *   cashBalance/deps?masterid=<tvId>     — balance snapshots for account
 *   cashBalance/list                     — balance snapshots cross-account
 *   cashBalance/getCashBalanceSnapshot   — POST live snapshot
 *   fill/list                            — all fills (cross-account)
 *   fillFee/list                         — per-fill fee breakdown
 *   fillPair/list                        — Tradovate-matched round-trips
 *   order/deps?masterid=<tvId>           — account-scoped orders
 *   executionReport/list                 — execution reports
 *   commandReport/list                   — command reports
 *   account/list                         — enumerate all sub-accounts under token
 *   reports/requestreport (POST)         — Performance report (rpt-live host)
 *   Per-account cashBalanceLog sweep     — all tvAccountIds from account/list
 *
 * Safety contract:
 *   100% read-only. GET requests + the read-only POSTs
 *   (cashBalance/getCashBalanceSnapshot, reports/requestreport). No Prisma
 *   writes. No order/cancel/flatten. No lockout/retry changes. No schema or
 *   env changes.
 *
 * Usage:
 *   npx tsx scripts/diagnose-tradovate-history-coverage.ts <accountLabelOrExternalId>
 *   npx tsx scripts/diagnose-tradovate-history-coverage.ts 1868411
 */

import { resolve } from "path";
import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });

import { TradovateClient } from "../src/lib/brokers/tradovate-client.ts";
import { prisma } from "../src/lib/db.ts";
import { normalizeCashBalanceLogRows, cashHistoryDayNet } from "../src/lib/trades/cash-history-fees.ts";
import { parseSnapshotItems } from "../src/lib/brokers/tradovate-client-helpers.ts";

// ── Formatting ────────────────────────────────────────────────────────────────

function fmt$(v: number | null | undefined): string {
  if (v == null) return "n/a";
  const abs = Math.abs(v);
  const sign = v >= 0 ? "+" : "-";
  return `${sign}$${abs.toFixed(2)}`;
}

function pad(s: string | number | null | undefined, w: number): string {
  const str = String(s ?? "n/a");
  return str.length >= w ? str : str + " ".repeat(w - str.length);
}

function hr(char = "─", w = 80): string { return char.repeat(w); }

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

// ── Day-net from raw cashBalanceLog rows ──────────────────────────────────────

function summariseDayNet(dayNet: Record<string, number>, label: string): void {
  const days = Object.keys(dayNet).sort();
  if (days.length === 0) {
    console.log(`  ${label}: no trading days`);
    return;
  }
  const nets = Object.values(dayNet);
  const total = nets.reduce((s, v) => s + v, 0);
  const largeLoss = Math.min(...nets);
  const largeWin  = Math.max(...nets);
  const hasLargeLoss = largeLoss <= -100;
  console.log(`  ${label}: ${days.length} days  earliest=${days[0]}  latest=${days[days.length - 1]}`);
  console.log(`    allTimeNet=${fmt$(total)}  largestLoss=${fmt$(largeLoss)}  largestWin=${fmt$(largeWin)}`);
  if (hasLargeLoss) {
    console.log(`  *** LARGE LOSING DAY FOUND: ${largeLoss <= -100 ? "YES" : "NO"} (threshold -$100) ***`);
  }
  console.log(`  Daily net breakdown:`);
  for (const d of days) {
    const v = dayNet[d]!;
    const flag = v <= -100 ? " ← *** LARGE LOSS ***" : v <= -50 ? " ← significant loss" : "";
    console.log(`    ${d}  ${fmt$(v)}${flag}`);
  }
}

// ── Raw row summary helper ────────────────────────────────────────────────────

function summariseRaw(
  rows: Array<Record<string, unknown>>,
  label: string,
  opts: {
    tsField?: string;
    dateField?: string;
    deltaField?: string;
    amountField?: string;
    accountField?: string;
    typeField?: string;
    targetAccountId?: number | null;
  } = {},
): void {
  const {
    tsField = "timestamp",
    dateField = "tradeDate",
    deltaField = "delta",
    amountField = "amount",
    accountField = "accountId",
    typeField = "cashChangeType",
    targetAccountId = null,
  } = opts;

  const scoped = targetAccountId != null
    ? rows.filter((r) => Number(r[accountField]) === targetAccountId)
    : rows;

  const scopeNote = targetAccountId != null
    ? ` (${scoped.length}/${rows.length} scoped to tvAccountId=${targetAccountId})`
    : ` (${rows.length} total, cross-account)`;

  console.log(`\n  ${label}${scopeNote}`);

  if (scoped.length === 0) {
    console.log(`  (no rows)`);
    return;
  }

  // Timestamps for range
  const timestamps = scoped
    .map((r) => {
      const ts = r[tsField] ?? r[dateField];
      return typeof ts === "string" ? ts : null;
    })
    .filter(Boolean)
    .sort() as string[];

  if (timestamps.length > 0) {
    console.log(`  Earliest ts: ${timestamps[0]}`);
    console.log(`  Latest ts:   ${timestamps[timestamps.length - 1]}`);
  }

  // Sum deltas if present
  const deltas = scoped.map((r) => Number(r[deltaField])).filter((v) => !isNaN(v) && v !== 0);
  if (deltas.length > 0) {
    const sum = deltas.reduce((s, v) => s + v, 0);
    const minDelta = Math.min(...deltas);
    const maxDelta = Math.max(...deltas);
    console.log(`  delta sum=${fmt$(sum)}  min=${fmt$(minDelta)}  max=${fmt$(maxDelta)}  (${deltas.length} non-zero rows)`);
    if (minDelta <= -100) {
      console.log(`  *** SINGLE ROW DELTA <= -$100 FOUND: ${fmt$(minDelta)} ***`);
    }
  }

  // Field keys from first row
  if (scoped.length > 0) {
    console.log(`  Fields: ${Object.keys(scoped[0]!).join(", ")}`);
  }

  // First 5
  console.log(`  First 5 rows:`);
  for (const r of scoped.slice(0, 5)) {
    const ts = r[tsField] ?? r[dateField] ?? "—";
    const delta = r[deltaField] != null ? fmt$(Number(r[deltaField])) : "—";
    const amount = r[amountField] != null ? fmt$(Number(r[amountField])) : "—";
    const type = r[typeField] ?? "—";
    const acc = r[accountField] ?? "—";
    console.log(`    ts=${String(ts).slice(0, 23)}  delta=${pad(delta, 12)}  amount=${pad(amount, 14)}  type=${pad(String(type), 20)}  acc=${acc}`);
  }

  // Last 5 (if more than 5)
  if (scoped.length > 5) {
    console.log(`  Last 5 rows:`);
    for (const r of scoped.slice(-5)) {
      const ts = r[tsField] ?? r[dateField] ?? "—";
      const delta = r[deltaField] != null ? fmt$(Number(r[deltaField])) : "—";
      const amount = r[amountField] != null ? fmt$(Number(r[amountField])) : "—";
      const type = r[typeField] ?? "—";
      const acc = r[accountField] ?? "—";
      console.log(`    ts=${String(ts).slice(0, 23)}  delta=${pad(delta, 12)}  amount=${pad(amount, 14)}  type=${pad(String(type), 20)}  acc=${acc}`);
    }
  }

  // Check any individual row delta <= -100
  const largeLossRows = scoped.filter((r) => Number(r[deltaField]) <= -100);
  if (largeLossRows.length > 0) {
    console.log(`  *** LARGE LOSS ROWS (delta <= -$100): ${largeLossRows.length} ***`);
    for (const r of largeLossRows) {
      console.log(`    ${JSON.stringify(r)}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: npx tsx scripts/diagnose-tradovate-history-coverage.ts <accountLabelOrExternalId>");
    process.exit(1);
  }

  // ── Resolve account from DB ───────────────────────────────────────────────
  section("0. ACCOUNT LOOKUP");

  const account = await prisma.connectedAccount.findFirst({
    where: {
      OR: [
        { externalAccountId: arg },
        { label: arg },
        ...(arg.length < 40 ? [{ id: arg }] : []),
      ],
    },
    select: { id: true, label: true, externalAccountId: true, userId: true },
  });

  if (!account) {
    console.error(`  No ConnectedAccount found matching: ${arg}`);
    console.error(`  Try the label or the Tradovate numeric account ID (externalAccountId).`);
    process.exit(1);
  }

  console.log(`\n  DB account id:       ${account.id}`);
  console.log(`  label:               ${account.label}`);
  console.log(`  externalAccountId:   ${account.externalAccountId}`);
  console.log(`  userId:              ${account.userId}`);

  const client = new TradovateClient(account.id, account.userId);
  await client.initialize();
  const tvAccountId = client.getTvAccountId();
  const externalId  = client.getExternalAccountId();

  console.log(`\n  tvAccountId (resolved by client):  ${tvAccountId ?? "null"}`);
  console.log(`  externalAccountId (from client):   ${externalId ?? "null"}`);

  // ── 1. account/list — enumerate all sub-accounts under this OAuth token ────
  section("1. account/list — ALL SUB-ACCOUNTS UNDER THIS OAUTH TOKEN");

  let allTvAccounts: Array<Record<string, unknown>> = [];
  try {
    allTvAccounts = await client.debugRawList("account/list") as Array<Record<string, unknown>>;
    console.log(`\n  account/list: ${allTvAccounts.length} account(s)`);
    for (const a of allTvAccounts) {
      const isTarget = Number(a.id) === tvAccountId;
      console.log(`    id=${a.id}  name=${a.name ?? a.nickname ?? "—"}  status=${a.status ?? "—"}  marginAccountType=${a.marginAccountType ?? "—"}${isTarget ? "  ← TARGET" : ""}`);
    }
  } catch (err) {
    console.log(`  account/list failed: ${err instanceof Error ? err.message : err}`);
  }

  // ── 2. cashBalanceLog/deps — primary account-scoped ledger ────────────────
  section(`2. cashBalanceLog/deps?masterid=${tvAccountId} — PRIMARY ACCOUNT-SCOPED LEDGER`);

  let primaryCblRows: Array<Record<string, unknown>> = [];
  if (tvAccountId != null) {
    try {
      primaryCblRows = await client.debugRawList(`cashBalanceLog/deps?masterid=${tvAccountId}`) as Array<Record<string, unknown>>;
      summariseRaw(primaryCblRows, `cashBalanceLog/deps?masterid=${tvAccountId}`, {
        tsField: "timestamp",
        deltaField: "delta",
        amountField: "amount",
        accountField: "accountId",
        typeField: "cashChangeType",
        targetAccountId: null, // already scoped
      });

      // Day net via normalization pipeline
      const normalized = normalizeCashBalanceLogRows(
        primaryCblRows as never,
        tvAccountId,
        account.id,
      );
      const dayNet = cashHistoryDayNet(normalized, account.id);
      summariseDayNet(dayNet, "cashBalanceLog/deps day-net (authoritative pipeline)");
    } catch (err) {
      console.log(`  cashBalanceLog/deps failed: ${err instanceof Error ? err.message : err}`);
    }
  } else {
    console.log(`  Skipped — tvAccountId is null`);
  }

  // ── 3. cashBalanceLog/list — cross-account ledger ─────────────────────────
  section("3. cashBalanceLog/list — CROSS-ACCOUNT LEDGER (all sub-accounts)");

  let allCblRows: Array<Record<string, unknown>> = [];
  try {
    allCblRows = await client.debugRawList("cashBalanceLog/list") as Array<Record<string, unknown>>;
    summariseRaw(allCblRows, "cashBalanceLog/list (ALL accounts)", {
      tsField: "timestamp",
      deltaField: "delta",
      amountField: "amount",
      accountField: "accountId",
      typeField: "cashChangeType",
      targetAccountId: null,
    });

    // Group by accountId and show day-net per account
    const byAccount = new Map<number, Array<Record<string, unknown>>>();
    for (const r of allCblRows) {
      const acc = Number(r.accountId);
      if (!isNaN(acc)) {
        const existing = byAccount.get(acc) ?? [];
        existing.push(r);
        byAccount.set(acc, existing);
      }
    }
    console.log(`\n  cashBalanceLog/list grouped by accountId:`);
    for (const [accId, rows] of byAccount) {
      const isTarget = accId === tvAccountId;
      const normalized = normalizeCashBalanceLogRows(rows as never, accId, account.id);
      const dayNet = cashHistoryDayNet(normalized, account.id);
      const days = Object.keys(dayNet).sort();
      const nets = Object.values(dayNet);
      const total = nets.reduce((s, v) => s + v, 0);
      const largeLoss = nets.length > 0 ? Math.min(...nets) : null;
      const hasLargeLoss = largeLoss != null && largeLoss <= -100;
      console.log(`    accountId=${accId}${isTarget ? " ← TARGET" : ""}  cblRows=${rows.length}  tradingDays=${days.length}  allTimeNet=${fmt$(total)}  largeLoss=${fmt$(largeLoss)}${hasLargeLoss ? "  ← *** LARGE LOSS ***" : ""}`);
      if (days.length > 0) {
        for (const d of days) {
          const v = dayNet[d]!;
          const flag = v <= -100 ? " ← *** LARGE LOSS ***" : "";
          console.log(`      ${d}  ${fmt$(v)}${flag}`);
        }
      }
    }
  } catch (err) {
    console.log(`  cashBalanceLog/list failed: ${err instanceof Error ? err.message : err}`);
  }

  // ── 4. Per-account cashBalanceLog/deps sweep for all tvAccountIds ─────────
  section("4. PER-ACCOUNT cashBalanceLog/deps SWEEP (all tvAccountIds from account/list)");

  for (const tvAcc of allTvAccounts) {
    const tvId = Number(tvAcc.id);
    const accName = String(tvAcc.name ?? tvAcc.nickname ?? tvId);
    const isTarget = tvId === tvAccountId;
    console.log(`\n  --- tvAccountId=${tvId} (${accName})${isTarget ? " ← TARGET" : ""} ---`);
    try {
      const rows = await client.debugRawList(`cashBalanceLog/deps?masterid=${tvId}`) as Array<Record<string, unknown>>;
      console.log(`  cashBalanceLog/deps?masterid=${tvId}: ${rows.length} rows`);
      if (rows.length === 0) {
        console.log(`  (no rows)`);
        continue;
      }

      // Use the tvId as both tvAccountId for normalization (the normalization
      // uses tvAccountId to filter accountId field from raw rows).
      // For non-target accounts we pass account.id as the DB key — the dayNet
      // result is keyed by DB accountId so we need a consistent key; here we
      // just reuse the same DB account.id since we only care about the dates.
      const normalized = normalizeCashBalanceLogRows(rows as never, tvId, account.id);
      const dayNet = cashHistoryDayNet(normalized, account.id);
      const days = Object.keys(dayNet).sort();
      const nets = Object.values(dayNet);
      if (days.length === 0) {
        // Try computing dayNet directly from delta values without normalization filter
        const rawDeltaByDay = new Map<string, number>();
        for (const r of rows) {
          const ct = typeof r.cashChangeType === "string"
            ? r.cashChangeType
            : (typeof (r.cashChangeType as Record<string, unknown> | null)?.name === "string"
              ? (r.cashChangeType as Record<string, unknown>).name as string
              : "");
          if (!["TradePaired", "ExchangeFee", "ClearingFee", "NfaFee", "Commission"].includes(ct)) continue;
          const delta = typeof r.delta === "number" ? r.delta : parseFloat(String(r.delta ?? ""));
          if (isNaN(delta)) continue;
          // Use tradeDate or timestamp for day bucketing
          const ts = String(r.tradeDate ?? r.timestamp ?? "").slice(0, 10);
          if (!ts || ts.length < 10) continue;
          rawDeltaByDay.set(ts, (rawDeltaByDay.get(ts) ?? 0) + delta);
        }
        if (rawDeltaByDay.size > 0) {
          console.log(`  (normalization filtered all rows — showing raw delta sum by tradeDate/timestamp):`);
          for (const [d, v] of [...rawDeltaByDay.entries()].sort()) {
            const flag = v <= -100 ? " ← *** LARGE LOSS ***" : "";
            console.log(`    ${d}  ${fmt$(v)}${flag}`);
          }
        } else {
          console.log(`  (normalization produced 0 trading days; raw delta sum also empty)`);
          // Print first 3 raw rows to diagnose
          console.log(`  First 3 raw rows: ${JSON.stringify(rows.slice(0, 3))}`);
        }
        continue;
      }

      const total = nets.reduce((s, v) => s + v, 0);
      const largeLoss = Math.min(...nets);
      const hasLargeLoss = largeLoss <= -100;
      console.log(`  tradingDays=${days.length}  allTimeNet=${fmt$(total)}  largeLoss=${fmt$(largeLoss)}${hasLargeLoss ? "  ← *** LARGE LOSS ***" : ""}`);
      for (const d of days) {
        const v = dayNet[d]!;
        const flag = v <= -100 ? " ← *** LARGE LOSS ***" : "";
        console.log(`    ${d}  ${fmt$(v)}${flag}`);
      }
    } catch (err) {
      console.log(`  cashBalanceLog/deps?masterid=${tvId} failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── 5. cashBalance/list — balance snapshots cross-account ────────────────
  section("5. cashBalance/list — BALANCE SNAPSHOTS (cross-account)");

  try {
    const rows = await client.debugRawList("cashBalance/list") as Array<Record<string, unknown>>;
    summariseRaw(rows, "cashBalance/list", {
      tsField: "timestamp",
      deltaField: "cashChange",
      amountField: "balance",
      accountField: "accountId",
      typeField: "cashBalanceType",
      targetAccountId: tvAccountId,
    });
    if (rows.length > 0) {
      // Show balance history for target account sorted by timestamp
      const scoped = tvAccountId != null
        ? rows.filter((r) => Number(r.accountId) === tvAccountId)
        : rows;
      const sorted = [...scoped].sort((a, b) =>
        String(a.timestamp ?? "").localeCompare(String(b.timestamp ?? "")),
      );
      if (sorted.length > 0) {
        console.log(`\n  Balance history for tvAccountId=${tvAccountId} (sorted by timestamp):`);
        console.log(`  Note: look for balance drops of ~-$200 between consecutive rows`);
        let prevBalance: number | null = null;
        for (const r of sorted) {
          const bal = Number(r.balance);
          const ts = String(r.timestamp ?? "—").slice(0, 23);
          const drop = prevBalance != null && !isNaN(bal) ? bal - prevBalance : null;
          const flag = drop != null && drop <= -100 ? "  ← *** LARGE DROP ***" : "";
          console.log(`    ${ts}  balance=${fmt$(isNaN(bal) ? null : bal)}  change=${drop != null ? fmt$(drop) : "—"}${flag}`);
          if (!isNaN(bal)) prevBalance = bal;
        }
      }
    }
  } catch (err) {
    console.log(`  cashBalance/list failed: ${err instanceof Error ? err.message : err}`);
  }

  // ── 6. cashBalance/deps?masterid=<tvId> ──────────────────────────────────
  section(`6. cashBalance/deps?masterid=${tvAccountId}`);

  if (tvAccountId != null) {
    try {
      const rows = await client.debugRawList(`cashBalance/deps?masterid=${tvAccountId}`) as Array<Record<string, unknown>>;
      summariseRaw(rows, `cashBalance/deps?masterid=${tvAccountId}`, {
        tsField: "timestamp",
        deltaField: "cashChange",
        amountField: "balance",
        accountField: "accountId",
        typeField: "cashBalanceType",
        targetAccountId: null,
      });
    } catch (err) {
      console.log(`  cashBalance/deps failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── 7. cashBalance/getCashBalanceSnapshot (POST) ──────────────────────────
  section("7. cashBalance/getCashBalanceSnapshot (POST)");

  try {
    // This is the only POST in this script — it is read-only (snapshot).
    const snapRows = await client.debugRawList("cashBalance/getCashBalanceSnapshot") as Array<Record<string, unknown>>;
    console.log(`\n  GET cashBalance/getCashBalanceSnapshot: ${snapRows.length} rows`);
    for (const r of snapRows.slice(0, 5)) {
      console.log(`    ${JSON.stringify(r)}`);
    }
  } catch (err) {
    // getCashBalanceSnapshot requires POST — try via client's getCashBalanceSnapshot if available
    console.log(`  GET cashBalance/getCashBalanceSnapshot not supported (expected — needs POST)`);
    console.log(`  Error: ${err instanceof Error ? err.message : err}`);
  }

  // ── 8. fill/list — raw fills (cross-account) ──────────────────────────────
  section("8. fill/list — RAW FILLS (cross-account)");

  let allFills: Array<Record<string, unknown>> = [];
  try {
    allFills = await client.debugRawList("fill/list") as Array<Record<string, unknown>>;
    summariseRaw(allFills, "fill/list", {
      tsField: "timestamp",
      deltaField: "pnl",
      amountField: "price",
      accountField: "accountId",
      typeField: "action",
      targetAccountId: tvAccountId,
    });

    // Look for fills on OTHER accounts that might explain a large P&L
    if (tvAccountId != null) {
      const otherFills = allFills.filter((r) => Number(r.accountId) !== tvAccountId && r.accountId != null);
      if (otherFills.length > 0) {
        console.log(`\n  *** Fills belonging to OTHER tvAccountIds (cross-account contamination risk): ${otherFills.length} ***`);
        const otherAccIds = new Set(otherFills.map((r) => Number(r.accountId)));
        for (const otherId of otherAccIds) {
          const cnt = otherFills.filter((r) => Number(r.accountId) === otherId).length;
          console.log(`    tvAccountId=${otherId}: ${cnt} fill(s)`);
        }
      }
    }
  } catch (err) {
    console.log(`  fill/list failed: ${err instanceof Error ? err.message : err}`);
  }

  // ── 9. fillFee/list ───────────────────────────────────────────────────────
  section("9. fillFee/list — PER-FILL FEE BREAKDOWN");

  try {
    const rows = await client.debugRawList("fillFee/list") as Array<Record<string, unknown>>;
    console.log(`\n  fillFee/list: ${rows.length} rows`);
    if (rows.length > 0) {
      console.log(`  Fields: ${Object.keys(rows[0]!).join(", ")}`);
      const totalFees = rows.reduce((s, r) => {
        const c = Number(r.clearingFee ?? 0);
        const e = Number(r.exchangeFee ?? 0);
        const n = Number(r.nfaFee ?? 0);
        const co = Number(r.commission ?? 0);
        return s + c + e + n + co;
      }, 0);
      console.log(`  Total fees across all rows: ${fmt$(totalFees)}`);
      console.log(`  First 5:`);
      for (const r of rows.slice(0, 5)) {
        console.log(`    fillId=${r.fillId}  clearing=${r.clearingFee}  exchange=${r.exchangeFee}  nfa=${r.nfaFee}  commission=${r.commission}`);
      }
    }
  } catch (err) {
    console.log(`  fillFee/list failed: ${err instanceof Error ? err.message : err}`);
  }

  // ── 10. fillPair/list — Tradovate round-trips ─────────────────────────────
  section("10. fillPair/list — TRADOVATE-MATCHED ROUND-TRIPS");

  try {
    const rows = await client.debugRawList("fillPair/list") as Array<Record<string, unknown>>;
    console.log(`\n  fillPair/list: ${rows.length} rows`);
    if (rows.length > 0) {
      console.log(`  Fields: ${Object.keys(rows[0]!).join(", ")}`);
      // Compute gross P&L per row (sellPrice - buyPrice) * pointValue (unknown, skip)
      // Just list all rows with prices for manual review
      console.log(`  All fillPairs:`);
      for (const r of rows) {
        const buyP  = Number(r.buyPrice ?? 0);
        const sellP = Number(r.sellPrice ?? 0);
        const qty   = Number(r.qty ?? 1);
        const rawDiff = (sellP - buyP) * qty;
        const ts = String(r.buyFillTimestamp ?? r.createdAt ?? "—").slice(0, 23);
        console.log(`    id=${r.id}  qty=${qty}  buy=${buyP}  sell=${sellP}  rawDiff=${rawDiff.toFixed(4)}  active=${r.active}  ts=${ts}`);
      }
    }
  } catch (err) {
    console.log(`  fillPair/list failed: ${err instanceof Error ? err.message : err}`);
  }

  // ── 11. order/deps?masterid=<tvId> ───────────────────────────────────────
  section(`11. order/deps?masterid=${tvAccountId} — ACCOUNT-SCOPED ORDERS`);

  if (tvAccountId != null) {
    try {
      const rows = await client.debugRawList(`order/deps?masterid=${tvAccountId}`) as Array<Record<string, unknown>>;
      console.log(`\n  order/deps?masterid=${tvAccountId}: ${rows.length} orders`);
      if (rows.length > 0) {
        console.log(`  Fields: ${Object.keys(rows[0]!).join(", ")}`);
        console.log(`  First 5:`);
        for (const r of rows.slice(0, 5)) {
          console.log(`    id=${r.id}  action=${r.action}  qty=${r.qty}  contractId=${r.contractId}  ordStatus=${r.ordStatus}  ts=${String(r.timestamp ?? "—").slice(0, 23)}`);
        }
      }
    } catch (err) {
      console.log(`  order/deps failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // ── 12. executionReport/list ──────────────────────────────────────────────
  section("12. executionReport/list");

  try {
    const rows = await client.debugRawList("executionReport/list") as Array<Record<string, unknown>>;
    console.log(`\n  executionReport/list: ${rows.length} rows`);
    if (rows.length > 0) {
      console.log(`  Fields: ${Object.keys(rows[0]!).join(", ")}`);
      const scoped = tvAccountId != null
        ? rows.filter((r) => Number(r.accountId) === tvAccountId)
        : rows;
      console.log(`  Rows for tvAccountId=${tvAccountId}: ${scoped.length}`);
      for (const r of scoped.slice(0, 5)) {
        console.log(`    id=${r.id}  action=${r.action}  qty=${r.qty}  price=${r.price}  ts=${String(r.timestamp ?? "—").slice(0, 23)}`);
      }
    }
  } catch (err) {
    console.log(`  executionReport/list failed: ${err instanceof Error ? err.message : err}`);
  }

  // ── 13. commandReport/list ────────────────────────────────────────────────
  section("13. commandReport/list");

  try {
    const rows = await client.debugRawList("commandReport/list") as Array<Record<string, unknown>>;
    console.log(`\n  commandReport/list: ${rows.length} rows`);
    if (rows.length > 0) {
      console.log(`  Fields: ${Object.keys(rows[0]!).join(", ")}`);
      console.log(`  First 5:`);
      for (const r of rows.slice(0, 5)) {
        console.log(`    ${JSON.stringify(r)}`);
      }
    }
  } catch (err) {
    console.log(`  commandReport/list failed: ${err instanceof Error ? err.message : err}`);
  }

  // ── 14. reports/requestreport (POST) — exhaustive body-format probe ─────────
  section("14. reports/requestreport (POST) — EXHAUSTIVE FORMAT PROBE");

  const accountName = await client.getAccountName();
  const tvAccountIdStr = tvAccountId != null ? String(tvAccountId) : null;

  console.log(`\n  Account name (from account/list nickname ?? name): ${accountName ?? "(null)"}`);
  console.log(`  tvAccountId as string: ${tvAccountIdStr ?? "(null)"}`);
  console.log(`  externalAccountId: ${externalId ?? "(null)"}`);

  // Helper: print a report result clearly
  function printReportResult(
    label: string,
    sentBody: string,
    result: { status: number; body: string; contentType: string | null } | null,
  ): void {
    console.log(`\n  ── Variant: ${label}`);
    // Log sent body WITHOUT any secrets (no Authorization header value)
    console.log(`  Sent body: ${sentBody}`);
    if (result == null) {
      console.log(`  Result: null (reports URL not configured or no access token)`);
      return;
    }
    console.log(`  HTTP ${result.status}  Content-Type: ${result.contentType ?? "(none)"}`);
    const preview = result.body.slice(0, 600).replace(/[\r\n]+/g, " ").trim();
    console.log(`  Body (first 600 chars): ${preview}`);
    if (result.body.length > 600) console.log(`  (truncated — total ${result.body.length} chars)`);

    // Flag any large negative values
    const matches = result.body.match(/[-][\d,]+\.[\d]{2}/g) ?? [];
    const largeNeg = matches.filter((m) => Math.abs(parseFloat(m.replace(/,/g, ""))) >= 100);
    if (largeNeg.length > 0) console.log(`  *** LARGE NEG VALUES: ${largeNeg.join(", ")} ***`);

    if (result.status >= 200 && result.status < 300) {
      console.log(`  ✓ SUCCESS (2xx) — report returned`);
    } else {
      console.log(`  ✗ FAILED (${result.status})`);
    }
  }

  // Date formatting helpers
  const today = new Date();
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const fmtMMDD = (d: Date): string => {
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${mm}/${dd}/${d.getFullYear()}`;
  };
  const fmtISO = (d: Date): string => d.toLocaleDateString("en-CA");

  const startMMDD = fmtMMDD(oneYearAgo);
  const endMMDD   = fmtMMDD(today);
  const startISO  = fmtISO(oneYearAgo);
  const endISO    = fmtISO(today);

  console.log(`\n  Date range probed: ${startISO} → ${endISO} (last 365 days)`);
  console.log(`  MM/DD/YYYY format: ${startMMDD} → ${endMMDD}`);

  // Build all candidate account identifiers to try
  const accountIds = [...new Set([accountName, tvAccountIdStr, externalId].filter(Boolean) as string[])];
  console.log(`  Account identifiers to try: ${accountIds.join(", ")}`);

  // Variants matrix
  type Variant = {
    label: string;
    body: Record<string, unknown>;
    escapeSlashes?: boolean;
  };

  const variants: Variant[] = [];

  // For each account identifier, generate multiple body formats
  for (const accId of accountIds) {
    // V1: Original format with America/Chicago timezone and MM/DD/YYYY dates
    variants.push({
      label: `acct="${accId}" tz=America/Chicago dates=MM/DD/YYYY startTime=17:00 (original)`,
      body: {
        name: "Performance",
        timezone: "America/Chicago",
        params: [
          { name: "startDate", value: startMMDD },
          { name: "endDate",   value: endMMDD },
          { name: "startTime", value: "17:00:00" },
          { name: "endTime",   value: "16:59:59" },
          { name: "account",   value: accId },
        ],
        representationType: "html",
        template: "Flex.html",
      },
    });

    // V2: Escaped forward slashes in timezone (fixes "illegal number at /")
    variants.push({
      label: `acct="${accId}" tz=America\\/Chicago (escaped slash) dates=MM/DD/YYYY`,
      body: {
        name: "Performance",
        timezone: "America/Chicago",
        params: [
          { name: "startDate", value: startMMDD },
          { name: "endDate",   value: endMMDD },
          { name: "startTime", value: "00:00:00" },
          { name: "endTime",   value: "23:59:59" },
          { name: "account",   value: accId },
        ],
        representationType: "html",
        template: "Flex.html",
      },
      escapeSlashes: true,
    });

    // V3: No timezone field
    variants.push({
      label: `acct="${accId}" no-timezone dates=MM/DD/YYYY`,
      body: {
        name: "Performance",
        params: [
          { name: "startDate", value: startMMDD },
          { name: "endDate",   value: endMMDD },
          { name: "startTime", value: "00:00:00" },
          { name: "endTime",   value: "23:59:59" },
          { name: "account",   value: accId },
        ],
        representationType: "html",
        template: "Flex.html",
      },
    });

    // V4: UTC timezone
    variants.push({
      label: `acct="${accId}" tz=UTC dates=MM/DD/YYYY`,
      body: {
        name: "Performance",
        timezone: "UTC",
        params: [
          { name: "startDate", value: startMMDD },
          { name: "endDate",   value: endMMDD },
          { name: "startTime", value: "00:00:00" },
          { name: "endTime",   value: "23:59:59" },
          { name: "account",   value: accId },
        ],
        representationType: "html",
        template: "Flex.html",
      },
    });

    // V5: ISO dates (YYYY-MM-DD) instead of MM/DD/YYYY
    variants.push({
      label: `acct="${accId}" tz=UTC dates=YYYY-MM-DD`,
      body: {
        name: "Performance",
        timezone: "UTC",
        params: [
          { name: "startDate", value: startISO },
          { name: "endDate",   value: endISO },
          { name: "startTime", value: "00:00:00" },
          { name: "endTime",   value: "23:59:59" },
          { name: "account",   value: accId },
        ],
        representationType: "html",
        template: "Flex.html",
      },
    });

    // V6: CSV representationType (avoids html template issues)
    variants.push({
      label: `acct="${accId}" tz=UTC representationType=csv`,
      body: {
        name: "Performance",
        timezone: "UTC",
        params: [
          { name: "startDate", value: startMMDD },
          { name: "endDate",   value: endMMDD },
          { name: "startTime", value: "00:00:00" },
          { name: "endTime",   value: "23:59:59" },
          { name: "account",   value: accId },
        ],
        representationType: "csv",
      },
    });

    // V7: JSON representationType
    variants.push({
      label: `acct="${accId}" tz=UTC representationType=json`,
      body: {
        name: "Performance",
        timezone: "UTC",
        params: [
          { name: "startDate", value: startMMDD },
          { name: "endDate",   value: endMMDD },
          { name: "account",   value: accId },
        ],
        representationType: "json",
      },
    });

    // V8: Minimal body — only required fields from Tradovate docs
    variants.push({
      label: `acct="${accId}" minimal (name+params only, no tz/template/repType)`,
      body: {
        name: "Performance",
        params: [
          { name: "startDate", value: startMMDD },
          { name: "endDate",   value: endMMDD },
          { name: "account",   value: accId },
        ],
      },
    });
  }

  // Also try with no account param (server-side default)
  variants.push({
    label: `no account param, tz=UTC, csv`,
    body: {
      name: "Performance",
      timezone: "UTC",
      params: [
        { name: "startDate", value: startMMDD },
        { name: "endDate",   value: endMMDD },
      ],
      representationType: "csv",
    },
  });

  console.log(`\n  Testing ${variants.length} request body variants against reports/requestreport...`);

  let firstSuccess: { label: string; body: string; result: { status: number; body: string; contentType: string | null } } | null = null;

  for (const v of variants) {
    try {
      const result = await client.debugRawPost("reports/requestreport", v.body, {
        escapeSlashes: v.escapeSlashes,
      });
      const sentBody = result?.sentBody ?? JSON.stringify(v.body);
      printReportResult(v.label, sentBody, result);
      if (result && result.status >= 200 && result.status < 300 && firstSuccess == null) {
        firstSuccess = { label: v.label, body: sentBody, result };
      }
      // Stop on first success to avoid excessive API calls
      if (firstSuccess) break;
    } catch (err) {
      console.log(`\n  ── Variant: ${v.label}`);
      console.log(`  Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (firstSuccess) {
    console.log(`\n  *** FIRST SUCCESSFUL VARIANT: "${firstSuccess.label}" ***`);
    console.log(`  Full response body:`);
    console.log(firstSuccess.result.body.slice(0, 3000));
  } else {
    console.log(`\n  All ${variants.length} variants failed or returned non-2xx.`);
    console.log(`  Conclusion: reports/requestreport is not available for this account/token.`);
  }

  // ── 15. SUMMARY: Was the large losing day found? ──────────────────────────
  section("15. SUMMARY — COVERAGE DIAGNOSIS");

  console.log(`
  Target account: DB id=${account.id}  label=${account.label}
                  tvAccountId=${tvAccountId}  externalId=${externalId}

  Questions answered by this diagnostic:

  Q1. Is cashBalanceLog/deps complete or partial?
      → See Section 2: how many rows and what date range did /deps return?
        A complete history should cover the full account lifetime.
        If earliest ts is recent (< 90 days), retention/windowing may apply.

  Q2. Does any endpoint expose the missing large losing day (net <= -$100)?
      → Search above output for "*** LARGE LOSS ***" flags.
        Sections 2, 3, 4 cover Cash History; Section 5 covers balance snapshots.

  Q3. Does cashBalance/list show a balance drop of ~-$200?
      → See Section 5 "Large DROP" flags in the balance history.

  Q4. Is the loss day absent from Tradovate API entirely?
      → If no "LARGE LOSS" flag appears in any section, the day is absent
        from all Tradovate read-only endpoints — it may be on a different
        account or may pre-date API retention.

  Q5. Could the large loss be on another tvAccountId under the same OAuth token?
      → See Section 4 per-account sweep. Any non-target account with
        largeLoss <= -$100 would confirm cross-account origin.

  Q6. All sub-accounts under token:
`);

  for (const a of allTvAccounts) {
    const isTarget = Number(a.id) === tvAccountId;
    console.log(`      id=${a.id}  name=${a.name ?? a.nickname ?? "—"}${isTarget ? "  ← TARGET" : ""}`);
  }

  console.log(`
  Source-of-truth recommendation (preliminary — update after reviewing output):
  - If cashBalanceLog/deps covers only recent history: the API has retention
    limits and older P&L is unavailable. cashBalanceLog is still the correct
    source for what IS available.
  - If another tvAccountId shows the large losing day: the UI should aggregate
    across all sub-accounts under the token, or clarify which account is shown.
  - If no endpoint shows the large losing day: it may be a prop-firm simulated
    reset or a manual adjustment not recorded in the Cash History ledger.
`);
}

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
