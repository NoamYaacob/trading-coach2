/**
 * Pure parser for the Tradovate "Fills" report.
 *
 * Requested via POST /v1/reports/requestreport with:
 *   { name: "Fills", template: "Default.md", representationType: "html",
 *     timezone: 0, params: [startDate, endDate, account] }
 *
 * Unlike Account Balance History (which is day-level only), the Fills report
 * exposes INDIVIDUAL historical fills — the building blocks for round-trip
 * trade rows on the Trades page. This is the source that lets us show trades
 * for accounts that already traded BEFORE Guardrail connected (the live
 * fill/list, fillPair/list, order/deps endpoints all return 0 historical rows).
 *
 * The report body (representationType=html, Default.md template) renders as
 * sections grouped by contract and date, each followed by a fills table:
 *
 *   <h3><strong>MNQM6</strong></h3>
 *   <h4>4/30/26: 20 fills</h4>
 *   <table>
 *     <tr><th>Fill ID</th><th>Order ID</th><th>B/S</th><th>Quantity</th>
 *         <th>Price</th><th>Contract</th><th>Timestamp</th><th>Account</th></tr>
 *     <tr><td>12345</td><td>9876</td><td>Buy</td><td>2</td>
 *         <td>20000.25</td><td>MNQM6</td><td>4/30/2026 09:31:05</td><td>1868411</td></tr>
 *     …
 *   </table>
 *
 * Pure — no network, no logging, no side effects. Never throws.
 */

export type HistoricalFillRow = {
  /** Tradovate fill id (stable broker identifier). */
  fillId: string;
  /** Tradovate order id this fill belongs to. */
  orderId: string;
  /** Normalized to "BUY" | "SELL". */
  side: "BUY" | "SELL";
  /** Filled quantity (always positive). */
  quantity: number;
  /** Fill price. */
  price: number;
  /** Contract symbol as reported, e.g. "MNQM6". */
  contract: string;
  /** Fill time as an ISO-8601 UTC string (report timezone=0). */
  timestamp: string;
  /** Account name/label as reported. */
  accountName: string;
};

export type ParseInput = {
  body: string;
  contentType?: string | null;
};

// Header label matchers — flexible to spacing / punctuation variations.
const COL_MATCHERS = {
  fillId:    [/^fill\s*id$/i, /^fillid$/i],
  orderId:   [/^order\s*id$/i, /^orderid$/i],
  side:      [/^b\s*\/?\s*s$/i, /^buy\s*\/?\s*sell$/i, /^side$/i, /^action$/i],
  quantity:  [/^quantity$/i, /^qty$/i, /^size$/i],
  price:     [/^price$/i, /^fill\s*price$/i],
  contract:  [/^contract$/i, /^symbol$/i, /^instrument$/i],
  timestamp: [/^timestamp$/i, /^time$/i, /^date\s*\/?\s*time$/i, /^fill\s*time$/i],
  accountName: [/^account$/i, /^account\s*name$/i, /^acct$/i],
} as const;

type ColKey = keyof typeof COL_MATCHERS;

/**
 * Parse the Fills report body into normalized fill rows. Tries JSON first
 * (when the body is JSON), then falls back to HTML table extraction. Returns
 * [] when nothing parseable is found. Never throws.
 */
export function parseFillsReport(input: ParseInput): HistoricalFillRow[] {
  const ct = (input.contentType ?? "").toLowerCase();
  const body = input.body ?? "";

  if (ct.includes("json") || isLikelyJson(body)) {
    try {
      const data: unknown = JSON.parse(body);
      const rows = parseJsonRows(data);
      if (rows.length > 0) return rows;
    } catch {
      // Fall through to HTML.
    }
  }

  return parseHtmlRows(body);
}

// ── JSON parsing ────────────────────────────────────────────────────────────

