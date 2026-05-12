/**
 * Connection-level token renewal for Tradovate BrokerConnections.
 *
 * Exported for use in syncTradovateConnection (and anywhere else that needs a
 * guaranteed-fresh token before making API calls on behalf of a connection).
 *
 * Why this exists — race condition in the cron:
 *   syncTradovateConnection syncs multiple accounts in parallel via
 *   Promise.allSettled. Each account's TradovateClient.initialize() checks
 *   token expiry and may attempt renewal independently. With N accounts on one
 *   BrokerConnection, N concurrent renewals race to write the same DB row.
 *
 *   ensureTradovateAccessToken solves this by renewing ONCE at the connection
 *   level before parallel account syncs begin. After renewal the token is
 *   fresh in the DB; every subsequent TradovateClient.initialize() for that
 *   connection sees shouldRenewToken → false and skips the renewal.
 *
 * Failure semantics:
 *   - auth_invalid (401, invalid_grant, no token returned):
 *       BrokerConnection.connectionStatus → "expired"
 *       all linked ConnectedAccount.connectionStatus → "expired"
 *       throws TradovateClientError so the caller skips syncing this connection
 *   - transient (network error, 5xx, 429, parse error):
 *       no DB state change — let the next cron attempt retry
 *       throws so the caller records the failure
 */

import { prisma } from "@/lib/db";
import { getTradovateConfig } from "./tradovate-env";
import { encryptAndSerialize, parseAndDecrypt } from "@/lib/security/token-crypto";
import {
  TradovateClientError,
  REFRESH_BUFFER_MS,
  shouldRenewToken,
  normalizeTokenResponse,
  classifyRenewalError,
  type TvTokenResponse,
} from "./tradovate-client-helpers";

export type EnsureTokenResult =
  | { renewed: false; tokenExpiresAt: Date | null }
  | { renewed: true; tokenExpiresAt: Date | null };

/**
 * Ensure the BrokerConnection has a valid, non-expiring-soon access token.
 *
 * - If the token is fresh (> REFRESH_BUFFER_MS until expiry): returns immediately.
 * - If expiring soon or expiry unknown: renews via GET /auth/renewAccessToken,
 *   falling back to POST /auth/oauthtoken with refresh_token grant.
 * - On auth_invalid failure: marks BrokerConnection + linked accounts expired.
 * - On transient failure: rethrows without mutating DB state.
 */
