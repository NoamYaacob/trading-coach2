import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

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

function toDecimal(v: number | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return Number.isFinite(v) ? v.toString() : null;
}

function nullableString(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: JournalPayload;
  try {
    body = (await request.json()) as JournalPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Required fields
  const symbol = body.symbol?.trim();
  if (!symbol) {
    return NextResponse.json({ error: "Symbol is required." }, { status: 400 });
  }

  const direction = body.direction?.toUpperCase();
  if (!direction || !ALLOWED_DIRECTIONS.has(direction)) {
    return NextResponse.json(
      { error: "Direction must be LONG or SHORT." },
      { status: 400 },
    );
  }

  // tradedAt: required, must be a valid date string
  if (!body.tradedAt) {
    return NextResponse.json({ error: "Trade date/time is required." }, { status: 400 });
  }
  const tradedAt = new Date(body.tradedAt);
  if (Number.isNaN(tradedAt.getTime())) {
    return NextResponse.json({ error: "Invalid trade date/time." }, { status: 400 });
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
        strategy: nullableString(body.strategy),
        notes: nullableString(body.notes),
        ruleBreached: body.ruleBreached ?? false,
        breachReason: nullableString(body.breachReason),
      },
      select: { id: true },
    });

    return NextResponse.json({ ok: true, id: created.id });
  } catch (err) {
    console.error("[journal] save error:", err);
    return NextResponse.json({ error: "Failed to save trade." }, { status: 500 });
  }
}
