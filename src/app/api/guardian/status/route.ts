import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getGuardianSnapshot, updateGuardianStatus } from "@/lib/guardian";
import { sendInterventionAlert } from "@/lib/telegram-coach-push";
import type { CurrentInterventionEvent } from "@/lib/intervention-engine";

type GuardianStatusRequest = {
  todayTradesCount?: number;
  todayPnL?: number;
  consecutiveLosses?: number;
};

function deriveThresholdAlerts(
  before: { consecutiveLosses: number; todayPnL: number },
  after: { consecutiveLosses: number; todayPnL: number },
  profile: { stopAfterConsecutiveLosses: number | null; maxDailyLoss: number | null },
): CurrentInterventionEvent[] {
  const alerts: CurrentInterventionEvent[] = [];

  const lossLimit = profile.stopAfterConsecutiveLosses;
  if (lossLimit && lossLimit > 1) {
    const warningAt = lossLimit - 1;
    if (before.consecutiveLosses < warningAt && after.consecutiveLosses >= warningAt) {
      alerts.push({
        type: "consecutive_losses_warning",
        streak: after.consecutiveLosses,
        limit: lossLimit,
      });
    }
  }

  const maxLoss = profile.maxDailyLoss;
  if (maxLoss && maxLoss > 0) {
    const used = Math.abs(Math.min(after.todayPnL, 0));
    const usedBefore = Math.abs(Math.min(before.todayPnL, 0));
    const threshold = maxLoss * 0.8;
    if (usedBefore < threshold && used >= threshold) {
      alerts.push({
        type: "near_daily_loss_limit",
        pctUsed: used / maxLoss,
        remaining: Math.max(0, maxLoss - used),
      });
    }
  }

  return alerts;
}

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as GuardianStatusRequest;

  const newConsecutiveLosses = body.consecutiveLosses ?? 0;
  const newTodayPnL = body.todayPnL ?? 0;

  // Snapshot before update to detect threshold crossings
  const beforeSnapshot = await getGuardianSnapshot(currentUser.id);

  const snapshot = await updateGuardianStatus(currentUser.id, {
    todayTradesCount: body.todayTradesCount ?? 0,
    todayPnL: newTodayPnL,
    consecutiveLosses: newConsecutiveLosses,
  });

  const alerts = deriveThresholdAlerts(
    {
      consecutiveLosses: beforeSnapshot.status.consecutiveLosses,
      todayPnL: Number(beforeSnapshot.status.todayPnL ?? 0),
    },
    { consecutiveLosses: newConsecutiveLosses, todayPnL: newTodayPnL },
    {
      stopAfterConsecutiveLosses: snapshot.profile.stopAfterConsecutiveLosses,
      maxDailyLoss: snapshot.profile.maxDailyLoss ? Number(snapshot.profile.maxDailyLoss) : null,
    },
  );

  // Fire proactive Telegram alerts for each crossed threshold — non-blocking
  for (const alert of alerts) {
    sendInterventionAlert(currentUser.id, alert).catch(() => undefined);
  }

  return NextResponse.json({ ok: true, snapshot });
}
