import type { PrismaClient } from "@prisma/client";
import type { TradovateClient } from "../brokers/tradovate-client.ts";

export type BackfillResult = {
  updated: number;
  skipped: number;
  total: number;
};

/**
 * Backfills rawPayload.commission for existing NormalizedTradeEvent rows that
 * were ingested before fee data was captured. Matches by externalTradeId =
 * String(fillId) from fillFee/list. Idempotent: skips rows whose commission
 * value already matches. Never creates new rows.
 */
export async function backfillFillFees(
  accountId: string,
  client: TradovateClient,
  prisma: PrismaClient,
  options: { dryRun: boolean } = { dryRun: true },
): Promise<BackfillResult> {
  const feeByFillId = await client.getFillFeesByFillId();

  if (feeByFillId.size === 0) {
    return { updated: 0, skipped: 0, total: 0 };
  }

  const fillIds = Array.from(feeByFillId.keys()).map(String);

  const rows = await prisma.normalizedTradeEvent.findMany({
    where: {
      accountId,
      externalTradeId: { in: fillIds },
    },
    select: {
      id: true,
      externalTradeId: true,
      rawPayload: true,
    },
  });

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const fillId = Number(row.externalTradeId);
    const fee = feeByFillId.get(fillId);
    if (fee == null) {
      skipped++;
      continue;
    }

    const existing = row.rawPayload as Record<string, unknown> | null;
    if (existing?.commission === fee) {
      skipped++;
      continue;
    }

    if (!options.dryRun) {
      await prisma.normalizedTradeEvent.update({
        where: { id: row.id },
        data: {
          rawPayload: {
            ...(existing ?? {}),
            commission: fee,
          },
        },
      });
    }

    updated++;
  }

  return { updated, skipped, total: rows.length };
}
