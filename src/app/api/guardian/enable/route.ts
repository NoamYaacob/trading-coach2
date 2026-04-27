import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getGuardianSnapshot, updateGuardianProfile } from "@/lib/guardian";

export async function POST() {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snapshot = await getGuardianSnapshot(currentUser.id);
  const p = snapshot.profile;

  await updateGuardianProfile(currentUser.id, {
    guardianEnabled: true,
    adapterKey: p.adapterKey,
    platformName: p.platformName ?? "Mock Platform",
    connectionStatus: p.connectionStatus,
    maxTradesPerDay: p.maxTradesPerDay,
    maxDailyLoss: p.maxDailyLoss !== null ? Number(p.maxDailyLoss) : null,
    stopAfterConsecutiveLosses: p.stopAfterConsecutiveLosses,
    dailyProfitTarget: p.dailyProfitTarget !== null ? Number(p.dailyProfitTarget) : null,
    copyTradeMode: p.copyTradeMode,
    resetMode: p.resetMode,
    dailyResetHour: p.dailyResetHour,
    dailyResetTimezone: p.dailyResetTimezone,
  });

  return NextResponse.json({ ok: true });
}
