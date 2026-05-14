import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  type JournalPayload,
  toDecimal,
  nullableString,
  validateAndExtractDates,
  ALLOWED_DIRECTIONS,
  VALID_PNL_SOURCES,
  MAX_SYMBOL_LEN,
  MAX_STRATEGY_LEN,
  MAX_NOTES_LEN,
  MAX_BREACH_REASON_LEN,
} from "../route";

type Ctx = { params: Promise<{ id: string }> };

function isPrismaNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2025"
  );
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limit = checkRateLimit(`journal:${user.id}`, 60, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const { id } = await ctx.params;

  let body: JournalPayload;
  try {
    body = (await request.json()) as JournalPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const symbolRaw = body.symbol?.trim();
  if (!symbolRaw) return NextResponse.json({ error: "Symbol is required." }, { status: 400 });
  if (symbolRaw.length > MAX_SYMBOL_LEN) {
    return NextResponse.json({ error: `Symbol must be ${MAX_SYMBOL_LEN} characters or fewer.` }, { status: 400 });
  }

  const direction = body.direction?.toUpperCase();
  if (!direction || !ALLOWED_DIRECTIONS.has(direction)) {
    return NextResponse.json({ error: "Direction must be LONG or SHORT." }, { status: 400 });
  }

  const dateResult = validateAndExtractDates(body.tradedAt);
  if (dateResult.error) return NextResponse.json({ error: dateResult.error }, { status: 400 });
  const tradedAt = dateResult.tradedAt!;

  if (body.pnlSource != null && !VALID_PNL_SOURCES.has(body.pnlSource)) {
    return NextResponse.json({ error: "Invalid pnlSource." }, { status: 400 });
  }

  const numericFields = [
    "entryPrice", "exitPrice", "stopPrice", "targetPrice",
    "quantity", "pnl", "fees", "grossPnl", "riskAmount", "rMultiple",
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
    const updated = await prisma.manualTradeEntry.update({
      where: { id, userId: user.id },
      data: {
        symbol: symbolRaw,
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
    return NextResponse.json({ ok: true, id: updated.id });
  } catch (err: unknown) {
    if (isPrismaNotFound(err)) return NextResponse.json({ error: "not_found" }, { status: 404 });
    console.error("[journal/PUT] error:", err);
    return NextResponse.json({ error: "Failed to update trade." }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limit = checkRateLimit(`journal-delete:${user.id}`, 20, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const { id } = await ctx.params;

  try {
    await prisma.manualTradeEntry.delete({ where: { id, userId: user.id } });
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (isPrismaNotFound(err)) return NextResponse.json({ error: "not_found" }, { status: 404 });
    console.error("[journal/DELETE] error:", err);
    return NextResponse.json({ error: "Failed to delete trade." }, { status: 500 });
  }
}
