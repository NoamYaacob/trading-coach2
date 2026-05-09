/**
 * One-off cleanup: null out RiskRules.sessionEndHour / sessionStartHour and
 * AccountRiskRules.allowedEndHour / allowedStartHour values outside 0–23.
 *
 * Confirmed production case: noam — 1868411 has allowedEndHour = 123.
 *
 * Run with:
 *   npx tsx scripts/cleanup-invalid-hours.ts
 */

import { prisma } from "../src/lib/db.ts";
import { cleanupInvalidHours } from "../src/lib/cleanup-invalid-hours.ts";

const result = await cleanupInvalidHours(
  prisma as unknown as Parameters<typeof cleanupInvalidHours>[0],
);

if (result.found.length === 0) {
  console.log("[cleanup-invalid-hours] No invalid hour values found — nothing to do.");
} else {
  console.log(`[cleanup-invalid-hours] Found and cleared ${result.clearedCount} invalid hour value(s):`);
  for (const row of result.found) {
    console.log(`  ${row.table} id=${row.id} ${row.column}=${row.value} → null`);
  }
}
