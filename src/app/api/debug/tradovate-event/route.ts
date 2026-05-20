/**
 * POST /api/debug/tradovate-event
 *
 * Admin-only synthetic fill injection for live-market validation testing.
 * Simulates exactly what the real Tradovate webhook does — normalise, persist,
 * update session state, run rule evaluation — without calling Tradovate.
 *
 * Safety gates (ALL must pass or the request is rejected):
 *   1. DEBUG_TRADOVATE_EVENT_INJECTION_ENABLED=true env var must be set.
 *      The endpoint returns 404 in production unless this flag is explicitly set.
 *   2. Authenticated user session required.
 *   3. Caller must be an admin email (isAdminEmail check).
 *   4. externalAccountId must be in DEBUG_EVENT_INJECTION_ACCOUNT_ALLOWLIST
 *      (comma-separated list of allowed externalAccountIds).
 *      If the allowlist env var is absent, injection is blocked entirely.
 *   5. NODE_ENV === "production" is an additional hard block even with the flag.
 *      Production deployments should never set this flag.
 *
 * What this endpoint does NOT do:
 *   - Does NOT call any Tradovate API endpoint.
 *   - Does NOT place, cancel, or flatten orders.
 *   - Does NOT write broker risk settings.
 *   - Does NOT trigger Phase 2C (broker enforcement).
 *   - Does NOT send Telegram messages.
 *
 * Injected events are tagged with _debugInjection metadata in rawPayload so
 * they can be identified and filtered in queries.
 *
 * Dedup: uses upsert (skipDuplicates) on the unique(accountId, eventType,
 * externalTradeId) constraint — submitting the same externalTradeId twice
 * is a no-op for the NormalizedTradeEvent row.
 */

import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/subscription";
import { prisma } from "@/lib/db";
import { normalizeFill, normalizeOrder, normalizeAccountSummary } from "@/lib/tradovate/adapter";
import type { TradovateOrderFill, TradovateOrder, TradovateAccountSummary } from "@/lib/tradovate/types";
import {
  getOrCreateSessionState,
  applyTradeClose,
  applyTradeOpen,
} from "@/lib/guardian-engine/session-state";
import { detectIntervention } from "@/lib/guardian-engine/detector";
import type { AccountRules, NormalizedEvent } from "@/lib/guardian-engine/types";

type DebugTradovateEventRequest = {
  email: string;
  externalAccountId: string;
  type: "fill" | "order" | "account_summary";
  data: TradovateOrderFill | TradovateOrder | TradovateAccountSummary;
};

