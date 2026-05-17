import type { StatusBreakdown, CommandCenterAccount } from "./types";
import { buildRuleSummaryChips } from "../../../../lib/rules/rule-summary-chips.ts";

export { buildRuleSummaryChips };

/**
 * Formats the rule summary chips for an account as a single line of text.
 * Chips are joined with " · " (middle dot separator used throughout the dashboard).
 * Returns an empty string when there are no chips.
 */
export function formatRuleSummaryLine(account: CommandCenterAccount): string {
  const chips = buildRuleSummaryChips(account);
  return chips.map((c) => c.text).join(" · ");
}

/** Title of the summary tile that shows the "allowed" account count.
 *  Renamed from "Allowed" — the count alone (e.g. "Allowed 2") could imply
 *  every allowed account has the same protection level, hiding that some
 *  may be practice/demo. The tile pairs the count with a live/practice
 *  breakdown subtext so the user sees the mix at a glance. */
export const TRADABLE_ACCOUNTS_TILE_LABEL = "Tradable accounts";

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
