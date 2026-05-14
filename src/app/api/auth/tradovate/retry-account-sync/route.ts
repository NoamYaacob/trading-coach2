import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTradovateConfig } from "@/lib/brokers/tradovate-env";
import { parseAndDecrypt, TokenCryptoError } from "@/lib/security/token-crypto";
import { checkRateLimit } from "@/lib/rate-limit";

type TvAccount = {
  id: number;
  name: string;
  accountType: string;
  active: boolean;
  nickname?: string;
};

type DiscoveredAccount = {
  externalAccountId: string;
  name: string;
  accountType: string;
  active: boolean;
};

async function discoverAccounts(
  baseUrl: string,
  accessToken: string,
): Promise<DiscoveredAccount[]> {
  try {
    const res = await fetch(`${baseUrl}/account/list`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as TvAccount[];
    if (!Array.isArray(data)) return [];
    return data.map((a): DiscoveredAccount => ({
      externalAccountId: String(a.id),
      name: a.nickname ?? a.name ?? String(a.id),
      accountType: a.accountType ?? "unknown",
      active: Boolean(a.active),
    }));
  } catch {
    return [];
  }
}

export async function POST(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const limit = checkRateLimit(`tradovate_retry_sync:${currentUser.id}`, 5, 3_600_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: { setupId?: string };
  try {
    body = (await request.json()) as { setupId?: string };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { setupId } = body;
  if (!setupId || typeof setupId !== "string") {
    return NextResponse.json({ error: "missing_setup_id" }, { status: 400 });
  }

  const setup = await prisma.pendingBrokerSetup.findFirst({
    where: {
      id: setupId,
      userId: currentUser.id,
      expiresAt: { gt: new Date() },
    },
    select: { id: true, env: true, brokerConnectionId: true },
  });

  if (!setup) {
    return NextResponse.json({ error: "setup_not_found" }, { status: 404 });
  }
  if (!setup.brokerConnectionId) {
    return NextResponse.json({ error: "oauth_not_completed" }, { status: 400 });
  }

  const brokerConnection = await prisma.brokerConnection.findFirst({
    where: { id: setup.brokerConnectionId, userId: currentUser.id },
    select: { accessTokenEncrypted: true },
  });
  if (!brokerConnection) {
    return NextResponse.json({ error: "connection_not_found" }, { status: 404 });
  }

  let accessToken: string;
  try {
    accessToken = parseAndDecrypt(brokerConnection.accessTokenEncrypted);
  } catch (err) {
    const code = err instanceof TokenCryptoError ? err.code : "unknown";
    console.error(`[tradovate/retry-account-sync] token decrypt failed: ${code}`);
    return NextResponse.json({ error: "token_decrypt_failed" }, { status: 500 });
  }

  const configStatus = getTradovateConfig();
  if (configStatus.state !== "ready") {
    return NextResponse.json({ error: "oauth_not_configured" }, { status: 503 });
  }

  const env = setup.env as "live" | "demo";
  const accounts = await discoverAccounts(configStatus.config.apiBaseUrl[env], accessToken);

  await prisma.pendingBrokerSetup.update({
    where: { id: setup.id },
    data: { discoveredAccountsJson: accounts },
  });

  console.info("[tradovate/retry-account-sync] re-synced accounts", {
    setupId,
    count: accounts.length,
  });

  return NextResponse.json({ ok: true, count: accounts.length });
}
