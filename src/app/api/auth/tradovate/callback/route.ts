import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTradovateConfig } from "@/lib/brokers/tradovate-env";
import { validateOAuthState } from "@/lib/brokers/tradovate-oauth-state";
import { encryptAndSerialize, TokenCryptoError } from "@/lib/security/token-crypto";
import { checkRateLimit } from "@/lib/rate-limit";

const OAUTH_STATE_COOKIE = "tradovate_oauth_state";

function backToConnectPage(request: NextRequest, error: string) {
  return NextResponse.redirect(
    new URL(
      `/accounts/connect/tradovate?oauth_error=${encodeURIComponent(error)}`,
      request.url,
    ),
  );
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

  // CSRF check + session binding live in one helper. The state is
  // base64-encoded but not signed, so a tampered userId would still
  // pass the nonce check — `validateOAuthState` also requires that
  // `state.userId === session.userId`.
  const cookieStore = await cookies();
  const storedNonce = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(OAUTH_STATE_COOKIE);

  const validation = validateOAuthState({
    rawState: state,
    cookieNonce: storedNonce,
    sessionUserId: currentUser.id,
  });
  if (!validation.ok) {
    return backToConnectPage(request, validation.reason);
  }
  const payload = validation.state!;

  // Re-validate config — env may have changed between connect and callback,
  // and we never want to accept tokens we cannot store securely.
  const status = getTradovateConfig();
  if (status.state !== "ready") {
    return backToConnectPage(request, "oauth_not_configured");
  }
  const { config } = status;

  // Derive the same redirect_uri used in the connect route — must match
  // exactly or Tradovate will reject the exchange.
  const redirectUri =
    config.redirectUriOverride ??
    new URL("/api/auth/tradovate/callback", request.url).toString();

  // ── Token exchange ─────────────────────────────────────────────────────
  // Performs a real POST to Tradovate's token endpoint. On success we
  // receive an access token + refresh token. We do NOT persist them yet —
  // the encryption layer will land alongside the read API integration.
  // Until then, OAuth proves the credential pipeline works end-to-end and
  // we record the connection state explicitly as "oauth_pending_storage".
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
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }).toString(),
    });

    if (!tokenRes.ok) {
      // Log status only — the response body can echo back partial
      // tokens or sensitive diagnostics from the IdP. Read it to
      // drain the stream but do not write it to logs.
      await tokenRes.text().catch(() => "");
      console.error(
        `[tradovate/callback] token exchange failed: HTTP ${tokenRes.status}`,
      );
      return backToConnectPage(request, "token_exchange_failed");
    }

    tokenData = (await tokenRes.json()) as typeof tokenData;
  } catch (err) {
    // Log error name only; never log the error object (may contain
    // request body / response text from fetch).
    const name = err instanceof Error ? err.name : "unknown";
    console.error(`[tradovate/callback] token exchange error: ${name}`);
    return backToConnectPage(request, "token_exchange_error");
  }

  // ── Encrypt tokens before persisting ───────────────────────────────────
  // Plaintext tokens MUST never reach the database. encryptAndSerialize
  // returns a JSON-serialised AES-256-GCM payload safe to store in TEXT.
  // The encryption module also re-validates the master key — if it has
  // gone missing between the connect step and now, this throws and we
  // bail out without writing anything.
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
    // Log the error code only; never log the token plaintext.
    const code = err instanceof TokenCryptoError ? err.code : "unknown";
    console.error(`[tradovate/callback] token encryption failed: ${code}`);
    return backToConnectPage(request, "token_storage_failed");
  }

  // ── Persist the connection ─────────────────────────────────────────────
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
    // OAuth completed and tokens are encrypted in storage. The read
    // pipeline (account / positions / orders / executions) is NOT yet
    // implemented — flipping to "connected_live" is reserved for after
    // the first successful broker read.
    connectionStatus: "connected_readonly",
    connectedAt: new Date(),
    errorMessage: null,
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

  // Land back on the connect page with a clear "OAuth verified" banner.
  // Sending the user to /accounts/[id]/edit?oauth=connected (the old
  // behaviour) would be misleading — there is nothing to read or do on
  // that connection until the read pipeline ships.
  return NextResponse.redirect(
    new URL(
      `/accounts/connect/tradovate?oauth=verified&account=${account.id}`,
      request.url,
    ),
  );
}
