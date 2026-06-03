#!/usr/bin/env tsx
/**
 * diagnose-tradovate-historical-fees.ts
 *
 * Read-only probe for per-fill fee data for historical trades.
 *
 * Context:
 *   Historical Fills report now returns Apr 30 / May 4 fill rows via the narrow
 *   window fix.  The Trades page shows Gross P&L but Fees = "Not reported" for
 *   those rows.  This script probes every available fee source to find one that
 *   covers historical dates and can join to reconstructed trades by fillId/orderId.
 *
 * Sources probed (all read-only):
 *   1. cashBalanceLog/deps?masterid={tvAccountId}
 *      — account-scoped live endpoint; carries fillId, delta, cashChangeType.
 *      Does it cover Apr 30 / May 4?
 *   2. reports/requestreport "Cash History" (Default.html, narrow window)
 *      — report equivalent; might return individual fee rows with fillId.
 *   3. reports/requestreport "Cash History" (Default.md, narrow window)
 *      — alternate template; different column layout?
 *   4. reports/requestreport "Performance" (Default.html, narrow window)
 *      — already used by ABH; check if it exposes per-trade fees.
 *
 * For each successful source:
 *   - Dump raw column headers.
 *   - Dump first 3 rows with all fields.
 *   - Report whether fillId / orderId is present.
 *   - Report fee rows for Apr 30, May 4, Jun 2.
 *
 * Reconciliation check (final section):
 *   For Apr 30 and May 4, compute:
 *     Fills report → gross P&L per trade
 *     Fee source   → fees per trade (joined by fillId if available)
 *     Net          → gross + fees
 *     ABH dayNet   → known ground truth
 *     Delta        → net vs ABH (should be 0 or very small FP rounding)
 *
 * Safety:
 *   100% read-only. No Prisma writes. No broker writes. No schema changes.
 *   No env changes. GETs and report POSTs only.
 *
 * Usage:
 *   npx tsx scripts/diagnose-tradovate-historical-fees.ts <accountLabelOrExternalId>
 *   npx tsx scripts/diagnose-tradovate-historical-fees.ts 1868411
 */

import { resolve } from "path";
import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });

import { TradovateClient } from "../src/lib/brokers/tradovate-client.ts";
import { parseFillsReport } from "../src/lib/brokers/tradovate-fills-report.ts";
import { formatDateMMDDYYYY } from "../src/lib/brokers/tradovate-report-date.ts";
import { prisma } from "../src/lib/db.ts";

// ── Formatting ────────────────────────────────────────────────────────────────

function fmt$(v: number | null | undefined): string {
  if (v == null) return "n/a";
  const s = v >= 0 ? "+" : "-";
  return `${s}$${Math.abs(v).toFixed(2)}`;
}

