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
