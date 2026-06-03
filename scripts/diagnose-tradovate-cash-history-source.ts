/**
 * diagnose-tradovate-cash-history-source.ts
 *
 * Systematically probes every plausible Tradovate endpoint / report that could
 * return complete Cash History (cashBalanceLog rows) for an account, including
 * data that may not appear in cashBalanceLog/deps.
 *
 * Sections:
 *   0.  Account lookup (DB → tvAccountId)
 *   1.  GET reports/requestReportDefinitions — discover the full report catalog
 *   2.  cashBalanceLog/deps (primary baseline — account-scoped)
 *   3.  cashBalanceLog/ldeps (multi-id batch variant — never used before)
 *   4.  cashBalanceLog/list (cross-account, filter to target)
 *   5.  reports/requestreport — Cash History / Account Statement names
 *         (multiple report names × escaped/unescaped × account formats)
 *   6.  Source comparison + explicit recommendation
 *   7.  Browser network-capture instructions (if reports fail)
 *
 * Safety:
 *   - 100 % read-only — no Prisma writes, no broker writes, no order/cancel
 *   - Never prints secrets (token, password)
 *   - Diagnostic script only; no product logic here
 *
 * Usage:
 *   railway run --service trading-coach2 sh -lc \
 *     'npx tsx scripts/diagnose-tradovate-cash-history-source.ts 1868411'
 */

import { prisma } from "../src/lib/db.ts";
import { TradovateClient } from "../src/lib/brokers/tradovate-client.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

let sectionN = 0;
function section(title: string): void {
  sectionN++;
  const bar = "─".repeat(Math.max(0, 80 - title.length - 4));
  console.log(`\n${"═".repeat(82)}`);
  console.log(`══  ${sectionN}. ${title}  ${bar}`);
  console.log(`${"═".repeat(82)}\n`);
}

