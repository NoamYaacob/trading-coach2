/**
 * Server-side pending-rule promoter.
 *
 * Pending rule changes saved during a locked window live in
 * `pendingPayloadJson` + `pendingEffectiveDate` on RiskRules (default
 * template) and AccountRiskRules (account override). They were dormant
 * until this module existed: a save during the next unlocked window
 * would silently overwrite both the active values AND the pending
 * payload, losing the user's intent.
 *
 * This module:
 *   1. Decides per-row whether to skip / promote / delete-override using
 *      a pure function (`decidePendingPromotion`) that takes the row and
 *      the current CME trading-day key.
 *   2. Applies the decision via Prisma (`promotePendingRules`), per-row
 *      so a failure on one row never blocks others.
 *
 * Design notes:
 *   - Date keys use `deriveCmeTradingDayKey()` so eligibility is anchored
 *     to America/Chicago (CME), not UTC or local time. The CME trading
 *     day rolls at 17:00 CT — promotion fires after that boundary.
 *   - Account A's promotion is scoped by `where: { accountId }`; default
 *     template promotion is scoped by `where: { userId }`. Cross-account
 *     and template-vs-override pollution is impossible at the query level.
 *   - `{ __delete: true }` on an account row removes the override — the
 *     account falls back to the default template at the next read.
 *   - Idempotent: each successful promotion clears `pendingPayloadJson`
 *     to `Prisma.JsonNull` so the next run sees `no_pending` and skips.
 *   - This module never calls Tradovate. It is a Guardrail-internal DB
 *     activation step. Broker risk-settings writes still happen only
 *     on breach, in the existing enforcement code.
 */

import { Prisma } from "@prisma/client";

import { deriveCmeTradingDayKey } from "./trading-day.ts";

// ─── Pure decision logic ──────────────────────────────────────────────────────

export type PromotionDecision =
  | { kind: "skip"; reason: "no_pending" | "future" | "invalid_payload" | "invalid_date" }
  | { kind: "delete_override" }
  | { kind: "promote"; updates: Record<string, unknown> };

/** Date columns stored as ISO strings inside pendingPayloadJson (because JSON
 *  can't hold a Date) that must be hydrated back to Date instances before
 *  Prisma will accept them as a DateTime column update. */
const DATE_FIELDS = new Set(["automatedActionsConsentAt"]);

/** Keys that must never appear in the active-update payload — they are the
 *  pending control columns, included here as a defensive strip in case a
 *  future writer accidentally serialises them into the JSON blob. */
const PENDING_CONTROL_KEYS = new Set(["pendingPayloadJson", "pendingEffectiveDate"]);

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Decide what to do with a pending rule row given today's CME trading-day key.
 * Pure: no I/O, no clock, no Prisma. Safe to unit-test directly.
 */
export function decidePendingPromotion(
  row: { pendingPayloadJson: unknown; pendingEffectiveDate: string | null },
  currentCmeDayKey: string,
): PromotionDecision {
  const payload = row.pendingPayloadJson;
  const effectiveDate = row.pendingEffectiveDate;

  if (payload === null || payload === undefined || effectiveDate === null) {
    return { kind: "skip", reason: "no_pending" };
  }
  if (typeof effectiveDate !== "string" || !YYYY_MM_DD.test(effectiveDate)) {
    return { kind: "skip", reason: "invalid_date" };
  }
  // Lexicographic compare of YYYY-MM-DD strings is correct.
  if (currentCmeDayKey < effectiveDate) {
    return { kind: "skip", reason: "future" };
  }

  if (typeof payload !== "object" || Array.isArray(payload)) {
    return { kind: "skip", reason: "invalid_payload" };
  }

  // The "remove account override" sentinel — only meaningful for account rows.
  // Default-template rows should never carry it (the form has no delete path).
  if ((payload as { __delete?: unknown }).__delete === true) {
    return { kind: "delete_override" };
  }

  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (PENDING_CONTROL_KEYS.has(k)) continue;
    if (DATE_FIELDS.has(k) && typeof v === "string") {
      // ISO string back to Date for Prisma DateTime columns.
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) {
        updates[k] = d;
      }
      continue;
    }
    updates[k] = v;
  }
  return { kind: "promote", updates };
}

// ─── Prisma wrapper ───────────────────────────────────────────────────────────

export type PromotionError = {
  kind: "default" | "account";
  /** userId for default rows, accountId for account rows. */
  id: string;
  message: string;
};

export type PromotionSummary = {
  promotedDefaultCount: number;
  promotedAccountCount: number;
  skippedCount: number;
  failedCount: number;
  errors: PromotionError[];
};

