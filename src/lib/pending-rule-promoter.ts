/**
 * Server-side pending-rule promoter.
 *
 * Pending rule changes saved during a locked window live in
 * `pendingPayloadJson` + `pendingEffectiveDate` on RiskRules (default
 * template) and AccountRiskRules (account override).
 *
 * Two layers:
 *   1. `decidePendingPromotion(row)` — pure: validates the payload shape and
 *      returns one of skip / delete_override / promote. No calendar gate, no
 *      Prisma. Easy to unit-test.
 *   2. `promotePendingRules(prisma, now)` — wraps the decision with a
 *      per-scope SAFETY gate via `canActivateRulesNow`:
 *        * Account scope: only promote when the specific account is safe
 *          (CME maintenance / weekend close / market closed / account locked).
 *        * Default scope: only promote when no inheriting account is active.
 *      A row that's eligible-by-payload but not-safe-yet is skipped (logged)
 *      and retried on the next cron tick.
 *
 * Design notes:
 *   - Safety, not calendar, drives activation. The previous version gated on
 *     `pendingEffectiveDate` only — that promoted too early during active
 *     trading sessions. We still surface `pendingEffectiveDate` in skip logs
 *     for visibility.
 *   - Account A's promotion is scoped by `where: { accountId }`; default
 *     template promotion is scoped by `where: { userId }`. Cross-account and
 *     template-vs-override pollution is impossible at the query level.
 *   - `{ __delete: true }` on an account row removes the override — the
 *     account falls back to the default template at the next read.
 *   - Idempotent: each successful promotion clears `pendingPayloadJson` to
 *     `Prisma.JsonNull` so the next run sees `no_pending` and skips.
 *   - This module never calls Tradovate. It is a Guardrail-internal DB
 *     activation step. Broker risk-settings writes still happen only on
 *     breach, in the existing enforcement code.
 */

import { Prisma } from "@prisma/client";

import { canActivateRulesNow } from "./rule-activation-window.ts";

// ─── Pure decision logic (payload shape only) ─────────────────────────────────

export type PromotionDecision =
  | { kind: "skip"; reason: "no_pending" | "invalid_payload" | "invalid_date" }
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
 * Validate the row's pending payload and return the action to take.
 * The actual eligibility-to-activate-now decision lives in the wrapper:
 * this function only checks that the payload is structurally valid.
 */
export function decidePendingPromotion(row: {
  pendingPayloadJson: unknown;
  pendingEffectiveDate: string | null;
}): PromotionDecision {
  const payload = row.pendingPayloadJson;
  const effectiveDate = row.pendingEffectiveDate;

  if (payload === null || payload === undefined || effectiveDate === null) {
    return { kind: "skip", reason: "no_pending" };
  }
  if (typeof effectiveDate !== "string" || !YYYY_MM_DD.test(effectiveDate)) {
    return { kind: "skip", reason: "invalid_date" };
  }
  if (typeof payload !== "object" || Array.isArray(payload)) {
    return { kind: "skip", reason: "invalid_payload" };
  }

  // The "remove account override" sentinel — only meaningful for account rows.
  // Default-template rows should never carry it (the form has no delete path);
  // the wrapper handles that case explicitly.
  if ((payload as { __delete?: unknown }).__delete === true) {
    return { kind: "delete_override" };
  }

  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (PENDING_CONTROL_KEYS.has(k)) continue;
    if (DATE_FIELDS.has(k) && typeof v === "string") {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) updates[k] = d;
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
  /** Skipped because not yet safe to activate (account active, etc.). */
  skippedNotSafeCount: number;
  /** Skipped because payload was already cleared or malformed. */
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
  liveSessionState: {
    findMany: (args: {
      where: { accountId: { in: string[] } };
      select: Record<string, boolean>;
    }) => Promise<{ accountId: string; riskState: string; cooldownActive: boolean }[]>;
  };
  connectedAccount: {
    findMany: (args: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    }) => Promise<
      { id: string; userId: string; riskRules: { accountId: string } | null }[]
    >;
  };
};

function isAccountLocked(state: { riskState: string; cooldownActive: boolean } | undefined): boolean {
  if (!state) return false;
  return state.riskState === "STOPPED" || state.cooldownActive === true;
}

