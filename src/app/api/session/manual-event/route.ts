import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { updateGuardianStatus } from "@/lib/guardian";
import { deriveManualEventSignals, getTodayManualEvents, isManualTradeEventType, logManualTradeEvent } from "@/lib/manual-trade-events";

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { eventType, note, pnlAmount } = body as Record<string, unknown>;

  if (typeof eventType !== "string" || !isManualTradeEventType(eventType)) {
    return NextResponse.json(
      {
        error:
          "Invalid eventType. Must be one of: trade_opened, trade_closed, win, loss, pnl_update, rule_breach, manual_note",
      },
      { status: 400 },
    );
  }

  const noteValue =
    typeof note === "string" && note.trim() ? note.trim().slice(0, 500) : undefined;
  const pnlValue =
    typeof pnlAmount === "number" && isFinite(pnlAmount) ? pnlAmount : undefined;

  const event = await logManualTradeEvent(currentUser.id, eventType, {
    note: noteValue,
    pnlAmount: pnlValue,
  });

  const todayEvents = await getTodayManualEvents(currentUser.id);
  const signals = deriveManualEventSignals(todayEvents);

  try {
    await updateGuardianStatus(currentUser.id, {
      todayTradesCount: signals.winCount + signals.lossCount + signals.tradeCount,
      todayPnL: signals.netPnL ?? 0,
      consecutiveLosses: signals.consecutiveLosses,
    });
  } catch (err) {
    console.error("[manual-event] guardian status update failed:", err);
  }

  return NextResponse.json({
    id: event.id,
    eventType,
    createdAt: event.createdAt,
    summary: {
      todayTradesCount: signals.winCount + signals.lossCount + signals.tradeCount,
      todayPnL: signals.netPnL ?? 0,
      consecutiveLosses: signals.consecutiveLosses,
    },
  });
}