/**
 * Minimal structural type the promoter needs from a Prisma client. We don't
 * use `Pick<PrismaClient, ...>` because the full delegate types include 16+
 * methods we never call, which makes mocking in tests painful for no real
 * type-safety gain. The shape below is exactly what this module touches.
 */
export type PromoterPrisma = {
  accountRiskRules: {
    findMany: (args: {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
    }) => Promise<
      { accountId: string; pendingPayloadJson: unknown; pendingEffectiveDate: string | null }[]
    >;
    update: (args: {
      where: { accountId: string };
      data: Record<string, unknown>;
    }) => Promise<unknown>;
    delete: (args: { where: { accountId: string } }) => Promise<unknown>;
  };
  riskRules: {
    findMany: (args: {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
    }) => Promise<
      { userId: string; pendingPayloadJson: unknown; pendingEffectiveDate: string | null }[]
    >;
    update: (args: {
      where: { userId: string };
      data: Record<string, unknown>;
    }) => Promise<unknown>;
  };
};

/**
 * Find pending rule rows whose effective date has been reached and apply them.
 * Per-row error handling: a failure on one row does NOT clear that row's
 * pending payload, so the next cron tick will retry it.
 *
 * Returns a JSON-friendly summary suitable for the cron route response and
 * for ops dashboards.
 */
export async function promotePendingRules(
  prisma: PromoterPrisma,
  now: Date = new Date(),
): Promise<PromotionSummary> {
  const cmeKey = deriveCmeTradingDayKey(now);
  const summary: PromotionSummary = {
    promotedDefaultCount: 0,
    promotedAccountCount: 0,
    skippedCount: 0,
    failedCount: 0,
    errors: [],
  };

  // ─── Account overrides ─────────────────────────────────────────────────────
  const accountRows = await prisma.accountRiskRules.findMany({
    where: {
      NOT: { pendingPayloadJson: { equals: Prisma.JsonNull } },
      pendingEffectiveDate: { not: null },
    },
    select: {
      accountId: true,
      pendingPayloadJson: true,
      pendingEffectiveDate: true,
    },
  });

  for (const row of accountRows) {
    const decision = decidePendingPromotion(row, cmeKey);
    if (decision.kind === "skip") {
      summary.skippedCount += 1;
      continue;
    }
    try {
      if (decision.kind === "delete_override") {
        await prisma.accountRiskRules.delete({ where: { accountId: row.accountId } });
      } else {
        await prisma.accountRiskRules.update({
          where: { accountId: row.accountId },
          data: {
            ...decision.updates,
            pendingPayloadJson: Prisma.JsonNull,
            pendingEffectiveDate: null,
          },
        });
      }
      summary.promotedAccountCount += 1;
      console.info("[promote-pending] account row promoted", {
        accountId: row.accountId,
        kind: decision.kind,
        cmeKey,
        effectiveDate: row.pendingEffectiveDate,
      });
    } catch (err) {
      summary.failedCount += 1;
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ kind: "account", id: row.accountId, message });
      console.error("[promote-pending] account row failed", {
        accountId: row.accountId,
        cmeKey,
        message,
      });
    }
  }

  // ─── Default template ──────────────────────────────────────────────────────
  const defaultRows = await prisma.riskRules.findMany({
    where: {
      NOT: { pendingPayloadJson: { equals: Prisma.JsonNull } },
      pendingEffectiveDate: { not: null },
    },
    select: {
      userId: true,
      pendingPayloadJson: true,
      pendingEffectiveDate: true,
    },
  });

  for (const row of defaultRows) {
    const decision = decidePendingPromotion(row, cmeKey);
    if (decision.kind === "skip") {
      summary.skippedCount += 1;
      continue;
    }
    if (decision.kind === "delete_override") {
      // The default template has no delete path. Leave pending intact rather
      // than wipe it; this is a safety net for an unexpected payload shape.
      summary.skippedCount += 1;
      console.warn("[promote-pending] default row carries __delete payload; skipping", {
        userId: row.userId,
      });
      continue;
    }
    try {
      await prisma.riskRules.update({
        where: { userId: row.userId },
        data: {
          ...decision.updates,
          pendingPayloadJson: Prisma.JsonNull,
          pendingEffectiveDate: null,
        },
      });
      summary.promotedDefaultCount += 1;
      console.info("[promote-pending] default row promoted", {
        userId: row.userId,
        cmeKey,
        effectiveDate: row.pendingEffectiveDate,
      });
    } catch (err) {
      summary.failedCount += 1;
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ kind: "default", id: row.userId, message });
      console.error("[promote-pending] default row failed", {
        userId: row.userId,
        cmeKey,
        message,
      });
    }
  }

  return summary;
}