function fmt$(v: number | null | undefined): string {
  if (v == null || isNaN(v as number)) return "—";
  const n = v as number;
  return `${n >= 0 ? "+" : ""}$${Math.abs(n).toFixed(2)}`;
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

/** Parse "YYYY-MM-DD" or ISO timestamp to YYYY-MM-DD local trading date. */
function dayKey(ts: string): string {
  return ts.slice(0, 10);
}

/** Compute day-net from raw cashBalanceLog rows scoped to one accountId. */
function computeDayNet(
  rows: Array<Record<string, unknown>>,
  accountId: number,
): Record<string, number> {
  const net: Record<string, number> = {};
  for (const r of rows) {
    if (Number(r["accountId"]) !== accountId) continue;
    const type = String(r["cashChangeType"] ?? "");
    const isTrading =
      type === "TradePaired" ||
      type === "Trade Paired" ||
      type === "ExchangeFee" ||
      type === "Exchange Fee" ||
      type === "ClearingFee" ||
      type === "Clearing Fee" ||
      type === "NfaFee" ||
      type === "Nfa Fee" ||
      type === "Commission";
    if (!isTrading) continue;
    const delta = Number(r["delta"]);
    if (isNaN(delta)) continue;
    const ts = String(r["timestamp"] ?? r["tradeDate"] ?? "");
    if (!ts) continue;
    const dk = dayKey(ts);
    net[dk] = (net[dk] ?? 0) + delta;
  }
  return net;
}

interface RowSummary {
  rows: number;
  earliest: string | null;
  latest: string | null;
  totalNet: number;
  minDayNet: number | null;
  maxDayNet: number | null;
  tradePaired: number;
  feeRows: number;
  largeLossDays: string[]; // dayKeys where dayNet <= -100
  dayNet: Record<string, number>;
}

function summariseRows(
  rows: Array<Record<string, unknown>>,
  accountId: number,
  label: string,
): RowSummary {
  const scoped = rows.filter((r) => Number(r["accountId"]) === accountId);
  const dayNet = computeDayNet(rows, accountId);

  const timestamps = scoped
    .map((r) => String(r["timestamp"] ?? r["tradeDate"] ?? ""))
    .filter(Boolean)
    .sort();

  let tradePaired = 0;
  let feeRows = 0;
  for (const r of scoped) {
    const t = String(r["cashChangeType"] ?? "");
    if (t === "TradePaired" || t === "Trade Paired") tradePaired++;
    if (
      t === "ExchangeFee" || t === "Exchange Fee" ||
      t === "ClearingFee" || t === "Clearing Fee" ||
      t === "NfaFee" || t === "Nfa Fee" ||
      t === "Commission"
    ) feeRows++;
  }

  const dayNetValues = Object.values(dayNet);
  const totalNet = dayNetValues.reduce((s, v) => s + v, 0);
  const minDayNet = dayNetValues.length > 0 ? Math.min(...dayNetValues) : null;
  const maxDayNet = dayNetValues.length > 0 ? Math.max(...dayNetValues) : null;
  const largeLossDays = Object.entries(dayNet)
    .filter(([, v]) => v <= -100)
    .map(([k]) => k);

  console.log(`\n  ${label}: ${scoped.length}/${rows.length} rows scoped to tvAccountId=${accountId}`);
  if (timestamps.length > 0) {
    console.log(`  Earliest: ${timestamps[0]}`);
    console.log(`  Latest:   ${timestamps[timestamps.length - 1]}`);
  }
  console.log(`  TradePaired rows: ${tradePaired}  |  Fee rows: ${feeRows}`);
  console.log(`  Day net keys: ${Object.keys(dayNet).sort().join(", ") || "(none)"}`);
  console.log(`  Total net: ${fmt$(totalNet)}  |  Min day: ${fmt$(minDayNet)}  |  Max day: ${fmt$(maxDayNet)}`);
  if (largeLossDays.length > 0) {
    console.log(`  *** DAYS WITH NET <= -$100: ${largeLossDays.join(", ")} ***`);
  }

  return {
    rows: scoped.length,
    earliest: timestamps[0] ?? null,
    latest: timestamps[timestamps.length - 1] ?? null,
    totalNet,
    minDayNet,
    maxDayNet,
    tradePaired,
    feeRows,
    largeLossDays,
    dayNet,
  };
}

// ── Report probe helpers ──────────────────────────────────────────────────────

interface ReportResult {
  name: string;
  status: number;
  contentType: string | null;
  bodyPreview: string;
  sentBody: string;
  success: boolean;
}

function previewBody(body: string, maxLen = 400): string {
  const trimmed = body.replace(/\s+/g, " ").trim();
  return trimmed.length <= maxLen ? trimmed : `${trimmed.slice(0, maxLen)}…`;
}

/** Try a single reports/requestreport variant; log and return result. */
async function tryReport(
  client: TradovateClient,
  label: string,
  body: Record<string, unknown>,
  escapeSlashes: boolean,
): Promise<ReportResult> {
  console.log(`\n  [${label}]`);
  const res = await client.debugRawPost("reports/requestreport", body, { escapeSlashes });
  if (res == null) {
    console.log(`  → null (no access token or reports URL)`);
    return { name: label, status: 0, contentType: null, bodyPreview: "null", sentBody: "", success: false };
  }
  const preview = previewBody(res.body);
  console.log(`  sentBody: ${res.sentBody}`);
  console.log(`  HTTP ${res.status}  content-type: ${res.contentType ?? "—"}`);
  console.log(`  body: ${preview}`);
  const success = res.status >= 200 && res.status < 300;
  if (success) console.log(`  ✓ SUCCESS`);
  return { name: label, status: res.status, contentType: res.contentType, bodyPreview: preview, sentBody: res.sentBody, success };
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function mmddyyyy(iso: string): string {
  // "YYYY-MM-DD" → "MM/DD/YYYY"
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error(
      "Usage: npx tsx scripts/diagnose-tradovate-cash-history-source.ts <accountLabelOrExternalId>",
    );
    process.exit(1);
  }

  // ── 0. Account lookup ────────────────────────────────────────────────────
  section("ACCOUNT LOOKUP");

  const account = await prisma.connectedAccount.findFirst({
    where: {
      OR: [
        { label: arg },
        { externalAccountId: arg },
      ],
    },
    select: { id: true, label: true, externalAccountId: true, userId: true },
  });
  if (!account) {
    console.error(`  No connectedAccount found for label/externalId="${arg}"`);
    process.exit(1);
  }
  console.log(`  DB account id:        ${account.id}`);
  console.log(`  label:                ${account.label ?? "—"}`);
  console.log(`  externalAccountId:    ${account.externalAccountId ?? "—"}`);
  console.log(`  userId:               ${account.userId}`);

  // Build TradovateClient (config loaded internally via getTradovateConfig())
  const client = new TradovateClient(account.id, account.userId);

  console.log(`\n  Initializing TradovateClient…`);
  const initOk = await client.initialize().catch((e: unknown) => {
    console.error(`  initialize() failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  });
  if (!initOk) {
    console.error(`  Client did not initialize — check tokens in DB for account ${account.id}`);
    process.exit(1);
  }
  console.log(`  Client initialized.`);

  // Resolve tvAccountId and account name from account/list
  let tvAccountId: number | null = null;
  let tvAccountName: string | null = null;
  let tvAccountExternalId: string | null = null;
  try {
    const accounts = await client.debugRawList("account/list") as Array<Record<string, unknown>>;
    console.log(`\n  account/list: ${accounts.length} account(s) under this OAuth token`);
    for (const a of accounts) {
      const id = Number(a["id"]);
      const name = String(a["name"] ?? "");
      const extId = String(a["rithmicAccountId"] ?? a["externalAccountId"] ?? "");
      console.log(`    id=${id}  name=${name}  externalId=${extId}  fields=${Object.keys(a).join(",")}`);
      // Match by external label or account name
      if (
        name === arg ||
        extId === arg ||
        (account.externalAccountId && name === account.externalAccountId)
      ) {
        tvAccountId = id;
        tvAccountName = name;
        tvAccountExternalId = extId || null;
      }
    }
    if (tvAccountId == null && accounts.length === 1) {
      // Only one account — use it
      tvAccountId = Number(accounts[0]!["id"]);
      tvAccountName = String(accounts[0]!["name"] ?? "");
    }
  } catch (err) {
    console.log(`  account/list failed: ${err instanceof Error ? err.message : err}`);
  }
  console.log(`\n  Resolved tvAccountId: ${tvAccountId ?? "—"}`);
  console.log(`  Resolved account name: ${tvAccountName ?? "—"}`);
  console.log(`  Resolved external id:  ${tvAccountExternalId ?? "—"}`);

  if (tvAccountId == null) {
    console.error(`  Cannot resolve tvAccountId — aborting.`);
    process.exit(1);
  }

  const acctName = tvAccountName ?? String(arg);
  const acctId = tvAccountId;

  // ── 1. GET reports/requestReportDefinitions ────────────────────────────────
  section("GET reports/requestReportDefinitions — FULL REPORT CATALOG");

  const discoveredReportNames: string[] = [];
  try {
    const res = await client.debugRawGetReport("reports/requestReportDefinitions");
    if (res == null) {
      console.log(`  Result: null (no access token or reports URL)`);
    } else {
      console.log(`  HTTP ${res.status}  content-type: ${res.contentType ?? "—"}`);
      console.log(`  Body (first 2000 chars):\n${res.body.slice(0, 2000)}`);
      if (res.status >= 200 && res.status < 300) {
        try {
          const parsed: unknown = JSON.parse(res.body);
          if (Array.isArray(parsed)) {
            console.log(`\n  Parsed ${parsed.length} report definitions:`);
            for (const def of parsed) {
              const name = String((def as Record<string, unknown>)["name"] ?? "");
              discoveredReportNames.push(name);
              const params = (def as Record<string, unknown>)["params"];
              console.log(`    name="${name}"  params=${JSON.stringify(params)}`);
            }
          }
        } catch {
          console.log(`  (could not parse as JSON array)`);
        }
      } else {
        console.log(`  Note: ${res.status} on requestReportDefinitions — reports host may require admin/partner scope.`);
        console.log(`  This is a diagnostic signal: standard trader OAuth may not have reports access.`);
      }
    }
  } catch (err) {
    console.log(`  requestReportDefinitions error: ${err instanceof Error ? err.message : err}`);
  }

  // ── 2. cashBalanceLog/deps — primary baseline ─────────────────────────────
  section(`cashBalanceLog/deps?masterid=${acctId} — PRIMARY ACCOUNT-SCOPED LEDGER`);

  let depsRows: Array<Record<string, unknown>> = [];
  let depsSummary: RowSummary | null = null;
  try {
    depsRows = await client.debugRawList(`cashBalanceLog/deps?masterid=${acctId}`) as Array<Record<string, unknown>>;
    depsSummary = summariseRows(depsRows, acctId, "cashBalanceLog/deps");
    if (depsRows.length > 0) {
      console.log(`\n  First 5 rows (fields: ${Object.keys(depsRows[0]!).join(", ")}):`);
      for (const r of depsRows.slice(0, 5)) {
        const ts = String(r["timestamp"] ?? r["tradeDate"] ?? "—").slice(0, 23);
        const delta = r["delta"] != null ? fmt$(Number(r["delta"])) : "—";
        const type = String(r["cashChangeType"] ?? "—");
        console.log(`    ${ts}  delta=${pad(delta, 10)}  type=${pad(type, 22)}  acc=${r["accountId"]}`);
      }
    }
  } catch (err) {
    console.log(`  cashBalanceLog/deps failed: ${err instanceof Error ? err.message : err}`);
  }

  // ── 3. cashBalanceLog/ldeps — multi-id batch variant ─────────────────────
  section(`cashBalanceLog/ldeps?masterids=[${acctId}] — BATCH VARIANT (never used before)`);

  let ldepsRows: Array<Record<string, unknown>> = [];
  let ldepsSummary: RowSummary | null = null;
  try {
    // ldeps takes a comma-separated list or JSON array via query param
    ldepsRows = await client.debugRawList(`cashBalanceLog/ldeps?masterids=${acctId}`) as Array<Record<string, unknown>>;
    ldepsSummary = summariseRows(ldepsRows, acctId, "cashBalanceLog/ldeps");
    console.log(`\n  Note: ldeps vs deps row count — ${ldepsRows.length} vs ${depsRows.length}`);
    if (ldepsRows.length !== depsRows.length) {
      console.log(`  *** DIFFERENCE: ldeps returned ${ldepsRows.length - depsRows.length} more/fewer rows than deps ***`);
    }
  } catch (err) {
    console.log(`  cashBalanceLog/ldeps failed: ${err instanceof Error ? err.message : err}`);
    console.log(`  (ldeps is in the OpenAPI spec — 401/404 is unexpected)`);
  }

  // ── 4. cashBalanceLog/list — cross-account ────────────────────────────────
  section("cashBalanceLog/list — CROSS-ACCOUNT LEDGER");

  let listRows: Array<Record<string, unknown>> = [];
  let listSummary: RowSummary | null = null;
  try {
    listRows = await client.debugRawList("cashBalanceLog/list") as Array<Record<string, unknown>>;
    listSummary = summariseRows(listRows, acctId, "cashBalanceLog/list");
    // Check all unique accountIds present
    const otherAccIds = new Set(
      listRows
        .map((r) => Number(r["accountId"]))
        .filter((id) => id !== acctId && !isNaN(id)),
    );
    if (otherAccIds.size > 0) {
      console.log(`  Other accountIds in /list (cross-account): ${[...otherAccIds].join(", ")}`);
    } else {
      console.log(`  No other accountIds found in /list (only ${acctId})`);
    }
  } catch (err) {
    console.log(`  cashBalanceLog/list failed: ${err instanceof Error ? err.message : err}`);
  }

  // ── 5. reports/requestreport — Cash History report names ──────────────────
  section("reports/requestreport — CASH HISTORY / ACCOUNT STATEMENT REPORT NAMES");

  // Date range: last 2 years (generous window)
  const today = new Date();
  const twoYearsAgo = new Date(today.getFullYear() - 2, today.getMonth(), today.getDate());
  const startIso = twoYearsAgo.toISOString().slice(0, 10);
  const endIso = today.toISOString().slice(0, 10);
  const startMD = mmddyyyy(startIso);
  const endMD = mmddyyyy(endIso);

  console.log(`  Date range: ${startMD} → ${endMD}`);
  console.log(`  Account name: "${acctName}"  |  tvAccountId: ${acctId}`);
  console.log(`\n  Trying report names in order. Stops on first 2xx. Escaped slashes unless noted.`);

  // Report names to probe — add any discovered names at the front
  const reportNamesToTry = [
    ...discoveredReportNames, // from requestReportDefinitions (if succeeded)
    "Cash History",
    "CashHistory",
    "Account Statement",
    "AccountStatement",
    "Account Activity",
    "AccountActivity",
    "Transactions",
    "Ledger",
    "CashBalanceLog",
    "Cash Balance Log",
    "Statement",
    "Activity",
    "Performance", // known to be attempted — useful as control
  ];
  // Deduplicate preserving order
  const seenNames = new Set<string>();
  const uniqueNames = reportNamesToTry.filter((n) => {
    if (seenNames.has(n)) return false;
    seenNames.add(n);
    return true;
  });

  const successfulReports: ReportResult[] = [];

  for (const reportName of uniqueNames) {
    // Variant A: escaped timezone, MM/DD/YYYY, html, with template
    const bodyA: Record<string, unknown> = {
      name: reportName,
      timezone: "America/Chicago",
      params: [
        { name: "startDate", value: startMD },
        { name: "endDate",   value: endMD },
        { name: "startTime", value: "17:00:00" },
        { name: "endTime",   value: "16:59:59" },
        { name: "account",   value: acctName },
      ],
      representationType: "html",
      template: "Flex.html",
    };
    const rA = await tryReport(client, `${reportName} | tz=America\\/Chicago | MM/DD/YYYY | html | account=name`, bodyA, true);
    if (rA.success) { successfulReports.push(rA); break; }

    // Variant B: escaped timezone, account by id
    const bodyB: Record<string, unknown> = {
      name: reportName,
      timezone: "America/Chicago",
      params: [
        { name: "startDate", value: startMD },
        { name: "endDate",   value: endMD },
        { name: "startTime", value: "17:00:00" },
        { name: "endTime",   value: "16:59:59" },
        { name: "account",   value: String(acctId) },
      ],
      representationType: "html",
      template: "Flex.html",
    };
    const rB = await tryReport(client, `${reportName} | tz=America\\/Chicago | MM/DD/YYYY | html | account=tvId`, bodyB, true);
    if (rB.success) { successfulReports.push(rB); break; }

    // Variant C: UTC timezone, csv, no template
    const bodyC: Record<string, unknown> = {
      name: reportName,
      timezone: "UTC",
      params: [
        { name: "startDate", value: startMD },
        { name: "endDate",   value: endMD },
        { name: "account",   value: acctName },
      ],
      representationType: "csv",
    };
    const rC = await tryReport(client, `${reportName} | tz=UTC | MM/DD/YYYY | csv | no template`, bodyC, false);
    if (rC.success) { successfulReports.push(rC); break; }

    // Variant D: UTC, json, no account param (server default)
    const bodyD: Record<string, unknown> = {
      name: reportName,
      timezone: "UTC",
      params: [
        { name: "startDate", value: startMD },
        { name: "endDate",   value: endMD },
      ],
      representationType: "json",
    };
    const rD = await tryReport(client, `${reportName} | tz=UTC | no account param | json`, bodyD, false);
    if (rD.success) { successfulReports.push(rD); break; }

    // Variant E: no timezone, ISO dates, html
    const bodyE: Record<string, unknown> = {
      name: reportName,
      params: [
        { name: "startDate", value: startIso },
        { name: "endDate",   value: endIso },
        { name: "account",   value: acctName },
      ],
      representationType: "html",
    };
    const rE = await tryReport(client, `${reportName} | no tz | ISO dates | html`, bodyE, false);
    if (rE.success) { successfulReports.push(rE); break; }

    // Variant F: minimal — just name + params (no tz, no repType, no template)
    const bodyF: Record<string, unknown> = {
      name: reportName,
      params: [
        { name: "startDate", value: startMD },
        { name: "endDate",   value: endMD },
        { name: "account",   value: acctName },
      ],
    };
    const rF = await tryReport(client, `${reportName} | minimal (no tz, no repType, no template)`, bodyF, true);
    if (rF.success) { successfulReports.push(rF); break; }

    if (successfulReports.length > 0) break;
  }

  if (successfulReports.length > 0) {
    console.log(`\n  ✓ REPORT SUCCESS: ${successfulReports[0]!.name}`);
    console.log(`  Full response body:\n${successfulReports[0]!.bodyPreview}`);
  } else {
    console.log(`\n  ✗ All report variants failed. See Section 7 for browser capture instructions.`);
  }

  // ── 6. Source comparison + recommendation ─────────────────────────────────
  section("SOURCE COMPARISON + RECOMMENDATION");

  const sources: Array<{
    name: string;
    rows: number | null;
    earliest: string | null;
    latest: string | null;
    totalNet: number | null;
    minDay: number | null;
    accountScoped: boolean;
    productionSafe: boolean;
    largeLossDays: string[];
    notes: string;
  }> = [];

  if (depsSummary) {
    sources.push({
      name: "cashBalanceLog/deps",
      rows: depsSummary.rows,
      earliest: depsSummary.earliest,
      latest: depsSummary.latest,
      totalNet: depsSummary.totalNet,
      minDay: depsSummary.minDayNet,
      accountScoped: true,
      productionSafe: true,
      largeLossDays: depsSummary.largeLossDays,
      notes: "Primary production source. Account-scoped. No date-range params — returns all rows Tradovate has for this account.",
    });
  }

  if (ldepsSummary) {
    sources.push({
      name: "cashBalanceLog/ldeps",
      rows: ldepsSummary.rows,
      earliest: ldepsSummary.earliest,
      latest: ldepsSummary.latest,
      totalNet: ldepsSummary.totalNet,
      minDay: ldepsSummary.minDayNet,
      accountScoped: true,
      productionSafe: true,
      largeLossDays: ldepsSummary.largeLossDays,
      notes: "Batch variant of deps. Same data, same retention. Useful for multi-account fetches.",
    });
  }

  if (listSummary) {
    sources.push({
      name: "cashBalanceLog/list",
      rows: listSummary.rows,
      earliest: listSummary.earliest,
      latest: listSummary.latest,
      totalNet: listSummary.totalNet,
      minDay: listSummary.minDayNet,
      accountScoped: false,
      productionSafe: false,
      largeLossDays: listSummary.largeLossDays,
      notes: "Cross-account. Returns rows for ALL accounts under the OAuth token. Must filter by accountId. Not safe for production without strict filtering.",
    });
  }

  if (successfulReports.length > 0) {
    sources.push({
      name: `reports/requestreport "${successfulReports[0]!.name}"`,
      rows: null,
      earliest: null,
      latest: null,
      totalNet: null,
      minDay: null,
      accountScoped: true,
      productionSafe: false,
      largeLossDays: [],
      notes: "Reports host. HTML/CSV response — must parse. Admin/partner scope may be required. Not suitable as primary production source.",
    });
  }

  // Sort by earliest date (widest coverage first)
  const sorted = sources.slice().sort((a, b) => {
    if (!a.earliest) return 1;
    if (!b.earliest) return -1;
    return a.earliest.localeCompare(b.earliest);
  });

  console.log(`\n  Sources ranked by earliest date (widest coverage first):\n`);
  for (const s of sorted) {
    console.log(`  ── ${s.name}`);
    console.log(`     rows:          ${s.rows ?? "—"}`);
    console.log(`     earliest:      ${s.earliest ?? "—"}`);
    console.log(`     latest:        ${s.latest ?? "—"}`);
    console.log(`     total net:     ${s.totalNet != null ? fmt$(s.totalNet) : "—"}`);
    console.log(`     min day net:   ${s.minDay != null ? fmt$(s.minDay) : "—"}`);
    console.log(`     account-scoped: ${s.accountScoped ? "yes" : "NO"}`);
    console.log(`     production-safe: ${s.productionSafe ? "yes" : "NO"}`);
    if (s.largeLossDays.length > 0) {
      console.log(`     *** DAYS WITH NET <= -$100: ${s.largeLossDays.join(", ")} ***`);
    } else {
      console.log(`     large-loss days (<= -$100): none`);
    }
    console.log(`     notes: ${s.notes}`);
    console.log();
  }

  // Explicit diagnostic conclusions
  const depsEarliest = depsSummary?.earliest ?? null;
  const listEarliest = listSummary?.earliest ?? null;
  const ldepsEarliest = ldepsSummary?.earliest ?? null;

  const earliestAcrossAll = [depsEarliest, listEarliest, ldepsEarliest]
    .filter(Boolean)
    .sort()[0] ?? null;

  console.log(`  ── DIAGNOSTIC CONCLUSIONS ──`);
  console.log();

  const depsPartial =
    depsSummary != null &&
    depsEarliest != null &&
    listSummary != null &&
    listEarliest != null &&
    listEarliest < depsEarliest;

  if (depsPartial) {
    console.log(`  ✗ cashBalanceLog/deps IS PARTIAL for this account.`);
    console.log(`    /deps earliest: ${depsEarliest}  |  /list earliest: ${listEarliest}`);
    console.log(`    Earlier rows exist in /list that are not returned by /deps.`);
  } else if (depsSummary && ldepsSummary && ldepsEarliest && depsEarliest && ldepsEarliest < depsEarliest) {
    console.log(`  ✗ cashBalanceLog/deps IS PARTIAL. ldeps returned older rows: ${ldepsEarliest} vs ${depsEarliest}`);
  } else if (depsSummary) {
    console.log(`  ✓ cashBalanceLog/deps appears complete — no earlier rows found in /list or /ldeps.`);
    console.log(`    Earliest row: ${depsEarliest ?? "—"}`);
    console.log(`    If the Tradovate web export shows older data, it uses a different data source`);
    console.log(`    (likely the reports host — Cash History or Account Statement report).`);
  }
  console.log();

  const hasLargeLoss = sources.some((s) => s.largeLossDays.length > 0);
  if (hasLargeLoss) {
    const days = sources.flatMap((s) => s.largeLossDays);
    console.log(`  *** LARGE LOSS DAYS (net <= -$100) FOUND IN API ENDPOINTS: ${[...new Set(days)].join(", ")} ***`);
  } else {
    console.log(`  No day with net <= -$100 found in any tested API endpoint.`);
    console.log(`  If the Tradovate web Cash History export shows a large loss:`);
    console.log(`    - The data may only be accessible via the reports host (not REST endpoints)`);
    console.log(`    - The reports host may require admin/partner OAuth scope`);
    console.log(`    - The data may be on a sub-account not returned by account/list`);
    console.log(`    - The data may pre-date this account's API retention window`);
  }
  console.log();

  if (successfulReports.length === 0) {
    console.log(`  reports/requestreport: ALL VARIANTS FAILED`);
    console.log(`    The reports host (rpt-live.tradovateapi.com) did not return 2xx for any`);
    console.log(`    combination of report name, timezone format, date format, or account identifier.`);
    console.log(`    This is consistent with the reports host requiring admin/partner OAuth scope`);
    console.log(`    that a standard trader token does not have.`);
    console.log(`    → See Section 7 for how to identify the exact endpoint via browser capture.`);
  }
  console.log();

  console.log(`  RECOMMENDATION:`);
  if (depsSummary && depsSummary.rows > 0) {
    console.log(`    Production source: cashBalanceLog/deps?masterid={tvAccountId}`);
    console.log(`    This is the only account-scoped, production-safe endpoint with Cash History data.`);
    console.log(`    It returns all rows Tradovate exposes via the standard OAuth API.`);
    if (depsSummary.rows < 20 && depsEarliest && depsEarliest > "2026-01-01") {
      console.log(`    ⚠ Only ${depsSummary.rows} rows from ${depsEarliest} — this is a very short history.`);
      console.log(`    ⚠ The Tradovate web export may be using a different data path (reports host)`);
      console.log(`    ⚠ that is not accessible with a standard trader OAuth token.`);
    }
  } else {
    console.log(`    No usable Cash History source found via standard OAuth endpoints.`);
  }

  // ── 7. Browser capture instructions ──────────────────────────────────────
  section("BROWSER NETWORK CAPTURE INSTRUCTIONS (if reports failed)");

  if (successfulReports.length > 0) {
    console.log(`  ✓ A report succeeded — browser capture may not be needed.`);
    console.log(`  ✓ If the report content matches the full Cash History export, the investigation is complete.`);
  } else {
    console.log(`  reports/requestreport failed for all variants tested. To identify the exact`);
    console.log(`  data path that Tradovate's web app uses for Cash History export:`);
    console.log();
    console.log(`  Steps:`);
    console.log(`  1. Open https://trader.tradovate.com/ and log in to the account "${acctName}".`);
    console.log(`  2. Open DevTools (F12 or Cmd+Opt+I) → Network tab → check "Preserve log".`);
    console.log(`  3. Navigate to: Account → Cash History (or History / Activity / Statement).`);
    console.log(`  4. Set the date range to the FULL account lifetime (e.g. from Jan 2020 or account open date).`);
    console.log(`  5. Click Export / Download / Print (whichever produces the full history).`);
    console.log(`  6. In Network, filter by: XHR/Fetch. Search for any of:`);
    console.log(`       report  cash  history  download  export  statement  activity  ledger`);
    console.log(`  7. Find the request that returns the full Cash History data. Click it and capture:`);
    console.log(`       a. Full URL (method + host + path + query params)`);
    console.log(`       b. Request method (GET or POST)`);
    console.log(`       c. Request headers — Content-Type, Accept. DO NOT share Authorization/token.`);
    console.log(`       d. Request body (if POST) — full JSON/form payload`);
    console.log(`       e. Response Content-Type (html, csv, json, pdf?)`);
    console.log(`       f. Response body — first 500 chars`);
    console.log(`  8. Share the above (no secrets) so the exact path can be reproduced in the API client.`);
    console.log();
    console.log(`  Also check:`);
    console.log(`  - Does the Tradovate web UI make a request to rpt-live.tradovateapi.com?`);
    console.log(`  - If so, what Authorization header does it send? (admin token vs trader token?)`);
    console.log(`  - Is the Cash History loaded via REST (cashBalanceLog/*) or reports?`);
  }

  console.log(`\n${"═".repeat(82)}`);
  console.log(`  Diagnostic complete.`);
  console.log(`${"═".repeat(82)}\n`);

  await prisma.$disconnect().catch(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