function parseJsonRows(data: unknown): HistoricalFillRow[] {
  let arr: unknown = data;
  if (data != null && !Array.isArray(data) && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    arr = obj["data"] ?? obj["rows"] ?? obj["fills"] ?? obj["report"] ?? obj["results"] ?? data;
  }
  if (!Array.isArray(arr)) return [];

  const out: HistoricalFillRow[] = [];
  for (const item of arr) {
    if (item == null || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const row = buildRow({
      fillId: stringOf(pickByMatch(obj, COL_MATCHERS.fillId)),
      orderId: stringOf(pickByMatch(obj, COL_MATCHERS.orderId)),
      side: stringOf(pickByMatch(obj, COL_MATCHERS.side)),
      quantity: stringOf(pickByMatch(obj, COL_MATCHERS.quantity)),
      price: stringOf(pickByMatch(obj, COL_MATCHERS.price)),
      contract: stringOf(pickByMatch(obj, COL_MATCHERS.contract)),
      timestamp: stringOf(pickByMatch(obj, COL_MATCHERS.timestamp)),
      accountName: stringOf(pickByMatch(obj, COL_MATCHERS.accountName)),
    });
    if (row) out.push(row);
  }
  return out;
}

function pickByMatch(obj: Record<string, unknown>, matchers: readonly RegExp[]): unknown {
  for (const [key, value] of Object.entries(obj)) {
    const norm = key.trim();
    if (matchers.some((re) => re.test(norm))) return value;
  }
  return undefined;
}

function stringOf(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

// ── HTML parsing ────────────────────────────────────────────────────────────

function parseHtmlRows(html: string): HistoricalFillRow[] {
  if (!html) return [];
  const out: HistoricalFillRow[] = [];

  // Parse each <table> independently — the report renders one table per
  // contract/date section, each with its own header row.
  const tables = extractTables(html);
  const tableRows = tables.length > 0 ? tables : [extractTableRows(html)];

  for (const rows of tableRows) {
    if (rows.length === 0) continue;

    // Find the header row: the one matching the most target columns.
    let headerIdx = -1;
    let bestScore = 0;
    let bestMap: Partial<Record<ColKey, number>> = {};
    for (let i = 0; i < rows.length; i++) {
      const { score, map } = scoreHeader(rows[i]!);
      if (score > bestScore) {
        bestScore = score;
        headerIdx = i;
        bestMap = map;
      }
    }
    // Require at least Fill ID + B/S + Quantity + Price to trust the table.
    if (
      headerIdx < 0 ||
      bestMap.fillId == null ||
      bestMap.side == null ||
      bestMap.quantity == null ||
      bestMap.price == null
    ) {
      continue;
    }

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const cells = rows[i]!;
      const row = buildRow({
        fillId: cellAt(cells, bestMap.fillId),
        orderId: cellAt(cells, bestMap.orderId),
        side: cellAt(cells, bestMap.side),
        quantity: cellAt(cells, bestMap.quantity),
        price: cellAt(cells, bestMap.price),
        contract: cellAt(cells, bestMap.contract),
        timestamp: cellAt(cells, bestMap.timestamp),
        accountName: cellAt(cells, bestMap.accountName),
      });
      if (row) out.push(row);
    }
  }

  return out;
}

function scoreHeader(cells: string[]): {
  score: number;
  map: Partial<Record<ColKey, number>>;
} {
  const map: Partial<Record<ColKey, number>> = {};
  let score = 0;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!;
    for (const col of Object.keys(COL_MATCHERS) as ColKey[]) {
      if (map[col] != null) continue;
      if (COL_MATCHERS[col].some((re) => re.test(cell))) {
        map[col] = i;
        score++;
        break;
      }
    }
  }
  return { score, map };
}

function cellAt(cells: string[], idx: number | undefined): string {
  if (idx == null) return "";
  return cells[idx] ?? "";
}

