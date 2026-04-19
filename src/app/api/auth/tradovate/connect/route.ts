import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";

import { getCurrentUser } from "@/lib/auth";

// Tradovate OAuth authorization endpoints.
// Live: https://live.tradovate.com/oauth/authorize
// Demo: https://demo.tradovate.com/oauth/authorize
const TRADOVATE_AUTH_URL = {
  live: "https://live.tradovate.com/oauth/authorize",
  demo: "https://demo.tradovate.com/oauth/authorize",
};

const OAUTH_STATE_COOKIE = "tradovate_oauth_state";

export async function GET(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const clientId = process.env.TRADOVATE_CLIENT_ID;

  if (!clientId) {
    // OAuth not configured — caller should surface the manual setup path instead.
    return NextResponse.json(
      { error: "oauth_not_configured" },
      { status: 503 },
    );
  }

  const env = request.nextUrl.searchParams.get("env") === "demo" ? "demo" : "live";
  // Derive the callback URL from the incoming request — no env var needed and
  // it's guaranteed to match the origin Railway routes traffic to.
  const redirectUri = new URL("/api/auth/tradovate/callback", request.url).toString();

  // State encodes enough context to resume after the callback without a DB round-trip,
  // plus a random nonce for CSRF protection.
  const nonce = randomBytes(16).toString("hex");
  const statePayload = {
    nonce,
    userId: currentUser.id,
    env,
  };
  const state = Buffer.from(JSON.stringify(statePayload)).toString("base64url");

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
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "trading",
    state,
  });

  const authUrl = `${TRADOVATE_AUTH_URL[env]}?${params.toString()}`;
  return NextResponse.redirect(authUrl);
}
