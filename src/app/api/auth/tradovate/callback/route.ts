import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";
import { getTradovateConfig } from "@/lib/brokers/tradovate-env";

const OAUTH_STATE_COOKIE = "tradovate_oauth_state";

type StatePayload = {
  nonce: string;
  userId: string;
  env: "live" | "demo";
};

function backToConnectPage(request: NextRequest, error: string) {
  return NextResponse.redirect(
    new URL(
      `/accounts/connect/tradovate?oauth_error=${encodeURIComponent(error)}`,
      request.url,
    ),
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // User denied the OAuth consent or Tradovate returned an error.
  if (error) return backToConnectPage(request, error);

  if (!code || !state) {
    return backToConnectPage(request, "missing_params");
  }

  // Decode and validate state.
  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(state, "base64url").toString()) as StatePayload;
  } catch {
    return backToConnectPage(request, "invalid_state");
  }

  // CSRF check: nonce must match the cookie set in the connect route.
  const cookieStore = await cookies();
  const storedNonce = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(OAUTH_STATE_COOKIE);

  if (!storedNonce || storedNonce !== payload.nonce) {
    return backToConnectPage(request, "csrf_mismatch");
  }

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
      const errText = await tokenRes.text();
      console.error("[tradovate/callback] token exchange failed:", errText);
      return backToConnectPage(request, "token_exchange_failed");
    }

    tokenData = (await tokenRes.json()) as typeof tokenData;
  } catch (err) {
    console.error("[tradovate/callback] token exchange error:", err);
    return backToConnectPage(request, "token_exchange_error");
  }

  // ── Persist the connection (without raw tokens) ────────────────────────
  // We deliberately do NOT write tokenData.access_token or refresh_token to
  // the database. Plaintext token persistence is forbidden until the
  // encryption layer ships. Instead we record:
  //   - externalAccountId (safe to store)
  //   - connectionStatus = "oauth_pending_storage"
  //   - errorMessage explaining why this connection cannot read API data
  //     yet, so the UI surfaces it clearly.
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
    connectionStatus: "oauth_pending_storage",
    connectedAt: null,
    errorMessage:
      "OAuth verified. Read pipeline is not yet enabled — token storage encryption is pending.",
    accessTokenEncrypted: null,
    refreshTokenEncrypted: null,
    tokenExpiresAt: null,
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
