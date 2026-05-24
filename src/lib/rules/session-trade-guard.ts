import { prisma } from "@/lib/db";

const TRADE_EVENT_TYPES = [
  "fill",
  "trade_closed",
  "trade_closed_win",
  "trade_closed_loss",
] as const;

/**
 * Returns the subset of accountIds that have at least one NormalizedTradeEvent
 * within the current CME session (occurredAt >= sessionStart).
 *
 * Use this as a secondary lock signal alongside LiveSessionState.tradesCount
 * to close the first-fill race window: the fill event is persisted immediately
 * while tradesCount/sessionDate only update after the next sync completes.
 *
 * Safe: read-only, no broker calls, no writes.
 *
 * TODO: Add open-position lock from stored broker sync state (e.g. a persisted
 * open-positions snapshot) once that data is available in the DB. Until then,
 * the NormalizedTradeEvent fill check catches in-progress positions because a
 * fill event is written as soon as a position is opened.
 */
export async function getAccountIdsWithTradeToday(
  accountIds: string[],
  sessionStart: Date,
): Promise<Set<string>> {
  if (accountIds.length === 0) return new Set();

  const rows = await prisma.normalizedTradeEvent.findMany({
    where: {
      accountId: { in: accountIds },
      occurredAt: { gte: sessionStart },
      eventType: { in: [...TRADE_EVENT_TYPES] },
    },
    select: { accountId: true },
    distinct: ["accountId"],
  });

  return new Set(rows.map((r) => r.accountId));
}

/**
 * Returns the number of trade-classified NormalizedTradeEvents for one account
 * within the current CME session (occurredAt >= sessionStart).
 *
 * Diagnostic counterpart to getAccountIdsWithTradeToday — identical event-type
 * and session-window filter, but returns the raw count for a single account
 * instead of a presence Set. `count > 0` is therefore equivalent to that
 * account appearing in getAccountIdsWithTradeToday.
 *
 * Safe: read-only, no broker calls, no writes.
 */
export async function countTradeEventsThisSession(
  accountId: string,
  sessionStart: Date,
): Promise<number> {
  return prisma.normalizedTradeEvent.count({
    where: {
      accountId,
      occurredAt: { gte: sessionStart },
      eventType: { in: [...TRADE_EVENT_TYPES] },
    },
  });
}
