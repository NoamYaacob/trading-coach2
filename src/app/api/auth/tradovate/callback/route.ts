import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTradovateConfig, resolveRedirectUri, resolveAppBaseUrl } from "@/lib/brokers/tradovate-env";
import { validateOAuthState } from "@/lib/brokers/tradovate-oauth-state";
import { encryptAndSerialize, TokenCryptoError } from "@/lib/security/token-crypto";
import { checkRateLimit } from "@/lib/rate-limit";

const OAUTH_STATE_COOKIE = "tradovate_oauth_state";

// Tradovate /account/list response shape (unverified — based on public API docs).
type TvAccount = {
  id: number;
  name: string;
  userId: number;
  accountType: string;
  active: boolean;
  status?: string;
  archived?: boolean;
  nickname?: string;
};

type DiscoveredAccount = {
  externalAccountId: string;
  name: string;
  accountType: string;
  active: boolean;
};

function backToConnectPage(request: NextRequest, error: string) {
  const base = resolveAppBaseUrl(request.url);
  const target = `${base}/accounts/connect/tradovate?oauth_error=${encodeURIComponent(error)}`;
  console.info("[tradovate/callback] redirecting to connect page", { error, target });
  return NextResponse.redirect(target);
}

/** Call Tradovate /account/list with a raw (plaintext) access token. */
async function discoverAccounts(
  baseUrl: string,
  accessToken: string,
): Promise<DiscoveredAccount[]> {
  const url = `${baseUrl}/account/list`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      console.warn("[tradovate/callback] account/list returned HTTP", { status: res.status });
      return [];
    }
    const data = (await res.json()) as TvAccount[];
    if (!Array.isArray(data)) return [];
    return data.map((a): DiscoveredAccount => ({
      externalAccountId: String(a.id),
      name: a.nickname ?? a.name ?? String(a.id),
      accountType: a.accountType ?? "unknown",
      active: Boolean(a.active),
    }));
  } catch {
    console.warn("[tradovate/callback] account/list network error");
    return [];
  }
}