export async function ensureTradovateAccessToken({
  brokerConnectionId,
  userId,
}: {
  brokerConnectionId: string;
  userId: string;
}): Promise<EnsureTokenResult> {
  const bc = await prisma.brokerConnection.findFirst({
    where: { id: brokerConnectionId, userId },
    select: {
      id: true,
      env: true,
      connectionStatus: true,
      accessTokenEncrypted: true,
      refreshTokenEncrypted: true,
      tokenExpiresAt: true,
      lastRenewError: true,
    },
  });

  if (!bc) {
    throw new TradovateClientError("NO_TOKENS", "BrokerConnection not found.");
  }
  if (!bc.accessTokenEncrypted) {
    throw new TradovateClientError(
      "NO_TOKENS",
      "BrokerConnection has no stored access token.",
    );
  }

  const decision = shouldRenewToken({
    expiresAt: bc.tokenExpiresAt,
    now: new Date(),
    bufferMs: REFRESH_BUFFER_MS,
  });

  console.info("[tradovate/ensure-token] renewal decision", {
    brokerConnectionId,
    expiresAt: bc.tokenExpiresAt?.toISOString() ?? null,
    shouldRenew: decision.shouldRenew,
    reason: decision.reason,
    msUntilExpiry: decision.msUntilExpiry,
  });

  if (!decision.shouldRenew) {
    // The token is fresh — if a stale renewal error is stored, clear it
    // fire-and-forget so a DB hiccup here never blocks the sync path.
    if (bc.lastRenewError !== null) {
      prisma.brokerConnection
        .update({ where: { id: brokerConnectionId }, data: { lastRenewError: null } })
        .catch((e: unknown) => {
          console.warn("[tradovate/ensure-token] failed to clear stale lastRenewError", {
            brokerConnectionId,
            error: e instanceof Error ? e.message : String(e),
          });
        });
    }
    return { renewed: false, tokenExpiresAt: bc.tokenExpiresAt };
  }

  let accessToken: string;
  try {
    accessToken = parseAndDecrypt(bc.accessTokenEncrypted);
  } catch {
    throw new TradovateClientError(
      "TOKEN_LOAD_FAILED",
      "Failed to decrypt BrokerConnection access token.",
    );
  }

  let refreshToken: string | null = null;
  if (bc.refreshTokenEncrypted) {
    try {
      refreshToken = parseAndDecrypt(bc.refreshTokenEncrypted);
    } catch {
      console.warn(
        "[tradovate/ensure-token] refresh token decrypt failed — will rely on renewAccessToken only",
        { brokerConnectionId },
      );
    }
  }

  const cfgStatus = getTradovateConfig();
  if (cfgStatus.state !== "ready") {
    throw new TradovateClientError(
      "CONFIG_MISSING",
      "Tradovate is not configured on this server.",
    );
  }
  const { config } = cfgStatus;
  const env = bc.env as "demo" | "live";

  let renewUrl: string;
  try {
    renewUrl = new URL(config.tokenUrl[env]).origin + "/auth/renewAccessToken";
  } catch {
    renewUrl = config.tokenUrl[env].replace(/\/[^/]+$/, "/renewAccessToken");
  }

  // ── Attempt 1: GET /auth/renewAccessToken ──────────────────────────────────
  let firstError: unknown = null;
  try {
    const tokens = await callRenewEndpoint(renewUrl, accessToken);
    await persistRenewedTokens(brokerConnectionId, tokens, /* preserveRefreshToken */ true);
    console.info("[tradovate/ensure-token] token renewed via renewAccessToken", {
      brokerConnectionId,
      newExpiresAt: tokens.expiresAt?.toISOString() ?? null,
    });
    return { renewed: true, tokenExpiresAt: tokens.expiresAt };
  } catch (err) {
    firstError = err;
    const cls = classifyRenewalError({
      code: err instanceof TradovateClientError ? err.code : undefined,
      httpStatus:
        err instanceof TradovateClientError ? (err.statusCode ?? null) : null,
    });

    console.info("[tradovate/ensure-token] renewAccessToken attempt failed", {
      brokerConnectionId,
      class: cls,
      code: err instanceof TradovateClientError ? err.code : "unknown",
    });

    if (cls === "transient") {
      // Don't attempt OAuth grant for transient errors — it would burn the
      // refresh token unnecessarily and may trigger rate limits.
      throw err;
    }
    // auth_invalid or unknown: fall through to OAuth refresh_token grant
  }

  // ── Attempt 2: POST /auth/oauthtoken (refresh_token grant) ────────────────
  if (!refreshToken) {
    // No refresh token available and renewAccessToken already failed.
    await markExpiredWithAccounts(
      brokerConnectionId,
      "Access token renewal rejected by Tradovate and no refresh token is stored. Re-authorize to reconnect.",
    );
    throw (
      firstError ??
      new TradovateClientError(
        "TOKEN_EXPIRED_NO_REFRESH",
        "Token renewal failed and no refresh token is available.",
      )
    );
  }

  try {
    const tokens = await callOAuthRefreshGrant(
      config.tokenUrl[env],
      refreshToken,
      config.clientId,
      config.clientSecret,
    );
    await persistRenewedTokens(
      brokerConnectionId,
      tokens,
      /* preserveRefreshToken */ tokens.refreshToken === null,
    );
    console.info("[tradovate/ensure-token] token renewed via OAuth grant", {
      brokerConnectionId,
      newExpiresAt: tokens.expiresAt?.toISOString() ?? null,
    });
    return { renewed: true, tokenExpiresAt: tokens.expiresAt };
  } catch (err) {
    const cls = classifyRenewalError({
      code: err instanceof TradovateClientError ? err.code : undefined,
      httpStatus:
        err instanceof TradovateClientError ? (err.statusCode ?? null) : null,
    });

    if (cls === "auth_invalid") {
      await markExpiredWithAccounts(
        brokerConnectionId,
        "Tradovate rejected the OAuth refresh_token grant. Re-authorize to reconnect.",
      );
    }
    throw err;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function callRenewEndpoint(
  renewUrl: string,
  accessToken: string,
): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: Date | null }> {
  let res: Response;
  try {
    res = await fetch(renewUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
  } catch {
    throw new TradovateClientError("NETWORK_ERROR", "Network error during renewAccessToken.");
  }

  if (!res.ok) {
    throw new TradovateClientError(
      "REFRESH_FAILED",
      `renewAccessToken returned HTTP ${res.status}.`,
      res.status,
    );
  }

  let raw: TvTokenResponse;
  try {
    raw = (await res.json()) as TvTokenResponse;
  } catch {
    throw new TradovateClientError(
      "PARSE_ERROR",
      "Could not parse renewAccessToken response.",
    );
  }

  const tokens = normalizeTokenResponse(raw);
  if (!tokens.accessToken) {
    throw new TradovateClientError(
      "REFRESH_NO_ACCESS_TOKEN",
      "Tradovate did not return a renewed access token.",
    );
  }
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
  };
}

async function callOAuthRefreshGrant(
  tokenUrl: string,
  refreshToken: string,
  clientId: string,
  clientSecret: string,
): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: Date | null }> {
  let res: Response;
  try {
    res = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
  } catch {
    throw new TradovateClientError("NETWORK_ERROR", "Network error during OAuth refresh grant.");
  }

  if (!res.ok) {
    throw new TradovateClientError(
      "REFRESH_FAILED",
      `OAuth refresh grant returned HTTP ${res.status}.`,
      res.status,
    );
  }

  let raw: TvTokenResponse;
  try {
    raw = (await res.json()) as TvTokenResponse;
  } catch {
    throw new TradovateClientError(
      "PARSE_ERROR",
      "Could not parse OAuth refresh grant response.",
    );
  }

  const tokens = normalizeTokenResponse(raw);
  if (!tokens.accessToken) {
    throw new TradovateClientError(
      "REFRESH_NO_ACCESS_TOKEN",
      "OAuth refresh grant did not return an access token.",
    );
  }
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
  };
}

