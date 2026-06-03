#!/usr/bin/env tsx
/**
 * diagnose-tradovate-historical-fills.ts
 *
 * Read-only probe for trade-level historical data sources in Tradovate.
 *
 * Goal: determine whether any Tradovate endpoint exposes individual
 * historical fill/order rows for an account — not just day-level totals.
 * Account Balance History gives us day P&L (Apr 30 -$212.10, May 4 +$35.40,
 * Jun 2 -$0.40) but the Trades page needs actual fill rows to show a table.
 *
 * Endpoints probed (all read-only):
 *   fillPair/deps?masterid={tvAccountId}   — account-scoped Tradovate round-trips
 *   fillPair/list                           — cross-account round-trips (current session)
 *   fill/deps?masterid={orderId} sample    — order-scoped fills (may be empty w/o orderId)
 *   order/deps?masterid={tvAccountId}      — account-scoped orders (inc. historical?)
 *   reports/requestreport "Fills"          — Fills report (all tz/repType variants)
 *   reports/requestreport "Orders"         — Orders report (all variants)
 *   reports/requestreport "Performance"    — Performance report with timezone:0 (untried!)
 *
 * Key hypothesis: prior diagnostics tried "Performance" only with
 * timezone:"America/Chicago" (string) which returns HTTP 400. The ABH report
 * works with timezone:0 (numeric). This script retries Performance + Fills +
 * Orders with timezone:0 and short date windows around the known trading days.
 *
 * Safety contract:
 *   100% read-only. GET only + read-only POSTs (reports/requestreport).
 *   No Prisma writes. No order writes. No broker state changes. No env changes.
 *
 * Usage:
 *   npx tsx scripts/diagnose-tradovate-historical-fills.ts <accountLabelOrExternalId>
 *   npx tsx scripts/diagnose-tradovate-historical-fills.ts 1868411
 */

import { resolve } from "path";
import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });

import { TradovateClient } from "../src/lib/brokers/tradovate-client.ts";
import { prisma } from "../src/lib/db.ts";

// ── Formatting ────────────────────────────────────────────────────────────────

function fmt$(v: number | null | undefined): string {
  if (v == null) return "n/a";
  const abs = Math.abs(v);
  const sign = v >= 0 ? "+" : "-";
  return `${sign}$${abs.toFixed(2)}`;
}

function hr(char = "─", w = 80): string { return char.repeat(w); }
function section(title: string): void {
  console.log("\n" + hr("═"));
  console.log(`  ${title}`);
  console.log(hr("═"));
}

// ── Date helpers ─────────────────────────────────────────────────────────────

function fmtMMDDYYYY(yyyy: number, mm: number, dd: number): string {
  return `${String(mm).padStart(2, "0")}/${String(dd).padStart(2, "0")}/${yyyy}`;
}

// ── Summarise a raw row list ──────────────────────────────────────────────────

function summariseRows(
  rows: Array<Record<string, unknown>>,
  label: string,
  opts?: { sampleCount?: number },
): void {
  const n = opts?.sampleCount ?? 3;
  console.log(`\n  ${label}: ${rows.length} rows`);
  if (rows.length === 0) return;
  const allKeys = [...new Set(rows.flatMap((r) => Object.keys(r)))].sort();
  console.log(`  Fields: ${allKeys.join(", ")}`);
  for (const row of rows.slice(0, n)) {
    console.log(`  Row: ${JSON.stringify(row).slice(0, 300)}`);
  }
  if (rows.length > n) console.log(`  … and ${rows.length - n} more rows`);

  // Scan for date-like fields
  const dateFields = allKeys.filter((k) =>
    /date|time|stamp|day|created|opened|closed|at$/i.test(k),
  );
  if (dateFields.length > 0) {
    const samples = rows.slice(0, 5).map((r) =>
      dateFields.map((f) => `${f}=${r[f] ?? "—"}`).join(", "),
    );
    console.log(`  Date fields sample: ${samples.join(" | ")}`);
  }

  // Scan for P&L-like fields
  const pnlFields = allKeys.filter((k) => /pnl|pnl|profit|loss|realiz/i.test(k));
  if (pnlFields.length > 0) {
    const samples = rows.slice(0, 5).map((r) =>
      pnlFields.map((f) => `${f}=${r[f] ?? "—"}`).join(", "),
    );
    console.log(`  P&L fields sample: ${samples.join(" | ")}`);
  }
}

