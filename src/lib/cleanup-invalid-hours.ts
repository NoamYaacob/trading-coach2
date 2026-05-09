/**
 * Cleanup helper: nulls out CME hour columns that contain values outside the
 * valid 0–23 range. Such values can arrive from old clients, manual DB edits,
 * or bugs in earlier form parsing (e.g. allowedEndHour = 123 from
 * noam — 1868411).
 *
 * Pure logic is exported for unit tests; the Prisma wrapper is exported for
 * use in scripts and API routes.
 *
 * Valid CME hour range: 0–23 (inclusive). null is always valid.
 */

/** Returns true when the value is outside the valid CME hour range. */
export function isInvalidCmeHour(v: number | null): boolean {
  if (v === null) return false;
  return !Number.isInteger(v) || v < 0 || v > 23;
}

export type InvalidHourRow = {
  table: "RiskRules" | "AccountRiskRules";
  id: string;
  column: string;
  value: number;
};

export type CleanupHoursResult = {
  found: InvalidHourRow[];
  clearedCount: number;
};

/**
 * Minimal structural type for the Prisma client. Avoids importing the full
 * client type, which pulls in 200+ method signatures.
 */
export type CleanupPrisma = {
  riskRules: {
    findMany: (args: {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
    }) => Promise<{ userId: string; sessionStartHour: number | null; sessionEndHour: number | null }[]>;
    update: (args: {
      where: { userId: string };
      data: Record<string, unknown>;
    }) => Promise<unknown>;
  };
  accountRiskRules: {
    findMany: (args: {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
    }) => Promise<{ accountId: string; allowedStartHour: number | null; allowedEndHour: number | null }[]>;
    update: (args: {
      where: { accountId: string };
      data: Record<string, unknown>;
    }) => Promise<unknown>;
  };
};

/**
 * Scan both RiskRules and AccountRiskRules for hour columns outside 0–23.
 * For each invalid row, null the column and accumulate a report.
 */
export async function cleanupInvalidHours(
  prisma: CleanupPrisma,
): Promise<CleanupHoursResult> {
  const found: InvalidHourRow[] = [];
  let clearedCount = 0;

  // ── RiskRules ──────────────────────────────────────────────────────────────
  const defaultRows = await prisma.riskRules.findMany({
    where: {
      OR: [
        { sessionStartHour: { not: null } },
        { sessionEndHour: { not: null } },
      ],
    },
    select: { userId: true, sessionStartHour: true, sessionEndHour: true },
  });

  for (const row of defaultRows) {
    const updates: Record<string, null> = {};
    if (isInvalidCmeHour(row.sessionStartHour)) {
      found.push({ table: "RiskRules", id: row.userId, column: "sessionStartHour", value: row.sessionStartHour! });
      updates.sessionStartHour = null;
    }
    if (isInvalidCmeHour(row.sessionEndHour)) {
      found.push({ table: "RiskRules", id: row.userId, column: "sessionEndHour", value: row.sessionEndHour! });
      updates.sessionEndHour = null;
    }
    if (Object.keys(updates).length > 0) {
      await prisma.riskRules.update({ where: { userId: row.userId }, data: updates });
      clearedCount += Object.keys(updates).length;
    }
  }

  // ── AccountRiskRules ───────────────────────────────────────────────────────
  const accountRows = await prisma.accountRiskRules.findMany({
    where: {
      OR: [
        { allowedStartHour: { not: null } },
        { allowedEndHour: { not: null } },
      ],
    },
    select: { accountId: true, allowedStartHour: true, allowedEndHour: true },
  });

  for (const row of accountRows) {
    const updates: Record<string, null> = {};
    if (isInvalidCmeHour(row.allowedStartHour)) {
      found.push({ table: "AccountRiskRules", id: row.accountId, column: "allowedStartHour", value: row.allowedStartHour! });
      updates.allowedStartHour = null;
    }
    if (isInvalidCmeHour(row.allowedEndHour)) {
      found.push({ table: "AccountRiskRules", id: row.accountId, column: "allowedEndHour", value: row.allowedEndHour! });
      updates.allowedEndHour = null;
    }
    if (Object.keys(updates).length > 0) {
      await prisma.accountRiskRules.update({ where: { accountId: row.accountId }, data: updates });
      clearedCount += Object.keys(updates).length;
    }
  }

  return { found, clearedCount };
}
