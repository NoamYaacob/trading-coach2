import { prisma } from "@/lib/db";

import { reconstructRoundTrips, type FillInput, type RoundTripTrade } from "./round-trips.ts";

type LoadOptions = {
  /** Inclusive lower bound on occurredAt — typically the start of the lookback window. */
  since?: Date;
  /** Max number of fills to fetch (round-trips emitted may be fewer). */
  limit?: number;
};

/**
 * Load round-trip trades for an account from NormalizedTradeEvent.
 *
 * Filters to events with a non-null `side` and `quantity` (i.e. fill-like
 * events), reads them in chronological order, then runs the pure
 * reconstruction over them.  Returns trades newest-first for display.
 *
 * Returns an empty array when the account has no events yet — callers should
 * render the honest empty state.
 */
export async function loadAccountTrades(
  accountId: string,
  opts: LoadOptions = {},
): Promise<RoundTripTrade[]> {
  const fills = await prisma.normalizedTradeEvent.findMany({
    where: {
      accountId,
      side: { not: null },
      quantity: { not: null },
      price: { not: null },
      ...(opts.since ? { occurredAt: { gte: opts.since } } : {}),
    },
    select: {
      id: true,
      externalTradeId: true,
      contractId: true,
      side: true,
      quantity: true,
      price: true,
      pnl: true,
      occurredAt: true,
      rawPayload: true,
    },
    orderBy: { occurredAt: "asc" },
    ...(opts.limit ? { take: opts.limit } : {}),
  });

  const input: FillInput[] = fills.map((f) => ({
    id: f.id,
    externalTradeId: f.externalTradeId,
    contractId: f.contractId,
    side: f.side,
    quantity: f.quantity != null ? f.quantity.toString() : null,
    price: f.price != null ? f.price.toString() : null,
    pnl: f.pnl != null ? f.pnl.toString() : null,
    occurredAt: f.occurredAt,
    rawPayload: f.rawPayload,
  }));

  const trades = reconstructRoundTrips(input);
  // Newest first for display.
  return trades.sort((a, b) => b.closedAt.getTime() - a.closedAt.getTime());
}