function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export async function POST(request: Request) {
  // Gate 1: feature flag must be explicitly enabled.
  if (process.env.DEBUG_TRADOVATE_EVENT_INJECTION_ENABLED !== "true") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Gate 2: hard block in production regardless of flag.
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Gate 3: authenticated session required.
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Gate 4: admin-only.
  if (!isAdminEmail(currentUser.email)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Gate 5: account allowlist — injection_account_allowlist must be configured
  // and the requested externalAccountId must be in it.
  const allowlist = parseAllowlist(process.env.DEBUG_EVENT_INJECTION_ACCOUNT_ALLOWLIST);
  if (allowlist.length === 0) {
    return NextResponse.json(
      {
        error: "forbidden",
        message:
          "DEBUG_EVENT_INJECTION_ACCOUNT_ALLOWLIST is not configured. " +
          "Set it to a comma-separated list of allowed externalAccountIds.",
      },
      { status: 403 },
    );
  }

  const body = (await request.json()) as DebugTradovateEventRequest;

  if (!body.email || !body.externalAccountId || !body.type || !body.data) {
    return NextResponse.json(
      { error: "email, externalAccountId, type, and data are required" },
      { status: 400 },
    );
  }

  const externalAccountId = String(body.externalAccountId).trim();
  if (!allowlist.includes(externalAccountId)) {
    return NextResponse.json(
      {
        error: "forbidden",
        message: `externalAccountId '${externalAccountId}' is not in DEBUG_EVENT_INJECTION_ACCOUNT_ALLOWLIST.`,
      },
      { status: 403 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { email: body.email.trim().toLowerCase() },
    select: { id: true, email: true },
  });

  if (!user) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const account = await prisma.connectedAccount.findFirst({
    where: {
      userId: user.id,
      externalAccountId,
      platform: "tradovate",
      isActive: true,
    },
    include: { riskRules: true },
  });

  if (!account) {
    return NextResponse.json({ error: "account not found" }, { status: 404 });
  }

  let normalizedEvent: NormalizedEvent | null = null;
  if (body.type === "fill") {
    normalizedEvent = normalizeFill(account.id, body.data as TradovateOrderFill);
  } else if (body.type === "order") {
    normalizedEvent = normalizeOrder(account.id, body.data as TradovateOrder);
  } else if (body.type === "account_summary") {
    normalizedEvent = normalizeAccountSummary(account.id, body.data as TradovateAccountSummary);
  }

  if (!normalizedEvent) {
    return NextResponse.json({ error: "unhandled event type" }, { status: 400 });
  }

  // Tag rawPayload with debug injection metadata so these rows can be
  // identified and excluded from production analytics queries.
  const debugTag = {
    _debugInjection: {
      source: "debug_event_endpoint",
      injectedByAdminEmail: currentUser.email,
      injectedAt: new Date().toISOString(),
      synthetic: true,
    },
  };
  const taggedPayload =
    normalizedEvent.rawPayload != null && typeof normalizedEvent.rawPayload === "object"
      ? { ...(normalizedEvent.rawPayload as object), ...debugTag }
      : debugTag;

  // Persist using createMany+skipDuplicates so a repeated externalTradeId is
  // a silent no-op (honours the unique(accountId, eventType, externalTradeId) constraint).
  const eventData = {
    accountId: account.id,
    eventType: normalizedEvent.eventType,
    externalTradeId: normalizedEvent.externalTradeId ?? null,
    side: normalizedEvent.side ?? null,
    quantity: normalizedEvent.quantity != null ? String(normalizedEvent.quantity) : null,
    price: normalizedEvent.price != null ? String(normalizedEvent.price) : null,
    pnl: normalizedEvent.pnl != null ? String(normalizedEvent.pnl) : null,
    rawPayload: taggedPayload,
    occurredAt: normalizedEvent.occurredAt,
  };

  const { count: insertedCount } = await prisma.normalizedTradeEvent.createMany({
    data: [eventData],
    skipDuplicates: true,
  });
  const isDuplicate = insertedCount === 0;

  const isTradeClose = (t: string) =>
    t === "trade_closed" || t === "trade_closed_win" || t === "trade_closed_loss";

  const stateBefore = await getOrCreateSessionState(account.id);

  let stateAfter = stateBefore;
  if (!isDuplicate) {
    if (isTradeClose(normalizedEvent.eventType) && normalizedEvent.pnl != null) {
      stateAfter = await applyTradeClose(account.id, normalizedEvent.pnl, normalizedEvent.occurredAt);
    } else if (normalizedEvent.eventType === "trade_opened") {
      stateAfter = await applyTradeOpen(account.id, normalizedEvent.occurredAt);
    }
  }

  const prevEvent = await prisma.normalizedTradeEvent.findFirst({
    where: {
      accountId: account.id,
      eventType: { in: ["trade_closed", "trade_closed_win", "trade_closed_loss"] },
    },
    orderBy: { occurredAt: "desc" },
    skip: isTradeClose(normalizedEvent.eventType) ? 1 : 0,
  });

  const rules: AccountRules = {
    maxDailyLoss:
      account.riskRules?.maxDailyLoss != null ? Number(account.riskRules.maxDailyLoss) : null,
    riskPerTrade:
      account.riskRules?.riskPerTrade != null ? Number(account.riskRules.riskPerTrade) : null,
    maxTradesPerDay: account.riskRules?.maxTradesPerDay ?? null,
    stopAfterLosses: account.riskRules?.stopAfterLosses ?? null,
    allowedStartHour: account.riskRules?.allowedStartHour ?? null,
    allowedEndHour: account.riskRules?.allowedEndHour ?? null,
  };

  const outcome = detectIntervention(normalizedEvent, stateAfter, rules, {
    previousTradeAt: prevEvent?.occurredAt ?? null,
    previousTradePnl: prevEvent?.pnl != null ? Number(prevEvent.pnl) : null,
    previousTradeQty: prevEvent?.quantity != null ? Number(prevEvent.quantity) : null,
  });

  let intervention = null;
  if (!isDuplicate && outcome.action !== "no_action") {
    intervention = await prisma.guardianIntervention.create({
      data: {
        accountId: account.id,
        userId: user.id,
        triggerType: outcome.trigger,
        outcome: outcome.action,
        message: "message" in outcome ? outcome.message : null,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    synthetic: true,
    isDuplicate,
    injectedBy: currentUser.email,
    account: {
      id: account.id,
      label: account.label,
      externalAccountId: account.externalAccountId,
    },
    normalizedEvent: {
      eventType: normalizedEvent.eventType,
      side: normalizedEvent.side,
      quantity: normalizedEvent.quantity,
      price: normalizedEvent.price,
      pnl: normalizedEvent.pnl,
      occurredAt: normalizedEvent.occurredAt,
    },
    stateBefore: {
      riskState: stateBefore.riskState,
      dailyPnl: Number(stateBefore.dailyPnl),
      tradesCount: stateBefore.tradesCount,
      consecutiveLosses: stateBefore.consecutiveLosses,
      cooldownActive: stateBefore.cooldownActive,
    },
    stateAfter: {
      riskState: stateAfter.riskState,
      dailyPnl: Number(stateAfter.dailyPnl),
      tradesCount: stateAfter.tradesCount,
      consecutiveLosses: stateAfter.consecutiveLosses,
      cooldownActive: stateAfter.cooldownActive,
    },
    rules,
    outcome,
    intervention:
      intervention != null
        ? {
            id: intervention.id,
            triggerType: intervention.triggerType,
            outcome: intervention.outcome,
          }
        : null,
    note: "SYNTHETIC EVENT — no Tradovate API calls made. Telegram not sent. Events tagged _debugInjection in rawPayload.",
  });
}
