/**
 * Pure parser for the Tradovate "Account Balance History" report.
 *
 * Requested via POST /v1/reports/requestreport with:
 *   { name: "Account Balance History", template: "Default.html",
 *     representationType: "html", timezone: 0,
 *     params: [startDate, endDate, account] }
 *
 * The report exposes account-level daily realized P&L that spans wider history
 * than cashBalanceLog/deps (which can be limited to a short recent window).
 * This module parses the report into a normalized day series. It is the
 * foundation for a future source-of-truth switch — it does NOT itself change
 * any product behaviour.
 *
 * Columns observed in the report:
 *   - Account ID
 *   - Account Name
 *   - Trade Date
 *   - Total Amount, $
 *   - Total Realized PNL, $
 *
 * Pure — no network, no logging, no side effects. Never throws.
 */

import { parseMoney } from "./tradovate-reports-parser.ts";

export type AccountBalanceHistoryDay = {
  /** "YYYY-MM-DD" trading date. */
  tradeDate: string;
  /** Account id as reported (string form, never coerced to number). */
  accountId: string;
  /** Account name/label as reported. */
  accountName: string;
  /** Total Amount, $ — signed running/total amount for the day. */
  totalAmount: number;
  /** Total Realized PNL, $ — signed realized P&L for the day. */
  realizedPnl: number;
};

export type ParseInput = {
  body: string;
  contentType?: string | null;
};

// Header label matchers — flexible to spacing / punctuation variations.
const COL_MATCHERS: Record<keyof Omit<AccountBalanceHistoryDay, never>, RegExp[]> = {
  accountId:   [/account\s*id/i, /^acct\s*id/i],
  accountName: [/account\s*name/i, /^acct\s*name/i],
  tradeDate:   [/trade\s*date/i, /^date$/i],
  totalAmount: [/total\s*amount/i, /^amount/i],
  realizedPnl: [/total\s*realized\s*pn?l/i, /realized\s*pn?l/i, /realized\s*p\s*&?\s*l/i, /realized\s*p\/l/i],
};

/**
 * Parse the report body into normalized day rows. Tries JSON first (when the
 * body is JSON / field-data), then falls back to HTML table extraction.
 * Returns [] when nothing parseable is found. Never throws.
 */
export function parseAccountBalanceHistoryReport(input: ParseInput): AccountBalanceHistoryDay[] {
  const ct = (input.contentType ?? "").toLowerCase();
  const body = input.body ?? "";

  // 1. JSON path — body may be a JSON array of row objects, or {data:[…]}.
  if (ct.includes("json") || isLikelyJson(body)) {
    try {
      const data: unknown = JSON.parse(body);
      const rows = parseJsonRows(data);
      if (rows.length > 0) return rows;
    } catch {
      // Fall through to HTML.
    }
  }

  // 2. HTML table path.
  return parseHtmlRows(body);
}

/**
 * Build a daily realized-P&L map ("YYYY-MM-DD" → summed realizedPnl).
 * Duplicate dates are summed. By default zero-P&L days are kept; pass
 * { dropZero: true } to omit days whose summed realized P&L is exactly 0
 * (useful for a P&L-only series).
 */
export function buildRealizedPnlDayMap(
  days: AccountBalanceHistoryDay[],
  opts: { dropZero?: boolean } = {},
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const d of days) {
    if (!d.tradeDate) continue;
    map[d.tradeDate] = round2((map[d.tradeDate] ?? 0) + d.realizedPnl);
  }
  if (opts.dropZero) {
    for (const k of Object.keys(map)) {
      if (map[k] === 0) delete map[k];
    }
  }
  return map;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ── JSON parsing ────────────────────────────────────────────────────────────