export async function GET(request: NextRequest) {
  // The callback must run inside the same authenticated session that
  // initiated the OAuth flow. Without this, an attacker could craft a
  // state with another user's id and have tokens stored against the
  // wrong account — the CSRF nonce alone does not bind tokens to the
  // session that started the flow.
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return backToConnectPage(request, "unauthenticated");
  }

  const callbackLimit = checkRateLimit(`tradovate_callback:${currentUser.id}`, 10, 3_600_000);
  if (!callbackLimit.ok) {
    return backToConnectPage(request, "too_many_requests");
  }

  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // User denied the OAuth consent or Tradovate returned an error.
  if (error) return backToConnectPage(request, error);

  if (!code || !state) {
    return backToConnectPage(request, "missing_params");
  }

  // CSRF check + session binding live in one helper.
  const cookieStore = await cookies();
  const storedNonce = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(OAUTH_STATE_COOKIE);

  let stateEnv: string = "unknown";
  try {
    const { decodeOAuthState } = await import("@/lib/brokers/tradovate-oauth-state");
    const decoded = decodeOAuthState(state);
    if (decoded.ok) stateEnv = decoded.state.env;
  } catch { /* non-fatal */ }
  console.info("[tradovate/callback] CSRF check", {
    hasStateParam: Boolean(state),
    hasCookieNonce: Boolean(storedNonce),
    stateEnv,
    hasSessionUser: Boolean(currentUser.id),
  });

  const validation = validateOAuthState({
    rawState: state,
    cookieNonce: storedNonce,
    sessionUserId: currentUser.id,
  });
  if (!validation.ok) {
    console.warn("[tradovate/callback] CSRF validation failed", { reason: validation.reason });
    return backToConnectPage(request, validation.reason);
  }
  const payload = validation.state!;

  // Re-validate config — env may have changed between connect and callback.
  const status = getTradovateConfig();
  if (status.state !== "ready") {
    return backToConnectPage(request, "oauth_not_configured");
  }
  const { config } = status;

  const redirectUri = resolveRedirectUri(config, request.url);

  // ── Token exchange ─────────────────────────────────────────────────────
  let tokenData: {
    access_token: string;
    refresh_token?: string;
    account_id?: string | number;
    expires_in?: number;
  };

  try {
    const tokenRes = await fetch(config.tokenUrl[payload.env], {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: payload.env === "demo" && config.demoClientId ? config.demoClientId : config.clientId,
        client_secret: payload.env === "demo" && config.demoClientSecret ? config.demoClientSecret : config.clientSecret,
      }).toString(),
    });

    if (!tokenRes.ok) {
      await tokenRes.text().catch(() => "");
      console.error(`[tradovate/callback] token exchange failed: HTTP ${tokenRes.status}`);
      return backToConnectPage(request, "token_exchange_failed");
    }

    tokenData = (await tokenRes.json()) as typeof tokenData;
  } catch (err) {
    const name = err instanceof Error ? err.name : "unknown";
    console.error(`[tradovate/callback] token exchange error: ${name}`);
    return backToConnectPage(request, "token_exchange_error");
  }

  // ── Discover accounts before encrypting ────────────────────────────────
  // The raw access_token is available here. We call /account/list now while
  // the plaintext token is in scope — tokens are encrypted immediately after.
  const discoveredAccounts = await discoverAccounts(
    config.apiBaseUrl[payload.env],
    tokenData.access_token,
  );
  console.info("[tradovate/callback] discovered accounts", {
    count: discoveredAccounts.length,
  });

  // ── Encrypt tokens ─────────────────────────────────────────────────────
  let accessTokenEncrypted: string;
  let refreshTokenEncrypted: string | null = null;
  let tokenExpiresAt: Date | null = null;

  try {
    accessTokenEncrypted = encryptAndSerialize(tokenData.access_token);
    if (tokenData.refresh_token) {
      refreshTokenEncrypted = encryptAndSerialize(tokenData.refresh_token);
    }
    if (
      typeof tokenData.expires_in === "number" &&
      Number.isFinite(tokenData.expires_in) &&
      tokenData.expires_in > 0
    ) {
      tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
    }
  } catch (err) {
    const code = err instanceof TokenCryptoError ? err.code : "unknown";
    console.error(`[tradovate/callback] token encryption failed: ${code}`);
    return backToConnectPage(request, "token_storage_failed");
  }

  // ── Create or update BrokerConnection ──────────────────────────────────
  const brokerConnection = await prisma.brokerConnection.create({
    data: {
      userId: payload.userId,
      platform: "tradovate",
      env: payload.env,
      brokerUserId: tokenData.account_id ? String(tokenData.account_id) : null,
      connectionStatus: "connected_readonly",
      accessTokenEncrypted,
      refreshTokenEncrypted,
      tokenExpiresAt,
    },
    select: { id: true },
  });

  const base = resolveAppBaseUrl(request.url);

  // ── New multi-account flow (with setupId) ───────────────────────────────
  if (payload.setupId) {
    const setup = await prisma.pendingBrokerSetup.findFirst({
      where: {
        id: payload.setupId,
        userId: payload.userId,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });

    if (!setup) {
      // Setup expired — still store the connection but send to the connect
      // page with an error so the user knows they need to try again.
      console.warn("[tradovate/callback] pending setup not found or expired", {
        setupId: payload.setupId,
      });
      return backToConnectPage(request, "setup_expired");
    }

    await prisma.pendingBrokerSetup.update({
      where: { id: setup.id },
      data: {
        brokerConnectionId: brokerConnection.id,
        discoveredAccountsJson: discoveredAccounts,
      },
    });

    return NextResponse.redirect(
      `${base}/accounts/connect/tradovate/select?setupId=${encodeURIComponent(setup.id)}`,
    );
  }

  // ── Legacy single-account fallback (no setupId) ─────────────────────────
  // Kept for backward compatibility — e.g. a direct visit to /connect?env=live
  // that bypassed the setup form.
  const externalAccountId = tokenData.account_id ? String(tokenData.account_id) : null;

  const existing = externalAccountId
    ? await prisma.connectedAccount.findFirst({
        where: {
          userId: payload.userId,
          platform: "tradovate",
          externalAccountId,
        },
        select: { id: true },
      })
    : null;

  const connectionFields = {
    isActive: true,
    connectionStatus: "connected_readonly",
    connectedAt: new Date(),
    errorMessage: null,
    brokerConnectionId: brokerConnection.id,
    // Legacy per-account columns — populated for backward compat only.
    accessTokenEncrypted,
    refreshTokenEncrypted,
    tokenExpiresAt,
    lastSyncAt: null,
  };

  const account = existing
    ? await prisma.connectedAccount.update({
        where: { id: existing.id },
        data: connectionFields,
        select: { id: true },
      })
    : await prisma.connectedAccount.create({
        data: {
          userId: payload.userId,
          label: `Tradovate ${payload.env === "demo" ? "Demo" : "Live"}`,
          platform: "tradovate",
          propFirm: null,
          accountType: payload.env === "demo" ? "demo" : "funded",
          externalAccountId,
          currency: "USD",
          brokerUserId: null,
          ...connectionFields,
        },
        select: { id: true },
      });

  return NextResponse.redirect(
    `${base}/accounts/connect/tradovate?oauth=verified&account=${account.id}`,
  );
}
