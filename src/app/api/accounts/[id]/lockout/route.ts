import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { maybeAttemptBrokerLockForManualLock } from "@/lib/guardian-engine/manual-broker-lock-service";
import {
  buildManualLockoutPlan,
  mapManualBrokerLockStatus,
  type ManualBrokerLockUiStatus,
} from "./lockout-helpers";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const limit = checkRateLimit(`account_lockout:${user.id}`, 10, 3_600_000);
  if (!limit.ok) {
    return NextResponse.json({ error: "too_many_requests" }, { status: 429 });
  }

  const { id } = await params;

  const account = await prisma.connectedAccount.findFirst({
    where: {
      id,
      userId: user.id,
      isActive: true,
      protectionStatus: { in: ["protected", "monitor_only"] },
    },
    select: {
      id: true,
      userId: true,
      brokerConnection: { select: { connectionStatus: true, permissionLevel: true } },
    },
  });
  if (!account) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const plan = buildManualLockoutPlan({ accountId: id, userId: user.id });

  // Step 1 — the internal Guardrail lock is committed FIRST and is the source
  // of truth. It must survive even if the broker write below fails.
  const [, lockEvent] = await prisma.$transaction([
    prisma.liveSessionState.upsert({
      where: { accountId: id },
      create: plan.liveSessionState.create,
      update: plan.liveSessionState.update,
    }),
    prisma.internalLockEvent.upsert({
      where: { activeDedupKey: plan.activeDedupKey },
      create: plan.internalLockEvent.create,
      update: plan.internalLockEvent.update,
    }),
  ]);

  const connStatus = account.brokerConnection?.connectionStatus ?? null;
  const permLevel = account.brokerConnection?.permissionLevel ?? null;
  console.info("[account-lockout] manual internal lock applied", {
    accountId: id,
    userId: user.id,
    tradingDay: plan.tradingDay,
    connectionStatus: connStatus,
    permissionLevel: permLevel,
  });

  // Step 2 — attempt the broker-level lock (delegated to the shared service,
  // which reuses the broker risk-setting write; no order placement /
  // cancellation / flatten). A failure here NEVER rolls back the internal lock
  // — it is caught and surfaced as a broker status the UI can display.
  let brokerLock: { status: ManualBrokerLockUiStatus; message: string } = {
    status: "unavailable",
    message: "Broker lock was not attempted.",
  };
  try {
    const svc = await maybeAttemptBrokerLockForManualLock(lockEvent.id);
    const uiStatus = mapManualBrokerLockStatus(svc.status, svc.brokerActionTaken);
    console.info("[account-lockout] broker lock attempted", {
      accountId: id,
      userId: user.id,
      brokerStatus: svc.status,
      brokerActionTaken: svc.brokerActionTaken,
      uiStatus,
      connectionStatus: connStatus,
      permissionLevel: permLevel,
      dedupKey: svc.dedupKey,
    });
    brokerLock = {
      status: uiStatus,
      message: svc.message,
    };
  } catch (err) {
    console.error("[account-lockout] broker lock attempt errored — internal lock preserved", {
      accountId: id,
      userId: user.id,
      connectionStatus: connStatus,
      permissionLevel: permLevel,
      error: err instanceof Error ? err.message : String(err),
    });
    brokerLock = {
      status: "failed",
      message: "Broker lock attempt errored. The Guardrail lock is still active.",
    };
  }

  return NextResponse.json({
    ok: true,
    accountId: id,
    tradingDay: plan.tradingDay,
    status: "locked",
    brokerLock,
  });
}
