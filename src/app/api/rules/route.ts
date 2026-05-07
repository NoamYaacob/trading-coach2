import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  deriveRuleEditEligibility,
  buildRuleEditLockMessage,
} from "@/lib/rule-edit-eligibility";
import { AUTOMATED_ACTIONS_CONSENT_VERSION } from "@/lib/brokers/automated-actions-consent";
import { isValidTimeZone } from "@/lib/timezone";

const VALID_SESSION_END_BEHAVIORS = ["flatten_at_session_end", "wait_for_exit_then_lock"] as const;
const VALID_SESSION_PRESETS = ["asia", "london", "ny_am", "ny_pm", "custom"] as const;
const VALID_MULTI_PRESETS = new Set(["asia", "london", "ny_am", "ny_pm"]);
const HH_MM_RE = /^(\d{1,2}):(\d{2})$/;

function isValidHHmm(v: string): boolean {
  const m = v.match(HH_MM_RE);
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

type RulesPayload = {
  accountSize?: number | null;
  maxDailyLoss?: number | null;
  dailyProfitTarget?: number | null;
  maxRiskPerTrade?: number | null;
  maxTradesPerDay?: number | null;
  stopAfterLosses?: number | null;
  maxContracts?: number | null;
  allowedSymbols?: string | null;
  sessionStartHour?: number | null;
  sessionEndHour?: number | null;
  sessionEndBehavior?: string | null;
  tradingDays?: string | null;
  newsLockoutEnabled?: boolean;
  onBreachWarn?: boolean;
  onBreachAppLock?: boolean;
  onBreachCancelOrders?: boolean;
  onBreachFlatten?: boolean;
  /** Minute-precise session window for rule-edit locking. */
  sessionPreset?: string | null;
  sessionStartTime?: string | null;
  sessionEndTime?: string | null;
  sessionTimezone?: string | null;
  ruleEditLockBufferMinutes?: number | null;
  /** Multi-select preset IDs. When set, stored in sessionPresetsJson and takes precedence. */
  selectedSessionPresets?: string[] | null;
  /**
   * When true, the user just confirmed the automated-actions consent
   * checkbox. Server stamps automatedActionsConsentAt = now and the current
   * version constant. Omitted/false leaves prior consent intact (saving
   * other rule fields does not implicitly re-confirm consent).
   */
  automatedActionsConsentChecked?: boolean;
};

function toDecimal(v: number | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return v.toString();
}

function toInt(v: number | null | undefined): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return Math.floor(v);
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rulesLimit = checkRateLimit(`rules:${user.id}`, 30, 60_000);
  if (!rulesLimit.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "Retry-After": String(rulesLimit.retryAfterSeconds) } },
    );
  }

  const body = (await request.json()) as RulesPayload;

  // Numeric bounds — reject NaN/Infinity and absurd magnitudes that
  // would corrupt downstream rendering or storage. The DB schema uses
  // Decimal/Int but does not constrain magnitude on its own.
  const moneyFields = [
    "accountSize",
    "maxDailyLoss",
    "dailyProfitTarget",
    "maxRiskPerTrade",
  ] as const;
  for (const f of moneyFields) {
    const v = body[f];
    if (v != null) {
      if (!Number.isFinite(v)) {
        return NextResponse.json({ error: `Invalid number for ${f}.` }, { status: 400 });
      }
      if (v < 0 || v > 1_000_000_000) {
        return NextResponse.json(
          { error: `${f} must be between 0 and 1,000,000,000.` },
          { status: 400 },
        );
      }
    }
  }
  const intFields = [
    { key: "maxTradesPerDay" as const, max: 10_000 },
    { key: "stopAfterLosses" as const, max: 10_000 },
    { key: "maxContracts" as const, max: 100_000 },
  ];
  for (const { key, max } of intFields) {
    const v = body[key];
    if (v != null) {
      if (!Number.isFinite(v) || v < 0 || v > max) {
        return NextResponse.json(
          { error: `${key} must be between 0 and ${max}.` },
          { status: 400 },
        );
      }
    }
  }
  for (const key of ["sessionStartHour", "sessionEndHour"] as const) {
    const v = body[key];
    if (v != null) {
      if (!Number.isFinite(v) || v < 0 || v > 23) {
        return NextResponse.json(
          { error: `${key} must be between 0 and 23.` },
          { status: 400 },
        );
      }
    }
  }
  if (body.sessionPreset != null && !VALID_SESSION_PRESETS.includes(body.sessionPreset as (typeof VALID_SESSION_PRESETS)[number])) {
    return NextResponse.json(
      { error: "sessionPreset must be 'ny', 'london', 'asia', or 'custom'." },
      { status: 400 },
    );
  }
  for (const key of ["sessionStartTime", "sessionEndTime"] as const) {
    const v = body[key];
    if (v != null) {
      if (typeof v !== "string" || !isValidHHmm(v)) {
        return NextResponse.json(
          { error: `${key} must be a valid time in HH:mm format (e.g. "09:30").` },
          { status: 400 },
        );
      }
    }
  }
  if (body.sessionTimezone != null && !isValidTimeZone(body.sessionTimezone)) {
    return NextResponse.json(
      { error: "sessionTimezone must be a valid IANA timezone (e.g. 'America/New_York')." },
      { status: 400 },
    );
  }
  if (body.ruleEditLockBufferMinutes != null) {
    const v = body.ruleEditLockBufferMinutes;
    if (!Number.isFinite(v) || v < 0 || v > 480) {
      return NextResponse.json(
        { error: "ruleEditLockBufferMinutes must be between 0 and 480." },
        { status: 400 },
      );
    }
  }
  if (body.selectedSessionPresets != null) {
    if (!Array.isArray(body.selectedSessionPresets)) {
      return NextResponse.json(
        { error: "selectedSessionPresets must be an array." },
        { status: 400 },
      );
    }
    for (const id of body.selectedSessionPresets) {
      if (typeof id !== "string" || !VALID_MULTI_PRESETS.has(id)) {
        return NextResponse.json(
          { error: `Invalid session preset: '${id}'. Must be one of: asia, london, ny_am, ny_pm.` },
          { status: 400 },
        );
      }
    }
  }
  if (body.sessionEndBehavior != null && !VALID_SESSION_END_BEHAVIORS.includes(body.sessionEndBehavior as (typeof VALID_SESSION_END_BEHAVIORS)[number])) {
    return NextResponse.json(
      { error: "sessionEndBehavior must be 'flatten_at_session_end' or 'wait_for_exit_then_lock'." },
      { status: 400 },
    );
  }
  if (body.allowedSymbols != null && body.allowedSymbols.length > 1000) {
    return NextResponse.json(
      { error: "allowedSymbols list is too long." },
      { status: 400 },
    );
  }
  if (body.tradingDays != null && body.tradingDays.length > 200) {
    return NextResponse.json(
      { error: "tradingDays value is too long." },
      { status: 400 },
    );
  }

  // Cross-field validation
  if (
    body.maxTradesPerDay != null &&
    body.stopAfterLosses != null &&
    body.stopAfterLosses > body.maxTradesPerDay
  ) {
    return NextResponse.json(
      { error: "Stop-after-losses cannot exceed max trades per day." },
      { status: 400 },
    );
  }
  if (
    body.maxRiskPerTrade != null &&
    body.maxDailyLoss != null &&
    body.maxRiskPerTrade > body.maxDailyLoss
  ) {
    return NextResponse.json(
      { error: "Max risk per trade cannot exceed daily loss limit." },
      { status: 400 },
    );
  }
  // Note: overnight/cross-midnight sessions (end <= start) are valid — no rejection.

  const consentFields = body.automatedActionsConsentChecked
    ? {
        automatedActionsConsentAt: new Date(),
        automatedActionsConsentVersion: AUTOMATED_ACTIONS_CONSENT_VERSION,
      }
    : {};

  const data = {
    accountSize: toDecimal(body.accountSize),
    maxDailyLoss: toDecimal(body.maxDailyLoss),
    dailyProfitTarget: toDecimal(body.dailyProfitTarget),
    maxRiskPerTrade: toDecimal(body.maxRiskPerTrade),
    riskPerTrade: toDecimal(body.maxRiskPerTrade),
    maxTradesPerDay: toInt(body.maxTradesPerDay),
    stopAfterLosses: toInt(body.stopAfterLosses),
    maxContracts: toInt(body.maxContracts),
    allowedSymbols: body.allowedSymbols ?? undefined,
    sessionStartHour: toInt(body.sessionStartHour),
    sessionEndHour: toInt(body.sessionEndHour),
    sessionEndBehavior: body.sessionEndBehavior !== undefined ? (body.sessionEndBehavior ?? null) : undefined,
    tradingDays: body.tradingDays ?? undefined,
    newsLockoutEnabled: body.newsLockoutEnabled,
    onBreachWarn: body.onBreachWarn,
    onBreachAppLock: body.onBreachAppLock,
    onBreachCancelOrders: body.onBreachCancelOrders,
    onBreachFlatten: body.onBreachFlatten,
    sessionPreset: body.sessionPreset !== undefined ? (body.sessionPreset ?? null) : undefined,
    sessionStartTime: body.sessionStartTime !== undefined ? (body.sessionStartTime ?? null) : undefined,
    sessionEndTime: body.sessionEndTime !== undefined ? (body.sessionEndTime ?? null) : undefined,
    sessionTimezone: body.sessionTimezone !== undefined ? (body.sessionTimezone ?? null) : undefined,
    ruleEditLockBufferMinutes: body.ruleEditLockBufferMinutes !== undefined ? (body.ruleEditLockBufferMinutes != null ? Math.floor(body.ruleEditLockBufferMinutes) : null) : undefined,
    sessionPresetsJson: body.selectedSessionPresets !== undefined
      ? (body.selectedSessionPresets != null ? JSON.stringify(body.selectedSessionPresets) : null)
      : undefined,
    ...consentFields,
  };

  // Only pass through defined fields so undefined doesn't overwrite stored values
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) cleaned[k] = v;
  }

  // ── Protection-lock check ─────────────────────────────────────────────
  // After today's cutoff, edits to enforcement-relevant fields are saved as
  // "applies next trading day" instead of being applied live. Display-only
  // fields (none currently in this payload) would bypass the lock.
  const existing = await prisma.riskRules.findUnique({
    where: { userId: user.id },
    select: {
      sessionStartHour: true,
      sessionEndHour: true,
      sessionTimezone: true,
      ruleEditLockBufferMinutes: true,
      sessionStartTime: true,
      sessionEndTime: true,
      sessionPresetsJson: true,
    },
  });

  const [guardianStatus, accountLiveStates] = await Promise.all([
    prisma.guardianStatus.findUnique({
      where: { userId: user.id },
      select: { currentLockoutActive: true },
    }),
    prisma.liveSessionState.findMany({
      where: { account: { userId: user.id } },
      select: { riskState: true, cooldownActive: true },
    }),
  ]);
  const hasProtectionLockToday =
    guardianStatus?.currentLockoutActive === true ||
    accountLiveStates.some((s) => s.riskState === "STOPPED" || s.cooldownActive === true);

  const existingPresets = existing?.sessionPresetsJson
    ? (JSON.parse(existing.sessionPresetsJson) as string[])
    : null;
  const eligibility = deriveRuleEditEligibility({
    selectedSessionPresets: existingPresets,
    hasProtectionLockToday,
    sessionStartHour: existing?.sessionStartHour ?? null,
    sessionEndHour: existing?.sessionEndHour ?? null,
    sessionStartTime: existing?.sessionStartTime ?? null,
    sessionEndTime: existing?.sessionEndTime ?? null,
    sessionTimezone: existing?.sessionTimezone ?? null,
    lockBufferMinutes: existing?.ruleEditLockBufferMinutes ?? null,
  });

  if (!eligibility.canEditNow) {
    // Derive next trading day key for pending payload storage.
    // Use session end date as the effective date, falling back to tomorrow.
    const nextDayKey = eligibility.nextAllowedAt
      ? eligibility.nextAllowedAt.toISOString().slice(0, 10)
      : new Date(Date.now() + 24 * 60 * 60_000).toISOString().slice(0, 10);

    try {
      await prisma.riskRules.upsert({
        where: { userId: user.id },
        // Always have a row so we can store the pending payload, but never
        // apply edited fields while locked.
        create: {
          userId: user.id,
          pendingPayloadJson: cleaned as Prisma.InputJsonValue,
          pendingEffectiveDate: nextDayKey,
        },
        update: {
          pendingPayloadJson: cleaned as Prisma.InputJsonValue,
          pendingEffectiveDate: nextDayKey,
        },
      });
    } catch (err) {
      console.error("[rules] save pending error:", err);
      return NextResponse.json({ error: "Failed to save rules." }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      applied: false,
      reason: eligibility.reason,
      effectiveDate: nextDayKey,
      message: buildRuleEditLockMessage(eligibility, existing?.sessionTimezone ?? null),
    });
  }

  try {
    await prisma.riskRules.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...cleaned },
      update: {
        ...cleaned,
        // Edits while unlocked supersede any earlier pending change.
        pendingPayloadJson: Prisma.JsonNull,
        pendingEffectiveDate: null,
      },
    });

    // Mirror enforcement-relevant fields into GuardianProfile so the live
    // rule engine (which reads GuardianProfile) sees the new values.
    if (
      cleaned.maxTradesPerDay !== undefined ||
      cleaned.maxDailyLoss !== undefined ||
      cleaned.stopAfterLosses !== undefined ||
      cleaned.dailyProfitTarget !== undefined
    ) {
      const guardianUpdate: Record<string, unknown> = {};
      if ("maxTradesPerDay" in cleaned) guardianUpdate.maxTradesPerDay = cleaned.maxTradesPerDay;
      if ("maxDailyLoss" in cleaned) guardianUpdate.maxDailyLoss = cleaned.maxDailyLoss;
      if ("stopAfterLosses" in cleaned) guardianUpdate.stopAfterConsecutiveLosses = cleaned.stopAfterLosses;
      if ("dailyProfitTarget" in cleaned) guardianUpdate.dailyProfitTarget = cleaned.dailyProfitTarget;

      await prisma.guardianProfile.update({
        where: { userId: user.id },
        data: guardianUpdate,
      }).catch(() => {
        // GuardianProfile may not exist yet; rules can still save.
      });
    }
  } catch (err) {
    console.error("[rules] save error:", err);
    return NextResponse.json({ error: "Failed to save rules." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