// ── Report probe helper ───────────────────────────────────────────────────────

async function probeReport(
  client: TradovateClient,
  label: string,
  body: Record<string, unknown>,
): Promise<{ success: boolean; status: number; bodyPreview: string }> {
  try {
    const result = await client.debugRawPost("reports/requestreport", body);
    if (!result) {
      console.log(`  [${label}] → null result (no reports URL or no token)`);
      return { success: false, status: 0, bodyPreview: "" };
    }
    const preview = result.body.slice(0, 800).replace(/[\r\n]+/g, " ").trim();
    const success = result.status >= 200 && result.status < 300;
    const statusMark = success ? "✓" : "✗";
    console.log(`  [${statusMark}] ${label} → HTTP ${result.status}  ct=${result.contentType ?? "—"}`);
    if (!success) {
      console.log(`      body: ${preview.slice(0, 200)}`);
    } else {
      console.log(`      *** SUCCESS — body (first 800): ${preview}`);
      // Highlight field-like column headers in the body
      const headers = preview.match(/<th[^>]*>([^<]+)<\/th>/gi) ?? [];
      if (headers.length > 0) {
        const cols = headers.map((h) => h.replace(/<[^>]+>/g, "").trim()).join(" | ");
        console.log(`      Columns: ${cols}`);
      }
      // Highlight any dollar values
      const dollars = preview.match(/[-+]?\$[\d,]+\.\d{2}/g) ?? [];
      if (dollars.length > 0) console.log(`      Dollar values: ${dollars.slice(0, 15).join(", ")}`);
    }
    return { success, status: result.status, bodyPreview: preview };
  } catch (err) {
    console.log(`  [!] ${label} → error: ${err instanceof Error ? err.message : String(err)}`);
    return { success: false, status: 0, bodyPreview: "" };
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const arg = process.argv[2];

  // ── Resolve account ────────────────────────────────────────────────────────
  if (!arg) {
    console.error("Usage: npx tsx scripts/diagnose-tradovate-historical-fills.ts <accountLabelOrExternalId>");
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
    include: { brokerConnection: true },
  });
  if (!account) {
    console.error(`No account found matching "${arg}". Check your DB.`);
    process.exit(1);
  }

  console.log(`\n  Account: id=${account.id}  label=${account.label}`);
  console.log(`  externalAccountId: ${account.externalAccountId ?? "—"}`);

  const client = new TradovateClient(account.id, account.userId);
  await client.initialize();

  const tvAccountId = client.getTvAccountId();
  const externalId = client.getExternalAccountId();
  const accountName = await client.getAccountName();

  console.log(`  tvAccountId: ${tvAccountId ?? "—"}`);
  console.log(`  externalId: ${externalId ?? "—"}`);
  console.log(`  accountName: ${accountName ?? "—"}`);

  if (!tvAccountId) {
    console.error("Cannot resolve tvAccountId — aborting.");
    process.exit(1);
  }

  // ── 1. fillPair/deps?masterid={tvAccountId} ────────────────────────────────
  section(`1. fillPair/deps?masterid=${tvAccountId} — ACCOUNT-SCOPED ROUND-TRIPS`);
  console.log(`
  Hypothesis: fillPair/list returns only current-session fill pairs.
  fillPair/deps?masterid=tvAccountId (account-scoped via master-id pattern)
  may return all historical round-trip trades for the account.
  `);
  try {
    const rows = await client.debugRawList(`fillPair/deps?masterid=${tvAccountId}`) as Array<Record<string, unknown>>;
    summariseRows(rows, `fillPair/deps?masterid=${tvAccountId}`, { sampleCount: 5 });

    if (rows.length > 0) {
      console.log(`\n  *** ALL FILL PAIRS (up to 20): ***`);
      for (const r of rows.slice(0, 20)) {
        console.log(`  ${JSON.stringify(r)}`);
      }

      // Check date coverage
      const dateKeys = ["buyTime", "sellTime", "openedAt", "closedAt", "timestamp", "tradeDate"];
      const dates: string[] = [];
      for (const r of rows) {
        for (const k of dateKeys) {
          if (r[k]) dates.push(String(r[k]).slice(0, 10));
        }
      }
      if (dates.length > 0) {
        dates.sort();
        console.log(`\n  Date coverage: ${dates[0]} → ${dates[dates.length - 1]} (${dates.length} dates)`);
        const hasFeb = dates.some((d) => d.startsWith("2026-02") || d.startsWith("2026-03") || d.startsWith("2026-04") || d.startsWith("2026-05"));
        console.log(`  Covers Apr/May 2026: ${hasFeb ? "YES ✓" : "NO ✗"}`);
      }
    }
  } catch (err) {
    console.log(`  fillPair/deps failed: ${err instanceof Error ? err.message : err}`);
  }

  // ── 2. fillPair/list ───────────────────────────────────────────────────────
  section("2. fillPair/list — CURRENT-SESSION ROUND-TRIPS");
  try {
    const rows = await client.debugRawList("fillPair/list") as Array<Record<string, unknown>>;
    summariseRows(rows, "fillPair/list", { sampleCount: 5 });
    if (rows.length > 0) {
      console.log(`\n  All fillPair/list rows:`);
      for (const r of rows) console.log(`  ${JSON.stringify(r)}`);
    }
  } catch (err) {
    console.log(`  fillPair/list failed: ${err instanceof Error ? err.message : err}`);
  }

  // ── 3. order/deps?masterid={tvAccountId} — historical orders ──────────────
  section(`3. order/deps?masterid=${tvAccountId} — ACCOUNT-SCOPED ORDERS`);
  console.log(`
  order/deps is already in the sync flow but only used for today's trades.
  Does it return historical orders (Apr 30, May 4, Jun 2)?
  `);
  try {
    const rows = await client.debugRawList(`order/deps?masterid=${tvAccountId}`) as Array<Record<string, unknown>>;
    summariseRows(rows, `order/deps?masterid=${tvAccountId}`, { sampleCount: 5 });

    if (rows.length > 0) {
      // Check date range
      const timestamps = rows
        .map((r) => r.timestamp ?? r.createdAt ?? r.tradDate)
        .filter(Boolean)
        .map((t) => String(t).slice(0, 10))
        .sort();
      if (timestamps.length > 0) {
        console.log(`  Date range: ${timestamps[0]} → ${timestamps[timestamps.length - 1]}`);
        const historical = timestamps.filter((t) => t < "2026-06-01");
        console.log(`  Orders before 2026-06-01: ${historical.length}`);
        console.log(`  Historical dates: ${historical.slice(0, 10).join(", ")}`);
      }

      // Print all orders for inspection
      console.log(`\n  All orders (up to 30):`);
      for (const r of rows.slice(0, 30)) console.log(`  ${JSON.stringify(r)}`);
    }
  } catch (err) {
    console.log(`  order/deps failed: ${err instanceof Error ? err.message : err}`);
  }

  // ── 4. Reports API — Fills / Orders / Performance with timezone:0 ─────────
  section("4. reports/requestreport — FILLS / ORDERS / PERFORMANCE (timezone:0)");
  console.log(`
  Critical: prior diagnostics tried "Performance" with timezone:"America/Chicago"
  (string) which always 400s. ABH works with timezone:0 (numeric). This section
  retries Fills, Orders, and Performance with timezone:0 and short date windows.

  Short windows tested: Apr 28–May 1, May 3–5, Jun 1–3 (known trading days).
  `);

  // Short date windows around known trading days
  const windows = [
    { label: "Apr 28–May 1",  start: fmtMMDDYYYY(2026, 4, 28),  end: fmtMMDDYYYY(2026, 5,  1) },
    { label: "May 3–5",       start: fmtMMDDYYYY(2026, 5,  3),   end: fmtMMDDYYYY(2026, 5,  5) },
    { label: "Jun 1–3",       start: fmtMMDDYYYY(2026, 6,  1),   end: fmtMMDDYYYY(2026, 6,  3) },
    { label: "1-month window",start: fmtMMDDYYYY(2026, 4, 28),   end: fmtMMDDYYYY(2026, 6,  3) },
  ];

  const acctValues = [...new Set([accountName, String(tvAccountId), externalId].filter(Boolean) as string[])];
  console.log(`  Account values to try: ${acctValues.join(", ")}`);

  // Report definitions to try
  const reports = [
    {
      name: "Performance",
      // ABH uses Default.html. Performance catalog template is Flex.html, Default.html, pdf.html
      templates: ["Default.html", "Flex.html"],
      // Performance report has startTime/endTime params
      extraParams: [
        { name: "startTime", value: "00:00:00" },
        { name: "endTime",   value: "23:59:59" },
      ],
    },
    {
      name: "Fills",
      // Catalog template is Default.md — try all repTypes
      templates: ["Default.md"],
      extraParams: [],
    },
    {
      name: "Orders",
      templates: ["Default.md"],
      extraParams: [],
    },
  ] as const;

  const repTypes = ["html", "csv", "markdown"] as const;

  let anySuccess = false;

  for (const rpt of reports) {
    console.log(`\n  ══ Report: ${rpt.name} ══`);
    let reportSuccess = false;

    for (const win of windows) {
      if (reportSuccess) break;
      for (const template of rpt.templates) {
        if (reportSuccess) break;
        for (const repType of repTypes) {
          if (reportSuccess) break;
          for (const acctVal of acctValues) {
            const params: Array<{ name: string; value: string }> = [
              { name: "startDate", value: win.start },
              { name: "endDate",   value: win.end },
              ...rpt.extraParams,
              { name: "account",   value: acctVal },
            ];
            const body: Record<string, unknown> = {
              name: rpt.name,
              timezone: 0,
              params,
              representationType: repType,
              template,
            };
            const label = `${rpt.name} | ${win.label} | template=${template} | repType=${repType} | acct=${acctVal}`;
            const result = await probeReport(client, label, body);
            if (result.success) {
              reportSuccess = true;
              anySuccess = true;
              console.log(`\n  *** FIRST SUCCESS for ${rpt.name}: ${label} ***`);
              break;
            }
          }
        }
      }
    }

    if (!reportSuccess) {
      // Also try without template field (let server pick)
      for (const win of windows.slice(0, 2)) {
        for (const acctVal of acctValues.slice(0, 1)) {
          const body: Record<string, unknown> = {
            name: rpt.name,
            timezone: 0,
            params: [
              { name: "startDate", value: win.start },
              { name: "endDate",   value: win.end },
              ...rpt.extraParams,
              { name: "account",   value: acctVal },
            ],
            representationType: "html",
          };
          const label = `${rpt.name} | ${win.label} | no-template | repType=html | acct=${acctVal}`;
          const result = await probeReport(client, label, body);
          if (result.success) {
            reportSuccess = true;
            anySuccess = true;
            break;
          }
        }
        if (reportSuccess) break;
      }
    }

    if (!reportSuccess) {
      console.log(`  → No 2xx response for ${rpt.name} across all variants.`);
    }
  }

  // ── 5. Performance report — full-year window (in case short window 400s) ──
  section("5. Performance report — full-year window + timezone:0");
  console.log(`
  Some Tradovate reports require the full date range or reject very short windows.
  Try full year (MM/DD/YYYY) with timezone:0, Default.html template.
  `);
  const fullStart = fmtMMDDYYYY(2025, 6, 3);
  const fullEnd   = fmtMMDDYYYY(2026, 6, 3);
  for (const acctVal of acctValues) {
    for (const template of ["Default.html", "Flex.html"] as const) {
      for (const repType of ["html", "csv"] as const) {
        const body = {
          name: "Performance",
          timezone: 0,
          params: [
            { name: "startDate", value: fullStart },
            { name: "endDate",   value: fullEnd },
            { name: "startTime", value: "00:00:00" },
            { name: "endTime",   value: "23:59:59" },
            { name: "account",   value: acctVal },
          ],
          representationType: repType,
          template,
        };
        const label = `Performance | full-year | template=${template} | repType=${repType} | acct=${acctVal}`;
        const result = await probeReport(client, label, body);
        if (result.success) {
          anySuccess = true;
          break;
        }
      }
    }
  }

  // Also try without account param
  {
    const body = {
      name: "Performance",
      timezone: 0,
      params: [
        { name: "startDate", value: fullStart },
        { name: "endDate",   value: fullEnd },
        { name: "startTime", value: "00:00:00" },
        { name: "endTime",   value: "23:59:59" },
      ],
      representationType: "html",
      template: "Default.html",
    };
    await probeReport(client, "Performance | full-year | no-account | Default.html", body);
  }

  // ── 6. fill/list — check historical depth ─────────────────────────────────
  section("6. fill/list — RAW FILLS (current session, but how far back?)");
  console.log(`
  fill/list is cross-account but may return all fills since account creation
  depending on Tradovate token scope and account age.
  `);
  try {
    const rows = await client.debugRawList("fill/list") as Array<Record<string, unknown>>;
    summariseRows(rows, "fill/list", { sampleCount: 5 });

    if (rows.length > 0) {
      const acctRows = rows.filter((r) =>
        r.accountId === tvAccountId ||
        r.accountSpec?.toString().includes(String(tvAccountId)) ||
        r.accountSpec?.toString().includes(externalId ?? "XXXX"),
      );
      console.log(`\n  Rows matching tvAccountId ${tvAccountId}: ${acctRows.length} of ${rows.length}`);

      const timestamps = rows
        .map((r) => r.timestamp ?? r.tradeDate ?? r.time ?? r.tradeTime)
        .filter(Boolean)
        .map((t) => String(t).slice(0, 10))
        .sort();
      if (timestamps.length > 0) {
        console.log(`  fill/list date range: ${timestamps[0]} → ${timestamps[timestamps.length - 1]}`);
        const historical = timestamps.filter((t) => t < "2026-06-01");
        console.log(`  Historical fills (before Jun 2026): ${historical.length}`);
      }
    }
  } catch (err) {
    console.log(`  fill/list failed: ${err instanceof Error ? err.message : err}`);
  }

  // ── 7. Summary ────────────────────────────────────────────────────────────
  section("7. SUMMARY — HISTORICAL FILL SOURCES");

  console.log(`
  Known trading days for account ${account.label}:
    Apr 30, 2026: net -$212.10  (ABH confirmed)
    May 4,  2026: net +$35.40   (ABH confirmed)
    Jun 2,  2026: net -$0.40    (ABH confirmed, 1 imported fill gross +$1.50)

  Questions this diagnostic answers:

  Q1. Does fillPair/deps return historical round-trip rows for Apr 30 / May 4?
      → See section 1. If rows include dates < 2026-06 they are historical.

  Q2. Do Fills/Orders/Performance reports return 2xx with timezone:0?
      → See section 4. ABH works this way; hypothesis is these will too.

  Q3. Does fill/list go back to Apr/May (not just current session)?
      → See section 6. If yes, it's a usable historical fill source.

  Q4. What fields are available (symbol, side, qty, price, P&L, fees)?
      → See the "Fields:" and "Row:" lines in each section above.

  Deliverable:
    If any source returns trade-level rows with symbol/side/qty/price,
    PR 2 can add a getHistoricalFillsReport() client method + parser.
    If only day-level data exists (no fill rows for Apr 30 / May 4),
    the honest path is: keep ABH day totals, show empty state for fill table.
`);

  if (!anySuccess) {
    console.log(`  ✗ No reports API source returned 2xx. Historical fills likely come from
    fillPair/deps (check section 1) or fill/list (check section 6).
`);
  }
}

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
