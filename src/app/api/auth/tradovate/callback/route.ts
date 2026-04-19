import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";

// Tradovate OAuth token exchange endpoints.
// These are the real endpoints — token exchange requires TRADOVATE_CLIENT_SECRET.
const TRADOVATE_TOKEN_URL = {
  live: "https://live.tradovate.com/oauth/token",
  demo: "https://demo.tradovate.com/oauth/token",
};

const OAUTH_STATE_COOKIE = "tradovate_oauth_state";

type StatePayload = {
  nonce: string;
  userId: string;
  env: "live" | "demo";
};

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // User denied the OAuth consent.
  if (error) {
    return NextResponse.redirect(
      new URL(`/accounts/connect/tradovate?oauth_error=${encodeURIComponent(error)}`, request.url),
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/accounts/connect/tradovate?oauth_error=missing_params", request.url));
  }

  // Decode and validate state.
  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(state, "base64url").toString()) as StatePayload;
  } catch {
    return NextResponse.redirect(new URL("/accounts/connect/tradovate?oauth_error=invalid_state", request.url));
  }

  // CSRF check: nonce must match the cookie set in the connect route.
  const cookieStore = await cookies();
  const storedNonce = cookieStore.get(OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(OAUTH_STATE_COOKIE);

  if (!storedNonce || storedNonce !== payload.nonce) {
    return NextResponse.redirect(new URL("/accounts/connect/tradovate?oauth_error=csrf_mismatch", request.url));
  }

  const clientId = process.env.TRADOVATE_CLIENT_ID;
  const clientSecret = process.env.TRADOVATE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(
      new URL("/accounts/connect/tradovate?oauth_error=oauth_not_configured", request.url),
    );
  }

  // -----------------------------------------------------------------------
  // Token exchange
  // POST to Tradovate's token endpoint with the authorization code.
  // On success, Tradovate returns access_token, refresh_token, and account info.
  // -----------------------------------------------------------------------
  // Derive the same redirect_uri used in the connect route — must match exactly.
  const redirectUri = new URL("/api/auth/tradovate/callback", request.url).toString();

  let tokenData: {
    access_token: string;
    refresh_token?: string;
    account_id?: string | number;
    expires_in?: number;
  };

  try {
    const tokenRes = await fetch(TRADOVATE_TOKEN_URL[payload.env], {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      console.error("[tradovate/callback] token exchange failed:", errText);
      return NextResponse.redirect(
        new URL("/accounts/connect/tradovate?oauth_error=token_exchange_failed", request.url),
      );
    }

    tokenData = (await tokenRes.json()) as typeof tokenData;
  } catch (err) {
    console.error("[tradovate/callback] token exchange error:", err);
    return NextResponse.redirect(
      new URL("/accounts/connect/tradovate?oauth_error=token_exchange_error", request.url),
    );
  }

  // -----------------------------------------------------------------------
  // Upsert the connected account.
  // We have an access token and, if Tradovate includes it in the token
  // response, the broker-side account ID. Create a pending_webhook account
  // so the user can set their guardian rules before their first live trade.
  // -----------------------------------------------------------------------
  const externalAccountId = tokenData.account_id ? String(tokenData.account_id) : null;

  const account = await prisma.connectedAccount.create({
    data: {
      userId: payload.userId,
      label: `Tradovate ${payload.env === "demo" ? "Demo" : "Live"}`,
      platform: "tradovate",
      propFirm: null,
      accountType: payload.env === "demo" ? "demo" : "funded",
      externalAccountId,
      currency: "USD",
      isActive: true,
      connectionStatus: externalAccountId ? "pending_webhook" : "not_connected",
      brokerUserId: null,
    },
    select: { id: true },
  });

  // Redirect to the edit/manage page so the user can set guardian rules and
  // see the connection readiness panel. Query param signals OAuth success for
  // a one-time banner.
  return NextResponse.redirect(
    new URL(`/accounts/${account.id}/edit?oauth=connected`, request.url),
  );
}