/** Split the document into per-<table> row arrays. */
function extractTables(html: string): string[][][] {
  const tables: string[][][] = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(html)) !== null) {
    const rows = extractTableRows(m[1]!);
    if (rows.length > 0) tables.push(rows);
  }
  return tables;
}

function extractTableRows(html: string): string[][] {
  if (!html) return [];
  const rows: string[][] = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRe.exec(html)) !== null) {
    const inner = trMatch[1]!;
    const cellRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells: string[] = [];
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(inner)) !== null) {
      cells.push(stripCell(cellMatch[1]!));
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

function stripCell(cell: string): string {
  return cell
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Row building / normalization ─────────────────────────────────────────────

function buildRow(raw: {
  fillId: string;
  orderId: string;
  side: string;
  quantity: string;
  price: string;
  contract: string;
  timestamp: string;
  accountName: string;
}): HistoricalFillRow | null {
  const fillId = raw.fillId.trim();
  const side = normalizeSide(raw.side);
  const quantity = parseNumber(raw.quantity);
  const price = parseNumber(raw.price);
  const timestamp = parseFillTimestamp(raw.timestamp);

  // A valid fill needs an id, a side, a positive quantity, a finite price, and
  // a parseable timestamp. Anything missing means this isn't a real fill row
  // (e.g. a stray header, total, or layout row) — skip it rather than guess.
  if (!fillId) return null;
  if (side == null) return null;
  if (quantity == null || quantity <= 0) return null;
  if (price == null) return null;
  if (timestamp == null) return null;

  return {
    fillId,
    orderId: raw.orderId.trim(),
    side,
    quantity,
    price,
    contract: raw.contract.trim(),
    timestamp,
    accountName: raw.accountName.trim(),
  };
}

/** Normalize "B"/"S", "Buy"/"Sell", "BUY"/"SELL" → "BUY" | "SELL". */
export function normalizeSide(raw: string): "BUY" | "SELL" | null {
  const t = raw.trim().toLowerCase();
  if (t === "b" || t === "buy" || t === "bought" || t === "long") return "BUY";
  if (t === "s" || t === "sell" || t === "sold" || t === "short" || t === "sld") return "SELL";
  return null;
}

function parseNumber(raw: string): number | null {
  const t = raw.replace(/[$,\s]/g, "").trim();
  if (t.length === 0) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a fill timestamp into an ISO-8601 UTC string. The report is requested
 * with timezone=0 so the times are already UTC.
 *
 * Handles "M/D/YY HH:mm:ss", "MM/DD/YYYY HH:mm:ss", "M/D/YYYY H:mm",
 * "YYYY-MM-DD HH:mm:ss" and ISO strings. Two-digit years map to 20YY.
 * Returns null when not a recognizable date/time. Never throws.
 */
export function parseFillTimestamp(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;

  // ISO-8601 (already has T or a 4-digit-year leading date).
  const isoMatch = t.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/,
  );
  if (isoMatch) {
    return buildIso(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
      Number(isoMatch[4]),
      Number(isoMatch[5]),
      Number(isoMatch[6] ?? 0),
    );
  }

  // US date with time: M/D/YY[YY] H:mm[:ss]
  const usMatch = t.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (usMatch) {
    const mm = Number(usMatch[1]);
    const dd = Number(usMatch[2]);
    let yyyy = Number(usMatch[3]);
    if (yyyy < 100) yyyy += 2000;
    const hh = Number(usMatch[4] ?? 0);
    const min = Number(usMatch[5] ?? 0);
    const ss = Number(usMatch[6] ?? 0);
    return buildIso(yyyy, mm, dd, hh, min, ss);
  }

  return null;
}

function buildIso(
  y: number,
  m: number,
  d: number,
  hh: number,
  min: number,
  ss: number,
): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (hh > 23 || min > 59 || ss > 59) return null;
  const ms = Date.UTC(y, m - 1, d, hh, min, ss);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function isLikelyJson(body: string): boolean {
  const t = body.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}
