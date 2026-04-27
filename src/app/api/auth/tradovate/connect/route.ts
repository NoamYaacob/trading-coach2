import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";

import { getCurrentUser } from "@/lib/auth";
import { getTradovateConfig } from "@/lib/brokers/tradovate-env";
import {
  encodeOAuthState,
  generateOAuthNonce,
} from "@/lib/brokers/tradovate-oauth-state";
import { checkRateLimit } from "@/lib/rate-limit";

const OAUTH_STATE_COOKIE = "tradovate_oauth_state";

export async function GET(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connectLimit = checkRateLimit(`tradovate_connect:${currentUser.id}`, 5, 3_600_000);
  if (!connectLimit.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "Retry-After": String(connectLimit.retryAfterSeconds) } },
    );
  }

  const status = getTradovateConfig();

  // Until ALL required env vars are present (including the token-encryption
  // key), do not start OAuth. Otherwise a successful authorization at
  // Tradovate would leave us with tokens we cannot store securely — that
  // is exactly the kind of "fake connected" state we promised never to
  // ship.
  if (status.state !== "ready") {
    return NextResponse.json(
      {
        error: "oauth_not_configured",
        missing: status.missing,
      },
      { status: 503 },
    );
  }

  const { config } = status;

  const env = request.nextUrl.searchParams.get("env") === "demo" ? "demo" : "live";
  // Prefer the explicit override; otherwise derive the redirect from the
  // incoming request URL so it matches whatever origin Railway routes here.
  const redirectUri =
    config.redirectUriOverride ??
    new URL("/api/auth/tradovate/callback", request.url).toString();

  // State encodes enough context to resume after the callback without a DB
  // round-trip plus a random nonce for CSRF.
  const nonce = generateOAuthNonce();
  const state = encodeOAuthState({
    nonce,
    userId: currentUser.id,
    env,
  });

  // Persist nonce in an httpOnly cookie so the callback can verify CSRF.
  const cookieStore = await cookies();
  cookieStore.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/tradovate/callback",
    maxAge: 60 * 10, // 10-minute window
  });

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    // Request only the read-only scope. Destructive actions (cancel,
    // flatten, lockout) require separate scopes that we will not request
    // until the broker integration plan reaches the relevant phase.
    scope: "read",
    state,
  });

  const authUrl = `${config.authUrl[env]}?${params.toString()}`;
  return NextResponse.redirect(authUrl);
}
