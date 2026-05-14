/**
 * Pure parser for the Tradovate Performance Report response body.
 *
 * The reporting endpoint /v1/reports/requestreport returns the report in one
 * of several serializations depending on the requested representationType
 * and the user's plan. This parser handles the three observed shapes —
 * HTML, CSV, JSON — and walks each looking for the "# of Trades" value.
 *
 * Returns null when no parseable count is found. Never throws.
 *
 * NOTE: pure — no network calls, no logging, no side effects. Safe to
 * unit-test against captured response bodies.
 */

const TRADE_COUNT_LABELS = [
  "# of Trades",
  "Number of Trades",
  "Trade Count",
  "Trades",
  "Total Trades",
] as const;

export type ParseInput = {
  body: string;
  contentType?: string | null;
};

export function parsePerformanceReportTradeCount(input: ParseInput): number | null {
  const ct = (input.contentType ?? "").toLowerCase();

  if (ct.includes("json") || isLikelyJson(input.body)) {
    try {
      const data = JSON.parse(input.body) as unknown;
      const found = findTradeCountInJson(data);
      if (found != null) return found;
    } catch {
      // Fall through to the next parser
    }
  }

  if (ct.includes("csv") || isLikelyCsv(input.body)) {
    const found = parseCsvForTradeCount(input.body);
    if (found != null) return found;
  }

  // HTML is the catch-all (and the default when representationType=html).
  // Strip tags to plain text and look for any of the labels followed by an integer.
  const html = parseHtmlForTradeCount(input.body);
  if (html != null) return html;

  // Final fallback: scan as raw text for label/number pattern. This catches
  // weird wrapping like <td>#&nbsp;of&nbsp;Trades</td><td>11</td>.
  return scanRawTextForTradeCount(input.body);
}

function isLikelyJson(body: string): boolean {
  const t = body.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}

function isLikelyCsv(body: string): boolean {
  const head = body.slice(0, 256);
  // Heuristic: a comma in the first line and no leading angle bracket.
  return head.includes(",") && !head.trimStart().startsWith("<");
}

function parseHtmlForTradeCount(html: string): number | null {
  if (!html) return null;
  // Replace tags with spaces to keep adjacent words separated.
  const stripped = html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ");
  return findLabelledNumberInText(stripped);
}

function scanRawTextForTradeCount(body: string): number | null {
  // Last-resort scan against the unstripped body — handles minimal HTML or
  // unexpected serializations where the tag-stripper didn't apply cleanly.
  const collapsed = body.replace(/[   ]/g, " ").replace(/\s+/g, " ");
  return findLabelledNumberInText(collapsed);
}

function findLabelledNumberInText(text: string): number | null {
  for (const label of TRADE_COUNT_LABELS) {
    const re = new RegExp(`${escapeRegex(label)}[^0-9-]{0,32}(-?\\d+)`, "i");
    const m = text.match(re);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function parseCsvForTradeCount(csv: string): number | null {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;

  // Pattern 1: header column + data row(s) → "# of Trades" is a column header.
  const header = parseCsvLine(lines[0]);
  const headerIdx = findLabelIndex(header);
  if (headerIdx >= 0) {
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]);
      const v = cells[headerIdx]?.trim();
      const n = toIntStrict(v);
      if (n != null) return n;
    }
  }

  // Pattern 2: label/value pairs in adjacent cells (statistic name, statistic value).
  for (const line of lines) {
    const cells = parseCsvLine(line);
    for (let i = 0; i < cells.length; i++) {
      if (matchesLabel(cells[i])) {
        for (let j = i + 1; j < cells.length; j++) {
          const n = toIntStrict(cells[j]?.trim());
          if (n != null) return n;
        }
      }
    }
  }

  return null;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let i = 0;
  let inQuotes = false;
  let cur = "";
  while (i < line.length) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 2;
      } else if (ch === '"') {
        inQuotes = false;
        i++;
      } else {
        cur += ch;
        i++;
      }
    } else if (ch === '"') {
      inQuotes = true;
      i++;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
      i++;
    } else {
      cur += ch;
      i++;
    }
  }
  cells.push(cur);
  return cells;
}

function findTradeCountInJson(data: unknown): number | null {
  if (data == null) return null;
  if (Array.isArray(data)) {
    for (const item of data) {
      const v = findTradeCountInJson(item);
      if (v != null) return v;
    }
    return null;
  }
  if (typeof data !== "object") return null;
  const obj = data as Record<string, unknown>;

  // Direct key match.
  for (const [key, value] of Object.entries(obj)) {
    if (matchesLabel(key)) {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string") {
        const n = toIntStrict(value.trim());
        if (n != null) return n;
      }
    }
  }

  // {name, value} or {label, value} row patterns common in report payloads.
  const rowName = pickString(obj, ["name", "label", "key", "statistic", "stat"]);
  const rowValue = obj.value ?? obj.amount ?? obj.count;
  if (rowName && matchesLabel(rowName)) {
    if (typeof rowValue === "number" && Number.isFinite(rowValue)) return rowValue;
    if (typeof rowValue === "string") {
      const n = toIntStrict(rowValue.trim());
      if (n != null) return n;
    }
  }

  // Recurse into nested values.
  for (const value of Object.values(obj)) {
    const v = findTradeCountInJson(value);
    if (v != null) return v;
  }
  return null;
}

function pickString(obj: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

function matchesLabel(s: string | undefined | null): boolean {
  if (!s) return false;
  const norm = s.trim().toLowerCase();
  return TRADE_COUNT_LABELS.some((l) => l.toLowerCase() === norm);
}

function findLabelIndex(headerCells: string[]): number {
  for (let i = 0; i < headerCells.length; i++) {
    if (matchesLabel(headerCells[i])) return i;
  }
  return -1;
}

function toIntStrict(s: string | undefined | null): number | null {
  if (s == null) return null;
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