/**
 * Find pending rule rows that are both eligible-by-payload AND safe-to-activate
 * for their scope, and apply them. Per-row error handling: a failure on one
 * row does NOT clear that row's pending payload, so the next cron tick will
 * retry it.
 */
export async function promotePendingRules(
  prisma: PromoterPrisma,
  now: Date = new Date(),
): Promise<PromotionSummary> {
  const summary: PromotionSummary = {
    promotedDefaultCount: 0,
    promotedAccountCount: 0,
    skippedNotSafeCount: 0,
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

  // Batch-load lockout state for every candidate account so we don't issue
  // one query per row.
  const accountIds = accountRows.map((r) => r.accountId);
  const accountStates =
    accountIds.length > 0
      ? await prisma.liveSessionState.findMany({
          where: { accountId: { in: accountIds } },
          select: { accountId: true, riskState: true, cooldownActive: true },
        })
      : [];
  const accountStateById = new Map(accountStates.map((s) => [s.accountId, s]));

  for (const row of accountRows) {
    const decision = decidePendingPromotion(row);
    if (decision.kind === "skip") {
      summary.skippedCount += 1;
      continue;
    }
    const accountIsLocked = isAccountLocked(accountStateById.get(row.accountId));
    const safety = canActivateRulesNow({
      scope: "account",
      accountIsLocked,
      now,
    });
    if (!safety.canActivate) {
      summary.skippedNotSafeCount += 1;
      console.info("[promote-pending] account row not safe yet; skipping", {
        accountId: row.accountId,
        reason: safety.reason,
        effectiveDate: row.pendingEffectiveDate,
      });
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
        reason: safety.reason,
        effectiveDate: row.pendingEffectiveDate,
      });
    } catch (err) {
      summary.failedCount += 1;
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ kind: "account", id: row.accountId, message });
      console.error("[promote-pending] account row failed", {
        accountId: row.accountId,
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

  // For each user with a pending default-template row, find their inheriting
  // accounts (active accounts with no AccountRiskRules row) and check if any
  // is currently NOT locked. We batch this once per user.
  const defaultUserIds = defaultRows.map((r) => r.userId);
  const inheritingByUser = new Map<string, string[]>();
  if (defaultUserIds.length > 0) {
    const inheritingAccounts = await prisma.connectedAccount.findMany({
      where: { userId: { in: defaultUserIds }, isActive: true, riskRules: { is: null } },
      select: { id: true, userId: true, riskRules: { select: { accountId: true } } },
    });
    for (const a of inheritingAccounts) {
      const list = inheritingByUser.get(a.userId) ?? [];
      list.push(a.id);
      inheritingByUser.set(a.userId, list);
    }
  }
  const allInheritingIds = Array.from(inheritingByUser.values()).flat();
  const inheritingStates =
    allInheritingIds.length > 0
      ? await prisma.liveSessionState.findMany({
          where: { accountId: { in: allInheritingIds } },
          select: { accountId: true, riskState: true, cooldownActive: true },
        })
      : [];
  const inheritingStateById = new Map(inheritingStates.map((s) => [s.accountId, s]));

  for (const row of defaultRows) {
    const decision = decidePendingPromotion(row);
    if (decision.kind === "skip") {
      summary.skippedCount += 1;
      continue;
    }
    if (decision.kind === "delete_override") {
      summary.skippedCount += 1;
      console.warn("[promote-pending] default row carries __delete payload; skipping", {
        userId: row.userId,
      });
      continue;
    }
    const inheriting = inheritingByUser.get(row.userId) ?? [];
    const anyInheritingAccountActive = inheriting.some(
      (id) => !isAccountLocked(inheritingStateById.get(id)),
    );
    const safety = canActivateRulesNow({
      scope: "default",
      anyInheritingAccountActive,
      now,
    });
    if (!safety.canActivate) {
      summary.skippedNotSafeCount += 1;
      console.info("[promote-pending] default row not safe yet; skipping", {
        userId: row.userId,
        reason: safety.reason,
        effectiveDate: row.pendingEffectiveDate,
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
        reason: safety.reason,
        effectiveDate: row.pendingEffectiveDate,
      });
    } catch (err) {
      summary.failedCount += 1;
      const message = err instanceof Error ? err.message : String(err);
      summary.errors.push({ kind: "default", id: row.userId, message });
      console.error("[promote-pending] default row failed", {
        userId: row.userId,
        message,
      });
    }
  }

  return summary;
}
