import type { StatusBreakdown } from "./types";

/** Format the live/practice split as a small inline hint:
 *    "1 live · 1 practice"  — both present
 *    "2 live"               — only one bucket
 *    undefined              — total is zero (no hint needed) */
export function formatBreakdownHint(b: StatusBreakdown): string | undefined {
  if (b.total === 0) return undefined;
  const parts: string[] = [];
  if (b.live > 0) parts.push(`${b.live} live`);
  if (b.practice > 0) parts.push(`${b.practice} practice`);
  if (parts.length === 0) return undefined;
  return parts.join(" · ");
}
