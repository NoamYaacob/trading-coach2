import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

type JournalPayload = {
  symbol?: string;
  direction?: string;
  tradedAt?: string;
  entryPrice?: number | null;
  exitPrice?: number | null;
  stopPrice?: number | null;
  targetPrice?: number | null;
  quantity?: number | null;
  pnl?: number | null;
  riskAmount?: number | null;
  rMultiple?: number | null;
  strategy?: string | null;
  notes?: string | null;
  ruleBreached?: boolean;
  breachReason?: string | null;
};

const ALLOWED_DIRECTIONS = new Set(["LONG", "SHORT"]);

const MAX_SYMBOL_LEN = 32;
const MAX_STRATEGY_LEN = 64;
const MAX_NOTES_LEN = 4000;
const MAX_BREACH_REASON_LEN = 500;

function toDecimal(v: number | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return Number.isFinite(v) ? v.toString() : null;
}

function nullableString(
  v: string | null | undefined,
  maxLen: number,
): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.slice(0, maxLen);
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

  // tradedAt: required, must be a valid date string within a sane range.
  if (!body.tradedAt) {
    return NextResponse.json({ error: "Trade date/time is required." }, { status: 400 });
  }
  const tradedAt = new Date(body.tradedAt);
  if (Number.isNaN(tradedAt.getTime())) {
    return NextResponse.json({ error: "Invalid trade date/time." }, { status: 400 });
  }
  // Reject obviously bogus dates — anything more than 24h in the future
  // or more than 5 years in the past is a sign of bad input.
  const now = Date.now();
  const fiveYearsMs = 5 * 365 * 24 * 60 * 60 * 1000;
  const oneDayMs = 24 * 60 * 60 * 1000;
  if (tradedAt.getTime() > now + oneDayMs || tradedAt.getTime() < now - fiveYearsMs) {
    return NextResponse.json(
      { error: "Trade date/time is outside the allowed range." },
      { status: 400 },
    );
  }

  // Numeric validation: any provided numeric must be finite.
  const numericFields = [
    "entryPrice",
    "exitPrice",
    "stopPrice",
    "targetPrice",
    "quantity",
    "pnl",
    "riskAmount",
    "rMultiple",
  ] as const;

  for (const f of numericFields) {
    const v = body[f];
    if (v !== undefined && v !== null && !Number.isFinite(v)) {
      return NextResponse.json({ error: `Invalid number for ${f}.` }, { status: 400 });
    }
  }

  // Sanity: quantity and risk should be non-negative if provided.
  if (body.quantity !== undefined && body.quantity !== null && body.quantity < 0) {
    return NextResponse.json({ error: "Quantity cannot be negative." }, { status: 400 });
  }
  if (body.riskAmount !== undefined && body.riskAmount !== null && body.riskAmount < 0) {
    return NextResponse.json({ error: "Risk amount cannot be negative." }, { status: 400 });
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
