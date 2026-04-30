import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

export type JournalPayload = {
  symbol?: string;
  direction?: string;
  tradedAt?: string;
  entryPrice?: number | null;
  exitPrice?: number | null;
  stopPrice?: number | null;
  targetPrice?: number | null;
  quantity?: number | null;
  pnl?: number | null;
  fees?: number | null;
  grossPnl?: number | null;
  pnlSource?: string | null;
  riskAmount?: number | null;
  rMultiple?: number | null;
  strategy?: string | null;
  notes?: string | null;
  ruleBreached?: boolean;
  breachReason?: string | null;
};

export const ALLOWED_DIRECTIONS = new Set(["LONG", "SHORT"]);
export const VALID_PNL_SOURCES = new Set(["calculated", "manual", "override"]);

export const MAX_SYMBOL_LEN = 32;
export const MAX_STRATEGY_LEN = 64;
export const MAX_NOTES_LEN = 4000;
export const MAX_BREACH_REASON_LEN = 500;

export function toDecimal(v: number | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return Number.isFinite(v) ? v.toString() : null;
}

export function nullableString(
  v: string | null | undefined,
  maxLen: number,
): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.slice(0, maxLen);
}

export function validateAndExtractDates(tradedAt: string | undefined): {
  tradedAt?: Date;
  error?: string;
} {
  if (!tradedAt) return { error: "Trade date/time is required." };
  const d = new Date(tradedAt);
  if (Number.isNaN(d.getTime())) return { error: "Invalid trade date/time." };
  const now = Date.now();
  const fiveYearsMs = 5 * 365 * 24 * 60 * 60 * 1000;
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (d.getTime() > now + oneDayMs || d.getTime() < now - fiveYearsMs) {
    return { error: "Trade date/time is outside the allowed range." };
  }
  return { tradedAt: d };
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const journalLimit = checkRateLimit(`journal:${user.id}`, 60, 60_000);
  if (!journalLimit.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "Retry-After": String(journalLimit.retryAfterSeconds) } },
    );
  }

  let body: JournalPayload;
  try {
    body = (await request.json()) as JournalPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Required fields
  const symbolRaw = body.symbol?.trim();
  if (!symbolRaw) {
    return NextResponse.json({ error: "Symbol is required." }, { status: 400 });
  }
  if (symbolRaw.length > MAX_SYMBOL_LEN) {
    return NextResponse.json(
      { error: `Symbol must be ${MAX_SYMBOL_LEN} characters or fewer.` },
      { status: 400 },
    );
  }
  const symbol = symbolRaw;

  const direction = body.direction?.toUpperCase();
  if (!direction || !ALLOWED_DIRECTIONS.has(direction)) {
    return NextResponse.json(
      { error: "Direction must be LONG or SHORT." },
      { status: 400 },
    );
  }

  const dateResult = validateAndExtractDates(body.tradedAt);
  if (dateResult.error) {
    return NextResponse.json({ error: dateResult.error }, { status: 400 });
  }
  const tradedAt = dateResult.tradedAt!;

  if (body.pnlSource != null && !VALID_PNL_SOURCES.has(body.pnlSource)) {
    return NextResponse.json({ error: "Invalid pnlSource." }, { status: 400 });
  }

  // Numeric validation: any provided numeric must be finite.
  const numericFields = [
    "entryPrice",
    "exitPrice",
    "stopPrice",
    "targetPrice",
    "quantity",
    "pnl",
    "fees",
    "grossPnl",
    "riskAmount",
    "rMultiple",
  ] as const;

  for (const f of numericFields) {
    const v = body[f];
    if (v !== undefined && v !== null && !Number.isFinite(v)) {
      return NextResponse.json({ error: `Invalid number for ${f}.` }, { status: 400 });
    }
  }

  if (body.quantity !== undefined && body.quantity !== null && body.quantity < 0) {
    return NextResponse.json({ error: "Quantity cannot be negative." }, { status: 400 });
  }
  if (body.riskAmount !== undefined && body.riskAmount !== null && body.riskAmount < 0) {
    return NextResponse.json({ error: "Risk amount cannot be negative." }, { status: 400 });
  }
  if (body.fees !== undefined && body.fees !== null && body.fees < 0) {
    return NextResponse.json({ error: "Fees cannot be negative." }, { status: 400 });
  }

  try {
    const created = await prisma.manualTradeEntry.create({
      data: {
        userId: user.id,
        symbol,
        direction,
        tradedAt,
        entryPrice: toDecimal(body.entryPrice),
        exitPrice: toDecimal(body.exitPrice),
        stopPrice: toDecimal(body.stopPrice),
        targetPrice: toDecimal(body.targetPrice),
        quantity: toDecimal(body.quantity),
        pnl: toDecimal(body.pnl),
        fees: toDecimal(body.fees),
        grossPnl: toDecimal(body.grossPnl),
        pnlSource: nullableString(body.pnlSource, 16),
        riskAmount: toDecimal(body.riskAmount),
        rMultiple: toDecimal(body.rMultiple),
        strategy: nullableString(body.strategy, MAX_STRATEGY_LEN),
        notes: nullableString(body.notes, MAX_NOTES_LEN),
        ruleBreached: body.ruleBreached ?? false,
        breachReason: nullableString(body.breachReason, MAX_BREACH_REASON_LEN),
      },
      select: { id: true },
    });

    return NextResponse.json({ ok: true, id: created.id });
  } catch (err) {
    console.error("[journal] save error:", err);
    return NextResponse.json({ error: "Failed to save trade." }, { status: 500 });
  }
}
