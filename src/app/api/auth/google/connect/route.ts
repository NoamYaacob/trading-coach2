import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";

import { getCurrentUser } from "@/lib/auth";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_OAUTH_STATE_COOKIE = "google_oauth_state";

export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode") === "connect" ? "connect" : "auth";

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    const dest = mode === "connect" ? "/settings?oauth_error=google_not_configured" : "/login?oauth_error=google_not_configured";
    return NextResponse.redirect(new URL(dest, request.url));
  }

  // "connect" mode requires an active session (linking Google to an existing account).
  let userId: string | null = null;
  if (mode === "connect") {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    userId = currentUser.id;
  }

  const nonce = randomBytes(16).toString("hex");
  const state = Buffer.from(JSON.stringify({ nonce, mode, userId })).toString("base64url");

  const cookieStore = await cookies();
  cookieStore.set(GOOGLE_OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/google/callback",
    maxAge: 60 * 10,
  });

  const redirectUri = new URL("/api/auth/google/callback", request.url).toString();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });

  return NextResponse.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
}