function parseJsonRows(data: unknown): AccountBalanceHistoryDay[] {
  // Accept a bare array, or a wrapper like { data: [...] } / { rows: [...] }.
  let arr: unknown = data;
  if (data != null && !Array.isArray(data) && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    arr = obj["data"] ?? obj["rows"] ?? obj["report"] ?? obj["results"] ?? data;
  }
  if (!Array.isArray(arr)) return [];

  const out: AccountBalanceHistoryDay[] = [];
  for (const item of arr) {
    if (item == null || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const tradeDateRaw = pickByMatch(obj, COL_MATCHERS.tradeDate);
    const realizedRaw  = pickByMatch(obj, COL_MATCHERS.realizedPnl);
    // A valid row needs at least a date and a realized P&L.
    if (tradeDateRaw == null || realizedRaw == null) continue;
    const tradeDate = normalizeTradeDate(String(tradeDateRaw));
    const realizedPnl = coerceMoney(realizedRaw);
    if (!tradeDate || realizedPnl == null) continue;
    out.push({
      tradeDate,
      accountId:   String(pickByMatch(obj, COL_MATCHERS.accountId) ?? ""),
      accountName: String(pickByMatch(obj, COL_MATCHERS.accountName) ?? ""),
      totalAmount: coerceMoney(pickByMatch(obj, COL_MATCHERS.totalAmount)) ?? 0,
      realizedPnl,
    });
  }
  return out;
}

function pickByMatch(obj: Record<string, unknown>, matchers: RegExp[]): unknown {
  for (const [key, value] of Object.entries(obj)) {
    if (matchers.some((re) => re.test(key))) return value;
  }
  return undefined;
}

function coerceMoney(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return parseMoney(value);
  return null;
}

// ── HTML parsing ────────────────────────────────────────────────────────────

function parseHtmlRows(html: string): AccountBalanceHistoryDay[] {
  const rows = extractTableRows(html);
  if (rows.length === 0) return [];

  // Find the header row: the one matching the most target columns.
  let headerIdx = -1;
  let bestScore = 0;
  let bestMap: Partial<Record<keyof AccountBalanceHistoryDay, number>> = {};
  for (let i = 0; i < rows.length; i++) {
    const { score, map } = scoreHeader(rows[i]!);
    if (score > bestScore) {
      bestScore = score;
      headerIdx = i;
      bestMap = map;
    }
  }
  // Require at least Trade Date + Realized PNL columns to trust the table.
  if (headerIdx < 0 || bestMap.tradeDate == null || bestMap.realizedPnl == null) {
    return [];
  }

  const out: AccountBalanceHistoryDay[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = rows[i]!;
    const dateRaw = cellAt(cells, bestMap.tradeDate);
    const realizedRaw = cellAt(cells, bestMap.realizedPnl);
    if (dateRaw == null || realizedRaw == null) continue;
    const tradeDate = normalizeTradeDate(dateRaw);
    const realizedPnl = parseMoney(realizedRaw);
    if (!tradeDate || realizedPnl == null) continue;
    out.push({
      tradeDate,
      accountId:   cellAt(cells, bestMap.accountId) ?? "",
      accountName: cellAt(cells, bestMap.accountName) ?? "",
      totalAmount: parseMoney(cellAt(cells, bestMap.totalAmount)) ?? 0,
      realizedPnl,
    });
  }
  return out;
}

function scoreHeader(cells: string[]): {
  score: number;
  map: Partial<Record<keyof AccountBalanceHistoryDay, number>>;
} {
  const map: Partial<Record<keyof AccountBalanceHistoryDay, number>> = {};
  let score = 0;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!;
    for (const col of Object.keys(COL_MATCHERS) as Array<keyof AccountBalanceHistoryDay>) {
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

function cellAt(cells: string[], idx: number | undefined): string | undefined {
  if (idx == null) return undefined;
  const v = cells[idx];
  return v == null ? undefined : v;
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

/**
 * Normalize a date string to "YYYY-MM-DD". Handles "MM/DD/YYYY",
 * "YYYY-MM-DD", and ISO timestamps. Returns "" when not a recognizable date.
 */
export function normalizeTradeDate(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  // Already YYYY-MM-DD (optionally with a time suffix).
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // MM/DD/YYYY or M/D/YYYY.
  const us = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) {
    const mm = us[1]!.padStart(2, "0");
    const dd = us[2]!.padStart(2, "0");
    return `${us[3]}-${mm}-${dd}`;
  }
  return "";
}

function isLikelyJson(body: string): boolean {
  const t = body.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}
