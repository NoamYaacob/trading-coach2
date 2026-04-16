import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { updateGuardianStatus } from "@/lib/guardian";

type GuardianStatusRequest = {
  todayTradesCount?: number;
  todayPnL?: number;
  consecutiveLosses?: number;
};

export async function POST(request: Request) {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as GuardianStatusRequest;

  const snapshot = await updateGuardianStatus(currentUser.id, {
    todayTradesCount: body.todayTradesCount ?? 0,
    todayPnL: body.todayPnL ?? 0,
    consecutiveLosses: body.consecutiveLosses ?? 0,
  });

  return NextResponse.json({ ok: true, snapshot });
}
