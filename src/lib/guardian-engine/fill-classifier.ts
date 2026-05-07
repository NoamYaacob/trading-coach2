/**
 * Pure, dependency-free fill classifier.
 *
 * Determines whether an incoming fill represents a new trade entry, an
 * addition to an existing position, a direction reversal, or a position
 * reduction/exit.
 *
 * Mirrors the position logic in traceEntryTrades (tradovate-client-helpers)
 * so real-time webhook counting stays consistent with sync-based counting.
 *
 *   entry    — position was flat, now non-zero (new trade opened)
 *   scale_in — position grew in the same direction (adding to existing trade)
 *   reversal — position flipped sign without a flat stop in between
 *   reduction — position shrank or closed (exit fill, not a new entry)
 */

/**
 * Normalize any side string from the database to a canonical "BUY" | "SELL".
 *
 * Tradovate and some prop-firm wrappers store side direction as "LONG"/"SHORT"
 * (position direction) rather than "BUY"/"SELL" (order action). Both forms mean
 * the same thing: LONG/BUY increases net position, SHORT/SELL decreases it.
 *
 * Use this before position arithmetic whenever reading side from the DB, to
 * prevent "LONG" from being silently treated as "SELL" by the === "BUY" check.
 */
export function normalizeSide(side: string | null | undefined): "BUY" | "SELL" {
  if (side == null) return "SELL";
  const s = side.toUpperCase();
  return s === "BUY" || s === "LONG" ? "BUY" : "SELL";
}

export function classifyFill(
  netPositionBefore: number,
  side: "BUY" | "SELL",
  qty: number,
): "entry" | "scale_in" | "reversal" | "reduction" {
  const delta = side === "BUY" ? qty : -qty;
  const next = netPositionBefore + delta;

  if (netPositionBefore === 0 && next !== 0) return "entry";
  if (
    netPositionBefore !== 0 &&
    next !== 0 &&
    Math.sign(netPositionBefore) !== Math.sign(next)
  )
    return "reversal";
  if (
    netPositionBefore !== 0 &&
    Math.sign(netPositionBefore) === Math.sign(next) &&
    Math.abs(next) > Math.abs(netPositionBefore)
  )
    return "scale_in";
  return "reduction";
}