function hr(char = "─", w = 80): string { return char.repeat(w); }
function section(title: string): void {
  console.log("\n" + hr("═"));
  console.log(`  ${title}`);
  console.log(hr("═"));
}
function sub(title: string): void {
  console.log(`\n  ${hr("-", 70)}`);
  console.log(`  ${title}`);
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function mmddyyyy(isoDate: string): string {
  // "YYYY-MM-DD" → "MM/DD/YYYY"
  return formatDateMMDDYYYY(isoDate);
}

function narrow(dateISO: string): { startStr: string; endStr: string } {
  const d = new Date(`${dateISO}T00:00:00Z`);
  const prev = new Date(d.getTime() - 24 * 60 * 60 * 1000);
  const next = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  return {
    startStr: mmddyyyy(prev.toLocaleDateString("en-CA")),
    endStr:   mmddyyyy(next.toLocaleDateString("en-CA")),
  };
}

// ── Raw-report helper ─────────────────────────────────────────────────────────

async function probeReport(
  client: TradovateClient,
  label: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: string; ct: string | null }> {
  try {
    const r = await client.debugRawPost("reports/requestreport", body);
    if (!r) {
      console.log(`  [!] ${label} → no reports URL or token`);
      return { ok: false, status: 0, body: "", ct: null };
    }
    const ok = r.status >= 200 && r.status < 300;
    console.log(`  [${ok ? "✓" : "✗"}] ${label} → HTTP ${r.status}  ct=${r.contentType ?? "—"}`);
    if (!ok) {
      console.log(`      ${r.body.slice(0, 200).replace(/\s+/g, " ")}`);
    }
    return { ok, status: r.status, body: r.body, ct: r.contentType };
  } catch (err) {
    console.log(`  [!] ${label} → error: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, status: 0, body: "", ct: null };
  }
}

// ── HTML table extractor ──────────────────────────────────────────────────────

type TableData = { headers: string[]; rows: Record<string, string>[] };

function extractHtmlTables(html: string): TableData[] {
  const out: TableData[] = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = tableRe.exec(html)) !== null) {
    const tableBody = tm[1]!;
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    const cellRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const allRows: string[][] = [];
    let rm: RegExpExecArray | null;
    while ((rm = rowRe.exec(tableBody)) !== null) {
      const cells: string[] = [];
      let cm: RegExpExecArray | null;
      cellRe.lastIndex = 0;
      while ((cm = cellRe.exec(rm[1]!)) !== null) {
        cells.push(cm[1]!.replace(/<[^>]+>/g, "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim());
      }
      if (cells.length > 0) allRows.push(cells);
    }
    if (allRows.length < 2) continue;
    const headers = allRows[0]!;
    const rows = allRows.slice(1).map((cells) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = cells[i] ?? ""; });
      return obj;
    });
    out.push({ headers, rows });
  }
  return out;
}

// ── Dump table ────────────────────────────────────────────────────────────────

function dumpTable(t: TableData, label: string, maxRows = 5): void {
  console.log(`\n  TABLE: ${label}`);
  console.log(`    Columns (${t.headers.length}): ${t.headers.join(" | ")}`);
  const fillIdCol = t.headers.find((h) => /fill.*id|fillid/i.test(h));
  const orderIdCol = t.headers.find((h) => /order.*id|orderid/i.test(h));
  const feeCol = t.headers.find((h) => /fee|commission|charge/i.test(h));
  const typeCol = t.headers.find((h) => /type|change|kind/i.test(h));
  const amtCol = t.headers.find((h) => /amount|delta|value|net|gross|pnl/i.test(h));
  const tsCol = t.headers.find((h) => /time|stamp|date|when/i.test(h));
  console.log(`    Key fields found: fillId=${fillIdCol ?? "—"} orderId=${orderIdCol ?? "—"} fee=${feeCol ?? "—"} type=${typeCol ?? "—"} amount=${amtCol ?? "—"} timestamp=${tsCol ?? "—"}`);
  const sample = t.rows.slice(0, maxRows);
  for (const row of sample) {
    console.log(`    Row: ${JSON.stringify(row).slice(0, 280)}`);
  }
  if (t.rows.length > maxRows) console.log(`    … ${t.rows.length - maxRows} more rows`);
}

// ── cashBalanceLog raw extractor ──────────────────────────────────────────────

interface CashLogRow {
  fillId: number | null;
  fillPairId: number | null;
  accountId: number | null;
  contractId: number | null;
  contract: string | null;
  delta: number | null;
  cashChangeType: string | null;
  tradeDate: string | null;
  timestamp: string | null;
}

function parseCashLogRow(raw: Record<string, unknown>): CashLogRow {
  const getStr = (k: string) => {
    const v = raw[k];
    if (v == null) return null;
    if (typeof v === "object" && v !== null && "name" in v) return String((v as Record<string, unknown>)["name"]);
    return String(v);
  };
  const getNum = (k: string) => {
    const v = raw[k];
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const td = raw["tradeDate"];
  let tradeDate: string | null = null;
  if (td && typeof td === "object" && !Array.isArray(td)) {
    const o = td as Record<string, unknown>;
    if (o["year"] && o["month"] && o["day"]) {
      tradeDate = `${o["year"]}-${String(o["month"]).padStart(2, "0")}-${String(o["day"]).padStart(2, "0")}`;
    }
  } else if (typeof td === "string" && td) {
    tradeDate = td.slice(0, 10);
  }
  return {
    fillId: getNum("fillId"),
    fillPairId: getNum("fillPairId"),
    accountId: getNum("accountId"),
    contractId: getNum("contractId"),
    contract: getStr("contract"),
    delta: getNum("delta"),
    cashChangeType: getStr("cashChangeType"),
    tradeDate,
    timestamp: getStr("timestamp"),
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: npx tsx scripts/diagnose-tradovate-historical-fees.ts <accountLabelOrExternalId>");
    process.exit(1);
  }

  const account = await prisma.connectedAccount.findFirst({
    where: {
      OR: [
        { label: { contains: arg } },
        { externalAccountId: arg },
        { id: arg },
      ],
    },
  });
  if (!account) {
    console.error(`No account found matching "${arg}"`);
    process.exit(1);
  }

  console.log(`\n  Account: id=${account.id}  label=${account.label}`);

  const client = new TradovateClient(account.id, account.userId);
  await client.initialize();

  const tvAccountId = client.getTvAccountId();
  const accountName = await client.getAccountName();
  console.log(`  tvAccountId: ${tvAccountId ?? "—"}`);
  console.log(`  accountName: ${accountName ?? "—"}`);

  // Target dates (known trading days for account 1868411).
  const TARGET_DATES = ["2026-04-30", "2026-05-04", "2026-06-02"];

  // ── 1. cashBalanceLog/deps — does it cover historical dates? ────────────────
  section("1. cashBalanceLog/deps — live endpoint, has fillId");

  let cashLogRows: CashLogRow[] = [];
  try {
    const endpoint = `cashBalanceLog/deps?masterid=${tvAccountId}`;
    const raw = await client.debugRawList(endpoint) as Array<Record<string, unknown>>;
    cashLogRows = raw.map(parseCashLogRow);
    console.log(`  Fetched ${cashLogRows.length} raw rows from ${endpoint}`);

    if (cashLogRows.length > 0) {
      const allDates = [...new Set(cashLogRows.map((r) => r.tradeDate).filter(Boolean))].sort();
      console.log(`  Date range: ${allDates[0]} → ${allDates.at(-1)}`);
      console.log(`  Rows with fillId: ${cashLogRows.filter((r) => r.fillId != null).length}`);
      console.log(`  Rows with fillPairId: ${cashLogRows.filter((r) => r.fillPairId != null).length}`);
      const types = [...new Set(cashLogRows.map((r) => r.cashChangeType))].sort();
      console.log(`  cashChangeType values: ${types.join(", ")}`);

      for (const date of TARGET_DATES) {
        const dayRows = cashLogRows.filter((r) => r.tradeDate === date);
        const feeRows = dayRows.filter((r) => {
          const t = (r.cashChangeType ?? "").replace(/\s+/g, "").toLowerCase();
          return ["exchangefee","clearingfee","nfafee","commission"].includes(t);
        });
        const pnlRows = dayRows.filter((r) => {
          const t = (r.cashChangeType ?? "").replace(/\s+/g, "").toLowerCase();
          return t === "tradepaired";
        });
        const fees = feeRows.reduce((s, r) => s + (r.delta ?? 0), 0);
        const grossPnl = pnlRows.reduce((s, r) => s + (r.delta ?? 0), 0);
        console.log(`  ${date}: ${dayRows.length} rows | ${feeRows.length} fee rows | ${pnlRows.length} trade-paired | gross=${fmt$(grossPnl)} fees=${fmt$(fees)} net=${fmt$(grossPnl + fees)}`);
        // Sample fee rows with fillId
        const withFillId = feeRows.filter((r) => r.fillId != null);
        if (withFillId.length > 0) {
          console.log(`    fillId samples: ${withFillId.slice(0, 5).map((r) => `fillId=${r.fillId} delta=${r.delta} type=${r.cashChangeType}`).join(", ")}`);
        }
        if (dayRows.length === 0 && TARGET_DATES.indexOf(date) < 2) {
          console.log(`    → DATE NOT COVERED by cashBalanceLog/deps`);
        }
      }
    }
  } catch (err) {
    console.log(`  cashBalanceLog/deps error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 2. "Cash History" report — Default.html, narrow windows ─────────────────
  section("2. reports/requestreport 'Cash History' — Default.html template");

  if (!accountName) {
    console.log("  No accountName resolved — skipping report probes");
  } else {
    for (const date of TARGET_DATES) {
      const { startStr, endStr } = narrow(date);
      sub(`Cash History | ${date} | ${startStr}→${endStr} | Default.html`);
      const result = await probeReport(client, `Cash History Default.html ${date}`, {
        name: "Cash History",
        timezone: 0,
        params: [
          { name: "startDate", value: startStr },
          { name: "endDate",   value: endStr },
          { name: "account",   value: accountName },
        ],
        representationType: "html",
        template: "Default.html",
      });
      if (result.ok && result.body) {
        const tables = extractHtmlTables(result.body);
        console.log(`    Tables found: ${tables.length}`);
        for (const [i, t] of tables.entries()) {
          dumpTable(t, `table[${i}] | ${date}`, 4);
        }
        // Also check for any fillId-like strings in the body
        const fillIdMentions = result.body.match(/fill[\s_-]?id[\s"':>]*\d+/gi) ?? [];
        if (fillIdMentions.length > 0) {
          console.log(`    fillId mentions in body: ${fillIdMentions.slice(0, 5).join(", ")}`);
        }
      }
    }

    // ── 3. "Cash History" report — Default.md template ──────────────────────
    section("3. reports/requestreport 'Cash History' — Default.md template");

    for (const date of ["2026-04-30"]) {  // one date to keep output manageable
      const { startStr, endStr } = narrow(date);
      sub(`Cash History | ${date} | ${startStr}→${endStr} | Default.md`);
      const result = await probeReport(client, `Cash History Default.md ${date}`, {
        name: "Cash History",
        timezone: 0,
        params: [
          { name: "startDate", value: startStr },
          { name: "endDate",   value: endStr },
          { name: "account",   value: accountName },
        ],
        representationType: "html",
        template: "Default.md",
      });
      if (result.ok && result.body) {
        const tables = extractHtmlTables(result.body);
        console.log(`    Tables found: ${tables.length}`);
        for (const [i, t] of tables.entries()) {
          dumpTable(t, `table[${i}] | Default.md`, 4);
        }
      }
    }
  }

  // ── 4. Fills report for same windows (ground truth for gross P&L) ───────────
  section("4. Fills report gross P&L — ground truth for reconciliation");

  const fillsByDate = new Map<string, Array<{ fillId: string; contract: string; side: string; qty: number; price: number; ts: string }>>();

  if (accountName) {
    for (const date of TARGET_DATES) {
      const { startStr, endStr } = narrow(date);
      const result = await probeReport(client, `Fills | ${date}`, {
        name: "Fills",
        timezone: 0,
        params: [
          { name: "startDate", value: startStr },
          { name: "endDate",   value: endStr },
          { name: "account",   value: accountName },
        ],
        representationType: "html",
        template: "Default.md",
      });
      if (result.ok) {
        const rows = parseFillsReport({ body: result.body, contentType: result.ct });
        console.log(`  ${date}: ${rows.length} fills parsed`);
        fillsByDate.set(date, rows.map((r) => ({
          fillId: r.fillId, contract: r.contract, side: r.side,
          qty: r.quantity, price: r.price, ts: r.timestamp,
        })));
        for (const r of rows.slice(0, 3)) {
          console.log(`    fillId=${r.fillId} contract=${r.contract} side=${r.side} qty=${r.quantity} price=${r.price} ts=${r.timestamp}`);
        }
      }
    }
  }

  // ── 5. ABH day net (known ground truth) ──────────────────────────────────────
  section("5. ABH day net — reconciliation ground truth");

  let abhDayNet: Record<string, number> = {};
  try {
    const perf = await client.getHistoricalAccountPerformance();
    abhDayNet = perf.dayNet;
    for (const date of TARGET_DATES) {
      const net = abhDayNet[date];
      console.log(`  ${date}: ABH day net = ${net != null ? fmt$(net) : "not in ABH"}`);
    }
  } catch (err) {
    console.log(`  ABH error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── 6. cashBalanceLog/deps reconciliation (if covers dates) ──────────────────
  section("6. Reconciliation: cashBalanceLog/deps vs Fills report vs ABH");

  for (const date of TARGET_DATES) {
    const abhNet = abhDayNet[date];
    const fills = fillsByDate.get(date) ?? [];
    const dayLogRows = cashLogRows.filter((r) => r.tradeDate === date);

    const fees = dayLogRows
      .filter((r) => ["exchangefee","clearingfee","nfafee","commission"].includes((r.cashChangeType ?? "").replace(/\s+/g, "").toLowerCase()))
      .reduce((s, r) => s + (r.delta ?? 0), 0);
    const grossPnl = dayLogRows
      .filter((r) => (r.cashChangeType ?? "").replace(/\s+/g, "").toLowerCase() === "tradepaired")
      .reduce((s, r) => s + (r.delta ?? 0), 0);
    const netFromLog = grossPnl + fees;
    const delta = abhNet != null ? netFromLog - abhNet : null;

    const hasFillIdJoin = dayLogRows.some((r) => r.fillId != null) && fills.length > 0;
    const coveredByLog = dayLogRows.length > 0;

    console.log(`\n  ${date}:`);
    console.log(`    Fills report:     ${fills.length} fill rows`);
    console.log(`    cashBalanceLog:   ${dayLogRows.length} rows (covered=${coveredByLog})`);
    console.log(`    Gross P&L (log):  ${fmt$(grossPnl)}`);
    console.log(`    Fees (log):       ${fmt$(fees)}`);
    console.log(`    Net P&L (log):    ${fmt$(netFromLog)}`);
    console.log(`    ABH day net:      ${abhNet != null ? fmt$(abhNet) : "not in ABH"}`);
    console.log(`    Delta (log-ABH):  ${delta != null ? fmt$(delta) : "—"}`);
    console.log(`    fillId join:      ${hasFillIdJoin ? "POSSIBLE (fillId present)" : "NOT POSSIBLE (no fillId in log rows for this date or no fills)"}`);
  }

  // ── 7. Summary ───────────────────────────────────────────────────────────────
  section("7. Summary: recommended fee source");

  const apr30Covered = cashLogRows.some((r) => r.tradeDate === "2026-04-30");
  const may4Covered  = cashLogRows.some((r) => r.tradeDate === "2026-05-04");
  const hasFillId    = cashLogRows.some((r) => r.fillId != null);

  console.log(`
  cashBalanceLog/deps:
    Apr 30 covered:  ${apr30Covered}
    May 4  covered:  ${may4Covered}
    Has fillId:      ${hasFillId}

  If cashBalanceLog/deps covers Apr 30 + May 4 → join by fillId for exact per-fill fees.
  If cashBalanceLog/deps does NOT cover those dates → use Cash History report (see section 2/3).
  If Cash History report has fillId column → join by fillId (exact).
  If Cash History report has no fillId → allocate fees pro-rata by contract/day (estimated).

  Next step: share this output so the implementation choice can be confirmed.
`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
