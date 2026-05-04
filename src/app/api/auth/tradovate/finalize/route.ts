import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { syncTradovateAccount } from "@/lib/brokers/tradovate-sync";

type SelectedAccount = {
  externalAccountId: string;
  label: string;
  accountType: "evaluation" | "funded" | "personal" | "demo";
  propFirm?: string | null;
};

type FinalizeBody = {
  setupId: string;
  selectedAccounts: SelectedAccount[];
};

const VALID_ACCOUNT_TYPES = new Set(["evaluation", "funded", "personal", "demo"]);

export async function POST(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const limit = checkRateLimit(`tradovate_finalize:${currentUser.id}`, 10, 3_600_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: FinalizeBody;
  try {
    body = (await request.json()) as FinalizeBody;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { setupId, selectedAccounts } = body;

  if (!setupId || typeof setupId !== "string") {
    return NextResponse.json({ error: "missing_setup_id" }, { status: 400 });
  }
  if (!Array.isArray(selectedAccounts) || selectedAccounts.length === 0) {
    return NextResponse.json({ error: "no_accounts_selected" }, { status: 400 });
  }
  if (selectedAccounts.length > 20) {
    return NextResponse.json({ error: "too_many_accounts" }, { status: 400 });
  }

  // Validate each selected account entry.
  for (const acc of selectedAccounts) {
    if (!acc.externalAccountId || typeof acc.externalAccountId !== "string") {
      return NextResponse.json({ error: "invalid_account" }, { status: 400 });
    }
    if (!acc.label || typeof acc.label !== "string" || acc.label.trim().length === 0) {
      return NextResponse.json({ error: "invalid_label" }, { status: 400 });
    }
    if (!VALID_ACCOUNT_TYPES.has(acc.accountType)) {
      return NextResponse.json({ error: "invalid_account_type" }, { status: 400 });
    }
  }

  // Load and verify the pending setup (must belong to this user and not be expired).
  const setup = await prisma.pendingBrokerSetup.findFirst({
    where: {
      id: setupId,
      userId: currentUser.id,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      propFirmName: true,
      brokerConnectionId: true,
    },
  });

  if (!setup) {
    return NextResponse.json({ error: "setup_not_found" }, { status: 404 });
  }
  if (!setup.brokerConnectionId) {
    return NextResponse.json({ error: "oauth_not_completed" }, { status: 400 });
  }

  // Verify the BrokerConnection belongs to this user.
  const brokerConnection = await prisma.brokerConnection.findFirst({
    where: {
      id: setup.brokerConnectionId,
      userId: currentUser.id,
    },
    select: { id: true, env: true },
  });
  if (!brokerConnection) {
    return NextResponse.json({ error: "connection_not_found" }, { status: 404 });
  }

  const createdAccountIds: string[] = [];

  for (const acc of selectedAccounts) {
    const propFirm = acc.propFirm?.trim() || setup.propFirmName || null;
    const label = acc.label.trim();

    // Upsert: if this account was previously connected, update it; otherwise create.
    const existing = await prisma.connectedAccount.findFirst({
      where: {
        userId: currentUser.id,
        platform: "tradovate",
        externalAccountId: acc.externalAccountId,
      },
      select: { id: true },
    });

    const accountData = {
      label,
      propFirm,
      accountType: acc.accountType,
      isActive: true,
      connectionStatus: "connected_readonly",
      connectedAt: new Date(),
      errorMessage: null,
      brokerConnectionId: brokerConnection.id,
    };

    const account = existing
      ? await prisma.connectedAccount.update({
          where: { id: existing.id },
          data: accountData,
          select: { id: true },
        })
      : await prisma.connectedAccount.create({
          data: {
            userId: currentUser.id,
            platform: "tradovate",
            externalAccountId: acc.externalAccountId,
            currency: "USD",
            brokerUserId: null,
            lastSyncAt: null,
            ...accountData,
          },
          select: { id: true },
        });

    createdAccountIds.push(account.id);
  }

  // Clean up the pending setup record now that it's been finalized.
  await prisma.pendingBrokerSetup.delete({ where: { id: setup.id } }).catch(() => {
    // Non-fatal — TTL cleanup will handle it if delete fails.
  });

  console.info("[tradovate/finalize] accounts created", {
    count: createdAccountIds.length,
    brokerConnectionId: brokerConnection.id,
  });

  // Immediately sync the newly imported accounts so the dashboard shows live
  // balance/P&L data rather than empty/unavailable state on first visit.
  // Errors are swallowed — a failed sync here should never block finalize.
  await Promise.allSettled(
    createdAccountIds.map((id) =>
      syncTradovateAccount(id, currentUser.id).catch((err) => {
        console.warn("[tradovate/finalize] post-import sync failed (non-fatal)", {
          accountId: id,
          error: err instanceof Error ? err.message : "unknown",
        });
      }),
    ),
  );

  return NextResponse.json({
    ok: true,
    accountIds: createdAccountIds,
    redirectTo: `/accounts/connect/tradovate/rules?accountIds=${createdAccountIds.join(",")}`,
  });
}