async function persistRenewedTokens(
  brokerConnectionId: string,
  tokens: { accessToken: string; refreshToken: string | null; expiresAt: Date | null },
  preserveRefreshToken: boolean,
): Promise<void> {
  const now = new Date();
  const data: Parameters<typeof prisma.brokerConnection.update>[0]["data"] = {
    accessTokenEncrypted: encryptAndSerialize(tokens.accessToken),
    tokenExpiresAt: tokens.expiresAt,
    errorMessage: null,
    lastRenewedAt: now,
    lastRenewError: null,
    // connectionStatus is NOT changed: preserves connected_live status.
    // The permission probe is solely responsible for live ↔ readonly transitions.
  };
  if (!preserveRefreshToken && tokens.refreshToken) {
    data.refreshTokenEncrypted = encryptAndSerialize(tokens.refreshToken);
  }
  await prisma.brokerConnection.update({
    where: { id: brokerConnectionId },
    data,
  });

  // Heal linked accounts that are stuck at "expired" from a prior cascade. The
  // BC is still connected (connectionStatus unchanged), so any account rows
  // that were individually expired are now stale. Cascade to connected_readonly;
  // the permission probe will upgrade to connected_live if warranted.
  await prisma.connectedAccount.updateMany({
    where: {
      brokerConnectionId,
      connectionStatus: "expired",
      missingFromBrokerSince: null,
    },
    data: { connectionStatus: "connected_readonly", errorMessage: null },
  });
}

async function markExpiredWithAccounts(
  brokerConnectionId: string,
  reason: string,
): Promise<void> {
  await prisma.brokerConnection.update({
    where: { id: brokerConnectionId },
    data: { connectionStatus: "expired", errorMessage: reason, lastRenewError: reason },
  });
  await prisma.connectedAccount.updateMany({
    where: { brokerConnectionId },
    data: { connectionStatus: "expired" },
  });
  console.warn("[tradovate/ensure-token] connection marked expired", {
    brokerConnectionId,
    reason,
  });
}
