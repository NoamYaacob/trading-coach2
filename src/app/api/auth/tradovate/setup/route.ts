import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

const SETUP_TTL_MS = 15 * 60 * 1000; // 15 minutes

type SetupBody = {
  displayName?: string | null;
  accountSource?: "prop_firm" | "personal" | "demo" | "other";
  propFirmName?: string | null;
  env: "live" | "demo";
  /** brokerConnectionId — present for reconnect flows, skips PendingBrokerSetup creation */
  reconnect?: string;
};

export async function POST(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const limit = checkRateLimit(`tradovate_setup:${currentUser.id}`, 10, 3_600_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: SetupBody;
  try {
    body = (await request.json()) as SetupBody;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { displayName, accountSource, propFirmName, env, reconnect } = body;

  if (env !== "live" && env !== "demo") {
    return NextResponse.json({ error: "invalid_env" }, { status: 400 });
  }

  // Reconnect mode — re-authorize an existing expired BrokerConnection.
  // Skip PendingBrokerSetup; the reconnectId is threaded through OAuth state.
  if (reconnect) {
    const bc = await prisma.brokerConnection.findFirst({
      where: { id: reconnect, userId: currentUser.id },
      select: { id: true, env: true },
    });
    if (!bc) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({
      redirectTo: `/api/auth/tradovate/connect?env=${encodeURIComponent(bc.env)}&reconnect=${encodeURIComponent(bc.id)}`,
    });
  }

  if (!accountSource || !["prop_firm", "personal", "demo", "other"].includes(accountSource)) {
    return NextResponse.json({ error: "invalid_account_source" }, { status: 400 });
  }

  const setup = await prisma.pendingBrokerSetup.create({
    data: {
      userId: currentUser.id,
      platform: "tradovate",
      env,
      displayName: displayName?.trim() || null,
      accountSource,
      propFirmName: propFirmName?.trim() || null,
      expiresAt: new Date(Date.now() + SETUP_TTL_MS),
    },
    select: { id: true },
  });

  return NextResponse.json({
    redirectTo: `/api/auth/tradovate/connect?env=${encodeURIComponent(env)}&setupId=${encodeURIComponent(setup.id)}`,
  });
}
