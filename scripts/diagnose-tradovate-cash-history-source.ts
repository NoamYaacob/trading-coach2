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
import {
  TradovateClient,
  type AccountBalanceHistoryDay,
} from "../src/lib/brokers/tradovate-client.ts";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

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
  return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(2)}`;
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

// ── Catalog types ─────────────────────────────────────────────────────────────

interface CatalogParam {
  name: string;
  paramType?: string;
  optional?: boolean;
  defaultValue?: unknown;
  [key: string]: unknown;
}

interface CatalogDefinition {
  name: string;
  description?: string;
  params?: CatalogParam[];
  templates?: string[];
  representationTypes?: string[];
  fields?: unknown[];
  [key: string]: unknown;
}

// ── Report probe helpers ──────────────────────────────────────────────────────

interface ReportResult {
  name: string;
  label: string;
  status: number;
  contentType: string | null;
  bodyPreview: string;
  sentBody: string;
  success: boolean;
}

function previewBody(body: string, maxLen = 600): string {
  const trimmed = body.replace(/\s+/g, " ").trim();
  return trimmed.length <= maxLen ? trimmed : `${trimmed.slice(0, maxLen)}…`;
}

/** Try a single reports/requestreport variant; log and return result. */
async function tryReport(
  client: TradovateClient,
  reportName: string,
  label: string,
  body: Record<string, unknown>,
  escapeSlashes: boolean,
): Promise<ReportResult> {
  console.log(`\n  [${label}]`);
  const res = await client.debugRawPost("reports/requestreport", body, { escapeSlashes });
  if (res == null) {
    console.log(`  → null (no access token or reports URL)`);
    return { name: reportName, label, status: 0, contentType: null, bodyPreview: "null", sentBody: "", success: false };
  }
  const preview = previewBody(res.body, 1000);
  console.log(`  sentBody: ${res.sentBody}`);
  console.log(`  HTTP ${res.status}  content-type: ${res.contentType ?? "—"}`);
  console.log(`  body preview (first 1000 chars): ${preview}`);
  const success = res.status >= 200 && res.status < 300;
  if (success) {
    // Detect whether the response looks like it carries real ledger content.
    const lower = res.body.toLowerCase();
    const hasDates = /\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}/.test(res.body);
    const hasCashFields = ["cashchangetype", "tradepaired", "delta", "realizedpnl", "balance", "amount"]
      .filter((k) => lower.includes(k));
    const hasRowsWord = /\brows?\b|\brecords?\b|<tr|<table|"data"/.test(lower);
    console.log(`  CONTENT SIGNALS — dates: ${hasDates ? "yes" : "no"}  |  rows/table: ${hasRowsWord ? "yes" : "no"}  |  cash fields: ${hasCashFields.length ? hasCashFields.join(",") : "none"}`);
    console.log(`  ✓ SUCCESS — full body (first 4000 chars):\n${res.body.slice(0, 4000)}`);
  }
  return { name: reportName, label, status: res.status, contentType: res.contentType, bodyPreview: preview, sentBody: res.sentBody, success };
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function mmddyyyy(iso: string): string {
  // "YYYY-MM-DD" → "MM/DD/YYYY"
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

// Keywords that indicate a Cash History / financial ledger report
const CASH_KEYWORDS = ["cash", "balance", "history", "transaction", "ledger", "statement", "activity"];
// Keywords that indicate an Orders/Fills report
const FILL_KEYWORDS = ["fill", "order", "trade", "execution", "performance"];

function isCashCandidate(def: CatalogDefinition): boolean {
  const text = `${def.name} ${def.description ?? ""}`.toLowerCase();
  return CASH_KEYWORDS.some((k) => text.includes(k));
}

function isFillCandidate(def: CatalogDefinition): boolean {
  const text = `${def.name} ${def.description ?? ""}`.toLowerCase();
  return FILL_KEYWORDS.some((k) => text.includes(k));
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
  try {
    await client.initialize();
  } catch (e) {
    console.error(`  initialize() failed: ${e instanceof Error ? e.message : String(e)}`);
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

  let catalogDefs: CatalogDefinition[] = [];
  try {
    const res = await client.debugRawGetReport("reports/requestReportDefinitions");
    if (res == null) {
      console.log(`  Result: null (no access token or reports URL)`);
    } else {
      console.log(`  HTTP ${res.status}  content-type: ${res.contentType ?? "—"}`);
      if (res.status >= 200 && res.status < 300) {
        try {
          const parsed: unknown = JSON.parse(res.body);
          // The reports host returns { "reports": [ ... ] }, not a bare array.
          const parsedObj = parsed as { reports?: unknown } | null;
          const defs = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsedObj?.reports)
            ? parsedObj!.reports
            : [];
          if (defs.length > 0) {
            catalogDefs = defs as CatalogDefinition[];
            console.log(`\n  ✓ ${catalogDefs.length} report definitions in catalog:\n`);
            for (const def of catalogDefs) {
              console.log(`  ┌─ name: "${def.name}"`);
              if (def.description) console.log(`  │  description: ${def.description}`);
              if (def.templates?.length) console.log(`  │  templates: ${def.templates.join(", ")}`);
              if (def.representationTypes?.length) console.log(`  │  representationTypes: ${def.representationTypes.join(", ")}`);
              if (def.params?.length) {
                console.log(`  │  params (${def.params.length}):`);
                for (const p of def.params) {
                  const optStr   = p.optional ? " [optional]" : " [required]";
                  const typeStr  = p.paramType ? `  type=${p.paramType}` : "";
                  const defStr   = p.defaultValue !== undefined ? `  default=${JSON.stringify(p.defaultValue)}` : "";
                  const extraKeys = Object.keys(p).filter((k) => !["name","paramType","optional","defaultValue"].includes(k));
                  const extraStr = extraKeys.length ? `  ${extraKeys.map((k)=>`${k}=${JSON.stringify(p[k])}`).join(" ")}` : "";
                  console.log(`  │    ${pad(p.name, 20)}${optStr}${typeStr}${defStr}${extraStr}`);
                }
              }
              // Other top-level keys
              const knownKeys = new Set(["name","description","templates","representationTypes","params","fields"]);
              const extra = Object.keys(def).filter((k) => !knownKeys.has(k));
              if (extra.length) {
                for (const k of extra) console.log(`  │  ${k}: ${JSON.stringify(def[k])}`);
              }
              if (def.fields) console.log(`  │  fields: ${JSON.stringify(def.fields).slice(0, 200)}`);
              const cashTag = isCashCandidate(def) ? " ← CASH/HISTORY CANDIDATE" : "";
              const fillTag = isFillCandidate(def) ? " ← FILL/ORDER CANDIDATE" : "";
              console.log(`  └${"─".repeat(60)}${cashTag}${fillTag}`);
              console.log();
            }
          } else {
            console.log(`  Parsed JSON but found no report definitions (neither a bare array nor {reports:[…]}). Raw:\n${res.body}`);
          }
        } catch {
          console.log(`  Could not parse as JSON. Raw body:\n${res.body}`);
        }
      } else {
        console.log(`  HTTP ${res.status} — reports host may require admin/partner scope.`);
        console.log(`  Raw:\n${res.body}`);
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

  // ── 5. reports/requestreport — catalog-driven probe ─────────────────────
  section("reports/requestreport — CATALOG-DRIVEN PROBE");

  // Date range: last 2 years (generous window to cover all historical activity)
  const today = new Date();
  const twoYearsAgo = new Date(today.getFullYear() - 2, today.getMonth(), today.getDate());
  const startIso = twoYearsAgo.toISOString().slice(0, 10);
  const endIso = today.toISOString().slice(0, 10);
  const startMD = mmddyyyy(startIso);
  const endMD = mmddyyyy(endIso);

  console.log(`  Date range used: ${startMD} → ${endMD}  (ISO: ${startIso} → ${endIso})`);
  console.log(`  Account name: "${acctName}"  |  tvAccountId: ${acctId}`);

  // ── 5a. Identify candidates from catalog ─────────────────────────────────
  const cashCandidates = catalogDefs.filter(isCashCandidate);
  const fillCandidates = catalogDefs.filter(isFillCandidate);
  const allCandidates  = [...cashCandidates, ...fillCandidates.filter((d) => !cashCandidates.includes(d))];
  // Always include all defs if catalog is small; otherwise limit to candidates
  const defsToTry = catalogDefs.length > 0
    ? (allCandidates.length > 0 ? allCandidates : catalogDefs)
    : [];

  console.log(`\n  Catalog: ${catalogDefs.length} total defs.`);
  console.log(`  Cash/History candidates: ${cashCandidates.map((d) => `"${d.name}"`).join(", ") || "(none)"}`);
  console.log(`  Fill/Order candidates:   ${fillCandidates.map((d) => `"${d.name}"`).join(", ") || "(none)"}`);
  console.log(`  Will try: ${defsToTry.length} definitions.\n`);

  const successfulReports: ReportResult[] = [];
  const triedReports: ReportResult[] = [];

  // Build a clean body — only required params plus account. Never sends empty
  // optional params (no cashChangeType:"", contract:"", product:"", etc.).
  // `timezone` is included with whatever JS type is passed (number / string) so
  // we can test whether the reports host expects a numeric UTC offset.
  function buildCleanBody(
    def: CatalogDefinition,
    accountValue: string,
    dateFormat: "mmddyyyy" | "iso",
    template: string | undefined,
    timezone: number | string | undefined,
    representationType: string,
  ): Record<string, unknown> {
    const startDate = dateFormat === "mmddyyyy" ? startMD : startIso;
    const endDate   = dateFormat === "mmddyyyy" ? endMD   : endIso;
    // Only send required params; add `account` (useful, account-scopes the report).
    const requiredNames = new Set(
      (def.params ?? []).filter((p) => p.optional === false).map((p) => p.name),
    );
    const params: Array<{ name: string; value: string }> = [];
    const pushIf = (name: string, value: string) => {
      if (requiredNames.has(name) || name === "account" || name === "startDate" || name === "endDate") {
        params.push({ name, value });
      }
    };
    pushIf("startDate", startDate);
    pushIf("endDate", endDate);
    pushIf("account", accountValue);
    const repType = def.representationTypes?.includes(representationType)
      ? representationType
      : (def.representationTypes?.[0] ?? representationType);
    const body: Record<string, unknown> = { name: def.name, params, representationType: repType };
    if (timezone !== undefined) body["timezone"] = timezone; // numeric or string
    if (template) body["template"] = template;
    return body;
  }

  // Richer content analysis for any 2xx report body (req #7).
  function analyzeReportBody(body: string): void {
    const checks: Array<[string, RegExp]> = [
      ["dates",          /\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}/],
      ["Account",        /account/i],
      ["Trade Paired",   /trade ?paired/i],
      ["Cash Change Type", /cash ?change ?type/i],
      ["Amount",         /amount/i],
      ["Realized P&L",   /realized ?p&?l|realizedpnl/i],
      ["Fill ID",        /fill ?id/i],
      ["Order ID",       /order ?id/i],
    ];
    const found = checks.filter(([, re]) => re.test(body)).map(([k]) => k);
    console.log(`  FIELD SIGNALS: ${found.length ? found.join(", ") : "(none)"}`);
    // Negative amount <= -100 (diagnostic signal only)
    const negs = [...body.matchAll(/-?\$?\s?(\d[\d,]*\.\d{2})/g)]
      .map((m) => Number(m[1]!.replace(/,/g, "")) * (m[0]!.includes("-") ? -1 : 1))
      .filter((n) => n <= -100);
    if (negs.length > 0) console.log(`  *** NEGATIVE AMOUNT(S) <= -$100 IN RESPONSE: ${negs.slice(0, 10).map((n) => n.toFixed(2)).join(", ")} ***`);
  }

  // The 5 catalog-confirmed reports we care about, with their exact templates.
  const focusReports: Array<{ name: string; templates: string[] }> = [
    { name: "Cash History",            templates: ["Default.html"] },
    { name: "Account Balance History", templates: ["Default.html"] },
    { name: "Orders",                  templates: ["Default.md", "pdf.html"] },
    { name: "Fills",                   templates: ["Default.md", "pdf.html"] },
    { name: "Performance",             templates: ["Flex.html", "Default.html", "pdf.html"] },
  ];
  const byName = new Map(catalogDefs.map((d) => [d.name, d]));

  // Timezone variants — the prime suspect for "Invalid JSON: illegal number".
  // The string forms are controls; numeric UTC offsets are the hypothesis.
  const tzVariants: Array<{ tz: number | string | undefined; desc: string }> = [
    { tz: 0,    desc: "numeric 0 (UTC)" },
    { tz: -300, desc: "numeric -300 (UTC-5 / EST mins)" },
    { tz: -360, desc: "numeric -360 (UTC-6 / CST mins)" },
    { tz: 300,  desc: "numeric 300" },
    { tz: 360,  desc: "numeric 360" },
    { tz: "0",  desc: 'string "0" (control)' },
    { tz: "America/Chicago", desc: 'string "America/Chicago" (control, expected to 400)' },
    { tz: undefined, desc: "omitted (control — expect missing-field error)" },
  ];

  // ── 5b. PHASE 1 — timezone-shape probe on Cash History ────────────────────
  // Hold report=Cash History, account=name, dates=MM/DD/YYYY, template=Default.html,
  // repType=html; vary ONLY the timezone shape. This isolates the tz hypothesis.
  console.log(`\n  ── PHASE 1: timezone-shape probe (Cash History / Default.html) ──`);
  let workingTz: number | string | undefined = undefined;
  let phase1Found = false;
  const cashDef = byName.get("Cash History");
  if (!cashDef) {
    console.log(`  "Cash History" not in catalog — skipping phase 1.`);
  } else {
    for (const { tz, desc } of tzVariants) {
      const body = buildCleanBody(cashDef, acctName, "mmddyyyy", "Default.html", tz, "html");
      const label = `Cash History | tz=${desc} | type=${typeof tz} | acct=${acctName} | Default.html`;
      const r = await tryReport(client, "Cash History", label, body, false);
      triedReports.push(r);
      // A non-400 status (even a different error) means the tz shape changed behaviour.
      if (r.status !== 400 && r.status !== 0) {
        console.log(`  → timezone variant "${desc}" produced HTTP ${r.status} (not 400) — shape matters!`);
      }
      if (r.success) {
        analyzeReportBody(await Promise.resolve(r.bodyPreview));
        successfulReports.push(r);
        workingTz = tz;
        phase1Found = true;
        break;
      }
    }
    if (!phase1Found) {
      // Record which tz gave the best (non-400) status for the report.
      const nonBad = triedReports.filter((r) => r.status !== 400 && r.status !== 0);
      if (nonBad.length > 0) {
        console.log(`\n  Phase 1: no 2xx, but these tz shapes avoided HTTP 400:`);
        for (const r of nonBad) console.log(`    ${r.label} → HTTP ${r.status}`);
        // Adopt the first non-400 tz for phase 2.
        const firstGood = tzVariants.find((v) => {
          const match = triedReports.find((r) => r.label.includes(`tz=${v.desc}`));
          return match && match.status !== 400 && match.status !== 0;
        });
        if (firstGood) workingTz = firstGood.tz;
      } else {
        console.log(`\n  Phase 1: every timezone variant returned HTTP 400.`);
        console.log(`  → timezone shape alone does not fix it; phase 2 will still try numeric 0.`);
        workingTz = 0; // best hypothesis for phase 2
      }
    }
  }

  // ── 5c. PHASE 2 — full report sweep using the working timezone ────────────
  console.log(`\n  ── PHASE 2: report sweep (timezone=${JSON.stringify(workingTz)} type=${typeof workingTz}) ──`);
  for (const fr of focusReports) {
    const def = byName.get(fr.name);
    if (!def) { console.log(`\n  "${fr.name}" not in catalog — skipping.`); continue; }
    console.log(`\n  ════ ${fr.name} ════  (catalog templates: ${def.templates?.join(", ") || "none"})`);

    let frDone = false;
    // Prefer the report's catalog-declared templates; fall back to the requested list.
    const templates = (def.templates?.length ? def.templates : fr.templates) as string[];
    for (const template of templates) {
      if (frDone) break;
      for (const accountValue of [acctName, String(acctId)]) {
        if (frDone) break;
        for (const dateFormat of (["mmddyyyy", "iso"] as const)) {
          const body = buildCleanBody(def, accountValue, dateFormat, template, workingTz, "html");
          const label = `${fr.name} | tz=${JSON.stringify(workingTz)} | ${template} | acct=${accountValue} | dates=${dateFormat}`;
          const r = await tryReport(client, fr.name, label, body, false);
          triedReports.push(r);
          if (r.success) {
            analyzeReportBody(r.bodyPreview);
            successfulReports.push(r);
            frDone = true;
            break;
          }
        }
      }
    }
  }

  if (successfulReports.length > 0) {
    console.log(`\n  ✓ REPORT SUCCESS: ${successfulReports.map((r) => `"${r.name}"`).join(", ")}`);
  } else {
    console.log(`\n  ✗ All focused report variants failed.`);
    console.log(`  Status breakdown:`);
    const byStatus = new Map<number, number>();
    for (const r of triedReports) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
    for (const [status, count] of byStatus) console.log(`    HTTP ${status}: ${count} attempts`);
    // Show distinct error messages to spot whether the "illegal number" changed.
    const distinctErrors = new Set(triedReports.map((r) => r.bodyPreview.slice(0, 120)));
    console.log(`  Distinct response previews (${distinctErrors.size}):`);
    for (const e of distinctErrors) console.log(`    ${e}`);
  }

  // ── 5d. Account Balance History — PARSED via production client method ─────
  section("Account Balance History (PARSED) — PRODUCTION-CANDIDATE SOURCE");

  // Use the real production client method + parser, not ad-hoc probing, so this
  // section validates exactly what the app would use.
  let abhDays: AccountBalanceHistoryDay[] | null = null;
  let abhEarliest: string | null = null;
  let abhLatest: string | null = null;
  let abhTotalRealized = 0;
  let abhMinDay: number | null = null;
  let abhMaxDay: number | null = null;
  const abhLargeLossDays: string[] = [];
  try {
    // account name first (the confirmed working identifier), then numeric id.
    for (const acctVal of [acctName, String(acctId)]) {
      abhDays = await client.getAccountBalanceHistoryReport(acctVal, startMD, endMD);
      if (abhDays && abhDays.length > 0) {
        console.log(`  account="${acctVal}" → ${abhDays.length} parsed day rows`);
        break;
      }
      console.log(`  account="${acctVal}" → ${abhDays == null ? "null (request failed)" : "0 rows"}`);
    }
  } catch (err) {
    console.log(`  getAccountBalanceHistoryReport error: ${err instanceof Error ? err.message : err}`);
  }

  const abhDayMap: Record<string, number> = {};
  if (abhDays && abhDays.length > 0) {
    const sortedDates = abhDays.map((d) => d.tradeDate).filter(Boolean).sort();
    abhEarliest = sortedDates[0] ?? null;
    abhLatest = sortedDates[sortedDates.length - 1] ?? null;
    for (const d of abhDays) {
      abhDayMap[d.tradeDate] = round2((abhDayMap[d.tradeDate] ?? 0) + d.realizedPnl);
    }
    const vals = Object.values(abhDayMap);
    abhTotalRealized = round2(vals.reduce((s, v) => s + v, 0));
    abhMinDay = vals.length ? Math.min(...vals) : null;
    abhMaxDay = vals.length ? Math.max(...vals) : null;
    for (const [k, v] of Object.entries(abhDayMap)) {
      if (v <= -100) abhLargeLossDays.push(k);
    }

    console.log(`\n  Parsed Account Balance History day series:`);
    console.log(`  Row count:     ${abhDays.length}`);
    console.log(`  Day count:     ${Object.keys(abhDayMap).length}`);
    console.log(`  Earliest date: ${abhEarliest}`);
    console.log(`  Latest date:   ${abhLatest}`);
    console.log(`  Total realized P&L: ${fmt$(abhTotalRealized)}`);
    console.log(`  Min daily realized: ${fmt$(abhMinDay)}`);
    console.log(`  Max daily realized: ${fmt$(abhMaxDay)}`);
    if (abhLargeLossDays.length > 0) {
      console.log(`  *** DAYS WITH REALIZED P&L <= -$100: ${abhLargeLossDays.join(", ")} ***`);
    }
    console.log(`\n  Daily realized P&L map (first 20):`);
    for (const [k, v] of Object.entries(abhDayMap).sort().slice(0, 20)) {
      console.log(`    ${k}  ${fmt$(v)}`);
    }

    // Coverage comparison vs cashBalanceLog/deps.
    console.log(`\n  ── COVERAGE: Account Balance History vs cashBalanceLog/deps ──`);
    const depsEarliestKey = depsSummary?.earliest?.slice(0, 10) ?? null;
    console.log(`  cashBalanceLog/deps earliest: ${depsEarliestKey ?? "—"}  (${depsSummary?.rows ?? 0} rows)`);
    console.log(`  Account Balance History earliest: ${abhEarliest ?? "—"}  (${Object.keys(abhDayMap).length} days)`);
    if (abhEarliest && depsEarliestKey && abhEarliest < depsEarliestKey) {
      console.log(`  ✓ Account Balance History is WIDER — exposes ${abhEarliest} which deps does not.`);
    } else if (abhEarliest && depsEarliestKey && abhEarliest >= depsEarliestKey) {
      console.log(`  Account Balance History earliest is not earlier than deps.`);
    }
  } else {
    console.log(`\n  No parseable Account Balance History rows.`);
    console.log(`  (If Section 5 PHASE 2 showed a 2xx for Account Balance History, the parser`);
    console.log(`   may need a fixture from the live HTML — capture the body and compare.)`);
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
      notes: "Detailed ledger source (TradePaired + fee rows). Account-scoped. May be limited to a short recent window — NOT guaranteed complete all-time history.",
    });
  }

  if (abhDays && abhDays.length > 0) {
    sources.push({
      name: 'reports "Account Balance History" (parsed)',
      rows: abhDays.length,
      earliest: abhEarliest,
      latest: abhLatest,
      totalNet: abhTotalRealized,
      minDay: abhMinDay,
      accountScoped: true,
      productionSafe: true,
      largeLossDays: abhLargeLossDays,
      notes: "PRODUCTION-CANDIDATE for historical account-level realized P&L. Wider history than cashBalanceLog/deps. Parsed via getAccountBalanceHistoryReport (timezone=0, Default.html).",
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
    console.log(`    - The data may be on a sub-account not returned by account/list`);
    console.log(`    - The data may pre-date this account's API retention window`);
  }
  console.log();

  // requestReportDefinitions returning 200 means the reports host IS reachable.
  // Only attribute failure to scope if that catalog call itself failed.
  const reportsHostReachable = catalogDefs.length > 0;
  if (successfulReports.length === 0) {
    console.log(`  reports/requestreport: ALL VARIANTS FAILED`);
    if (reportsHostReachable) {
      console.log(`    NOTE: requestReportDefinitions returned 200 and a non-empty catalog,`);
      console.log(`    so the reports host IS reachable with this token. The failure is a`);
      console.log(`    request-body-shape problem (most likely the timezone field type or a`);
      console.log(`    param shape), NOT an auth/scope problem.`);
      console.log(`    → Review the Phase 1 timezone-shape results above to see which tz type`);
      console.log(`      (numeric offset vs string) changed the HTTP status away from 400.`);
    } else {
      console.log(`    requestReportDefinitions did NOT return a catalog — reports host access`);
      console.log(`    may genuinely be unavailable for this token. → See Section 7.`);
    }
  }
  console.log();

  console.log(`  RECOMMENDATION:`);
  const abhWider =
    abhDays != null && abhDays.length > 0 && abhEarliest != null &&
    (depsSummary?.earliest == null || abhEarliest < depsSummary.earliest.slice(0, 10));
  if (abhWider) {
    console.log(`    Account-level historical realized P&L → reports "Account Balance History"`);
    console.log(`      (timezone=0, template=Default.html, params startDate/endDate/account).`);
    console.log(`      Parsed via getAccountBalanceHistoryReport. Earliest ${abhEarliest}, ${Object.keys(abhDayMap).length} days.`);
    console.log(`      This is WIDER than cashBalanceLog/deps and should be the historical source of truth.`);
    console.log(`    Recent fee-level / TradePaired breakdown → cashBalanceLog/deps (detailed ledger).`);
    console.log(`    NOTE: cashBalanceLog/deps is NOT complete all-time history for this account.`);
  } else if (abhDays != null && abhDays.length > 0) {
    console.log(`    Account Balance History parsed (${abhDays.length} rows) but not wider than deps for this account.`);
    console.log(`    Keep cashBalanceLog/deps as the detailed ledger; use the report when it extends coverage.`);
  } else if (depsSummary && depsSummary.rows > 0) {
    console.log(`    cashBalanceLog/deps?masterid={tvAccountId} is account-scoped and production-safe`);
    console.log(`    for detailed recent ledger rows, but may be a partial window. Validate against`);
    console.log(`    the Account Balance History report (Section 5d) for wider history.`);
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
