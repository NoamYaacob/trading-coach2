import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

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
  tradingDays?: string | null;
  newsLockoutEnabled?: boolean;
  onBreachWarn?: boolean;
  onBreachAppLock?: boolean;
  onBreachCancelOrders?: boolean;
  onBreachFlatten?: boolean;
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
  if (
    body.sessionStartHour != null &&
    body.sessionEndHour != null &&
    body.sessionEndHour <= body.sessionStartHour
  ) {
    return NextResponse.json(
      { error: "Session end hour must be after session start hour." },
      { status: 400 },
    );
  }

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
    tradingDays: body.tradingDays ?? undefined,
    newsLockoutEnabled: body.newsLockoutEnabled,
    onBreachWarn: body.onBreachWarn,
    onBreachAppLock: body.onBreachAppLock,
    onBreachCancelOrders: body.onBreachCancelOrders,
    onBreachFlatten: body.onBreachFlatten,
  };

  // Only pass through defined fields so undefined doesn't overwrite stored values
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) cleaned[k] = v;
  }

  try {
    await prisma.riskRules.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...cleaned },
      update: cleaned,
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
