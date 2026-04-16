import { GuardianConnectionStatus, GuardianResetMode } from "@prisma/client";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { updateGuardianProfile } from "@/lib/guardian";

type GuardianProfileRequest = {
  guardianEnabled?: boolean;
  adapterKey?: string;
  platformName?: string;
  connectionStatus?: GuardianConnectionStatus;
  maxTradesPerDay?: number | null;
  maxDailyLoss?: number | null;
  stopAfterConsecutiveLosses?: number | null;
  dailyProfitTarget?: number | null;
  copyTradeMode?: boolean;
  resetMode?: GuardianResetMode;
  dailyResetHour?: number;
  dailyResetTimezone?: string;
};

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as GuardianProfileRequest;

  const snapshot = await updateGuardianProfile(currentUser.id, {
    guardianEnabled: Boolean(body.guardianEnabled),
    adapterKey: body.adapterKey?.trim() || "mock",
    platformName: body.platformName?.trim() || "Mock Platform",
    connectionStatus:
      body.connectionStatus ?? GuardianConnectionStatus.MOCK_CONNECTED,
    maxTradesPerDay: body.maxTradesPerDay ?? null,
    maxDailyLoss: body.maxDailyLoss ?? null,
    stopAfterConsecutiveLosses: body.stopAfterConsecutiveLosses ?? null,
    dailyProfitTarget: body.dailyProfitTarget ?? null,
    copyTradeMode: Boolean(body.copyTradeMode),
    resetMode: body.resetMode ?? GuardianResetMode.DAILY,
    dailyResetHour: body.dailyResetHour ?? 9,
    dailyResetTimezone: body.dailyResetTimezone?.trim() || "UTC",
  });

  return NextResponse.json({ ok: true, snapshot });
}
