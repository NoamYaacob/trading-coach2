import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTradovateConfig, resolveRedirectUri, resolveAppBaseUrl } from "@/lib/brokers/tradovate-env";
import { validateOAuthState } from "@/lib/brokers/tradovate-oauth-state";
import {
  buildTradovateOAuthTokenRequest,
  describeTokenRequestShape,
  mapTvTokenError,
  parseTvTokenErrorBody,
  parseTvTokenResponse,
} from "@/lib/brokers/tradovate-token-exchange";
import type { TvParsedToken } from "@/lib/brokers/tradovate-token-exchange";
import { encryptAndSerialize, TokenCryptoError } from "@/lib/security/token-crypto";
import { checkRateLimit } from "@/lib/rate-limit";
import { runPermissionProbe } from "@/lib/brokers/permission-probe-runner";

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
  const target = `${base}/accounts/connect/tradovate?error=${encodeURIComponent(error)}`;
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
      if (res.status === 401) {
        console.warn("[tradovate/callback] account/list unauthorized — token may not be valid for this API base URL", {
          status: res.status,
          apiBaseUrl: url,
        });
      } else {
        console.warn("[tradovate/callback] account/list returned HTTP", { status: res.status });
      }
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
  // The state cookie is already deleted above — any second invocation of this
  // callback will fail CSRF validation before reaching the token exchange.
  console.info("[tradovate/callback] token exchange preflight", {
    tokenUrl: config.tokenUrl[payload.env],
    redirectUri,
    clientId: config.clientId,
    hasClientSecret: Boolean(config.clientSecret),
    env: payload.env,
    setupIdExists: Boolean(payload.setupId),
  });

  let token: TvParsedToken;

  const tokenReq = buildTradovateOAuthTokenRequest({
    tokenUrl: config.tokenUrl[payload.env],
    code,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri,
  });
  console.info("[tradovate/callback] token request shape", describeTokenRequestShape(tokenReq));

  try {
    const tokenRes = await fetch(tokenReq.url, {
      method: tokenReq.method,
      headers: tokenReq.headers,
      body: tokenReq.body,
    });

    if (!tokenRes.ok) {
      const rawBody = await tokenRes.text().catch(() => "");
      const { tvError, tvErrorDesc } = parseTvTokenErrorBody(rawBody);
      console.error("[tradovate/callback] token exchange failed", {
        httpStatus: tokenRes.status,
        tvError,
        tvErrorDesc,
      });
      return backToConnectPage(request, mapTvTokenError(tvError));
    }

    const rawJson = (await tokenRes.json()) as unknown;
    const rawObj =
      rawJson !== null && typeof rawJson === "object" && !Array.isArray(rawJson)
        ? (rawJson as Record<string, unknown>)
        : null;
    // Log response shape for diagnostics — field names and safe OAuth error
    // strings only; token values, codes, and secrets are never logged.
    console.info("[tradovate/callback] token response shape", {
      responseKeys: rawObj ? Object.keys(rawObj) : [],
      has_access_token: typeof rawObj?.access_token === "string",
      has_accessToken: typeof rawObj?.accessToken === "string",
      tvError: typeof rawObj?.error === "string" ? rawObj.error : null,
      tvErrorDesc: typeof rawObj?.error_description === "string" ? rawObj.error_description : null,
      token_type: typeof rawObj?.token_type === "string" ? rawObj.token_type : null,
      tokenType: typeof rawObj?.tokenType === "string" ? rawObj.tokenType : null,
      expiresField:
        "expires_in" in (rawObj ?? {})
          ? "expires_in"
          : "expiresIn" in (rawObj ?? {})
            ? "expiresIn"
            : null,
    });

    const parsed = parseTvTokenResponse(rawJson);
    if (!parsed.ok) {
      // Tradovate returns OAuth errors as HTTP 200 with { error, error_description }.
      // Route through mapTvTokenError for specific codes; fall back to the generic
      // missing-token code only when there is no OAuth error field at all.
      const errorCode = parsed.tvError
        ? mapTvTokenError(parsed.tvError)
        : "oauth_token_response_missing_access_token";
      console.error("[tradovate/callback] token response did not contain access token", {
        responseKeys: parsed.responseKeys,
        tvError: parsed.tvError,
        tvErrorDesc: parsed.tvErrorDesc,
        errorCode,
      });
      return backToConnectPage(request, errorCode);
    }

    token = parsed.token;
  } catch (err) {
    const name = err instanceof Error ? err.name : "unknown";
    console.error(`[tradovate/callback] token exchange error: ${name}`);
    return backToConnectPage(request, "token_exchange_error");
  }

  // ── Discover accounts (only after token is confirmed) ──────────────────
  // Raw accessToken is available here; we call /account/list while the
  // plaintext token is in scope — it is encrypted immediately after.
  const discoveredAccounts = await discoverAccounts(
    config.apiBaseUrl[payload.env],
    token.accessToken,
  );
  console.info("[tradovate/callback] discovered accounts", {
    count: discoveredAccounts.length,
  });

  // ── Encrypt tokens ─────────────────────────────────────────────────────
  let accessTokenEncrypted: string;
  let refreshTokenEncrypted: string | null = null;
  let tokenExpiresAt: Date | null = null;

  try {
    accessTokenEncrypted = encryptAndSerialize(token.accessToken);
    if (token.refreshToken) {
      refreshTokenEncrypted = encryptAndSerialize(token.refreshToken);
    }
    if (token.expiresIn !== null) {
      tokenExpiresAt = new Date(Date.now() + token.expiresIn * 1000);
    }
  } catch (err) {
    const code = err instanceof TokenCryptoError ? err.code : "unknown";
    const name = err instanceof Error ? err.name : "unknown";
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[tradovate/callback] token encryption failed", { code, name, msg });
    return backToConnectPage(request, "token_encryption_failed");
  }

  const base = resolveAppBaseUrl(request.url);

  // ── Reconnect path — update existing BrokerConnection ─────────────────
  if (payload.reconnectId) {
    const existingBc = await prisma.brokerConnection.findFirst({
      where: { id: payload.reconnectId, userId: payload.userId },
      select: { id: true },
    });
    if (!existingBc) {
      console.warn("[tradovate/callback] reconnect target not found", {
        reconnectId: payload.reconnectId,
      });
      return backToConnectPage(request, "broker_connection_storage_failed");
    }

    try {
      await prisma.brokerConnection.update({
        where: { id: payload.reconnectId },
        data: {
          connectionStatus: "connected_readonly",
          accessTokenEncrypted,
          ...(refreshTokenEncrypted !== null && { refreshTokenEncrypted }),
          tokenExpiresAt,
          errorMessage: null,
          // Fresh OAuth grant — clear any previous renewal failure so the debug
          // endpoint and any future alerting do not surface a stale error against
          // a healthy connection. lastRenewedAt is set here even though this is
          // an OAuth authorization (not a programmatic refresh-token renewal)
          // because the net effect is identical: a fresh access token is now
          // stored and the previous failure is resolved.
          lastRenewError: null,
          lastRenewedAt: new Date(),
          ...(token.accountId != null && { brokerUserId: token.accountId }),
          // Clear stale permission level — fresh probe runs below with the new token.
          permissionLevel: null,
          permissionsProbedAt: null,
        },
      });
      await prisma.connectedAccount.updateMany({
        where: {
          brokerConnectionId: payload.reconnectId,
          connectionStatus: { in: ["expired", "connection_error"] },
          missingFromBrokerSince: null,
        },
        data: { connectionStatus: "connected_readonly", errorMessage: null },
      });

      // Auto-delete other orphaned expired BrokerConnections for the same env
      // (no linked accounts) so stale rows don't confuse the Settings UI.
      const otherExpiredBcs = await prisma.brokerConnection.findMany({
        where: {
          userId: payload.userId,
          env: payload.env,
          connectionStatus: "expired",
          id: { not: payload.reconnectId },
        },
        select: { id: true },
      });
      if (otherExpiredBcs.length > 0) {
        const candidateIds = otherExpiredBcs.map((b) => b.id);
        const linkedRows = await prisma.connectedAccount.findMany({
          where: { brokerConnectionId: { in: candidateIds } },
          select: { brokerConnectionId: true },
        });
        const linkedIds = new Set(
          linkedRows.map((r) => r.brokerConnectionId).filter((id): id is string => id !== null),
        );
        const toDelete = candidateIds.filter((id) => !linkedIds.has(id));
        if (toDelete.length > 0) {
          await prisma.brokerConnection.deleteMany({ where: { id: { in: toDelete } } });
          console.info("[tradovate/callback] cleaned up orphaned expired connections", {
            deletedCount: toDelete.length,
            env: payload.env,
          });
        }
      }

      console.info("[tradovate/callback] connection reconnected", {
        brokerConnectionId: payload.reconnectId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[tradovate/callback] reconnect update failed", { msg });
      return backToConnectPage(request, "broker_connection_storage_failed");
    }

    // Run the permission probe immediately after reconnect — same as the finalize
    // route does for new connections. Uses the fresh token just stored above.
    // Awaited so Settings shows the correct permissionLevel on arrival, not a
    // stale read_only from before the reconnect.
    const probeAccount = await prisma.connectedAccount.findFirst({
      where: { brokerConnectionId: payload.reconnectId, isActive: true },
      select: { id: true },
    });
    if (probeAccount) {
      await runPermissionProbe({
        brokerConnectionId: payload.reconnectId,
        accountId: probeAccount.id,
        userId: payload.userId,
        source: "reconnect",
      });
    }

    return NextResponse.redirect(`${base}/settings?tradovate_reconnected=1`);
  }

  // ── Create or update BrokerConnection ──────────────────────────────────
  let brokerConnection: { id: string };
  try {
    brokerConnection = await prisma.brokerConnection.create({
      data: {
        userId: payload.userId,
        platform: "tradovate",
        env: payload.env,
        brokerUserId: token.accountId,
        connectionStatus: "connected_readonly",
        accessTokenEncrypted,
        refreshTokenEncrypted,
        tokenExpiresAt,
      },
      select: { id: true },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[tradovate/callback] brokerConnection create failed", { msg });
    return backToConnectPage(request, "broker_connection_storage_failed");
  }

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

    try {
      await prisma.pendingBrokerSetup.update({
        where: { id: setup.id },
        data: {
          brokerConnectionId: brokerConnection.id,
          discoveredAccountsJson: discoveredAccounts,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[tradovate/callback] pendingBrokerSetup update failed", { msg });
      return backToConnectPage(request, "setup_update_failed");
    }

    return NextResponse.redirect(
      `${base}/accounts/connect/tradovate/select?setupId=${encodeURIComponent(setup.id)}`,
    );
  }

  // ── Legacy single-account fallback (no setupId) ─────────────────────────
  // Kept for backward compatibility — e.g. a direct visit to /connect?env=live
  // that bypassed the setup form.
  const externalAccountId = token.accountId;

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
