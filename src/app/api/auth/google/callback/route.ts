import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";

import { createSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOnboardingRedirect } from "@/lib/onboarding";
import { getTrialDates } from "@/lib/trial";
import { getAppBaseUrl } from "@/lib/app-url";
import { GOOGLE_OAUTH_STATE_COOKIE } from "../connect/route";

type StatePayload = {
  nonce: string;
  mode: "auth" | "connect";
  userId: string | null;
};

type GoogleUserInfo = {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
};

function errorRedirect(request: NextRequest, mode: string, code: string) {
  const dest = mode === "connect" ? `/settings?oauth_error=${code}` : `/login?oauth_error=${code}`;
  return NextResponse.redirect(`${getAppBaseUrl(request)}${dest}`);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const rawState = searchParams.get("state");
  const oauthError = searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(`${getAppBaseUrl(request)}/login?oauth_error=${encodeURIComponent(oauthError)}`);
  }

  if (!code || !rawState) {
    return NextResponse.redirect(`${getAppBaseUrl(request)}/login?oauth_error=missing_params`);
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(rawState, "base64url").toString()) as StatePayload;
  } catch {
    return NextResponse.redirect(`${getAppBaseUrl(request)}/login?oauth_error=invalid_state`);
  }

  const { mode = "auth" } = payload;

  // CSRF verification
  const cookieStore = await cookies();
  const storedNonce = cookieStore.get(GOOGLE_OAUTH_STATE_COOKIE)?.value;
  cookieStore.delete(GOOGLE_OAUTH_STATE_COOKIE);

  if (!storedNonce || storedNonce !== payload.nonce) {
    return errorRedirect(request, mode, "csrf_mismatch");
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return errorRedirect(request, mode, "google_not_configured");
  }

  // Exchange authorization code for tokens — must match the value sent in the connect route exactly.
  const redirectUri = `${getAppBaseUrl(request)}/api/auth/google/callback`;
  let accessToken: string;
  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
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
    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.error ?? "token_exchange_failed");
    }
    accessToken = tokenData.access_token;
  } catch {
    return errorRedirect(request, mode, "token_exchange_failed");
  }

  // Fetch verified user profile from Google
  let googleUser: GoogleUserInfo;
  try {
    const infoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = (await infoRes.json()) as GoogleUserInfo;
    if (!data.sub || !data.email) throw new Error("missing_user_info");
    googleUser = data;
  } catch {
    return errorRedirect(request, mode, "userinfo_failed");
  }

  // ── Connect mode: add Google to an existing signed-in account ─────────────
  if (mode === "connect" && payload.userId) {
    const existing = await prisma.oAuthConnection.findUnique({
      where: { provider_providerAccountId: { provider: "google", providerAccountId: googleUser.sub } },
    });

    if (existing && existing.userId !== payload.userId) {
      return errorRedirect(request, mode, "google_already_linked_to_another_account");
    }

    await prisma.oAuthConnection.upsert({
      where: { provider_providerAccountId: { provider: "google", providerAccountId: googleUser.sub } },
      create: {
        userId: payload.userId,
        provider: "google",
        providerAccountId: googleUser.sub,
        email: googleUser.email,
        displayName: googleUser.name ?? null,
      },
      update: { email: googleUser.email, displayName: googleUser.name ?? null },
    });

    return NextResponse.redirect(`${getAppBaseUrl(request)}/settings?google_connected=1`);
  }

  // ── Auth mode: sign in or sign up ─────────────────────────────────────────
  const existingConn = await prisma.oAuthConnection.findUnique({
    where: { provider_providerAccountId: { provider: "google", providerAccountId: googleUser.sub } },
    select: { userId: true },
  });

  let userId: string;

  if (existingConn) {
    // Returning Google user — sign in
    userId = existingConn.userId;
    await prisma.oAuthConnection.update({
      where: { provider_providerAccountId: { provider: "google", providerAccountId: googleUser.sub } },
      data: { email: googleUser.email, displayName: googleUser.name ?? null },
    });
  } else {
    // New Google user — find by email or create account
    const existingUser = await prisma.user.findUnique({
      where: { email: googleUser.email },
      select: { id: true },
    });

    if (existingUser) {
      userId = existingUser.id;
    } else {
      const { trialStartedAt, trialEndsAt } = getTrialDates();
      const newUser = await prisma.user.create({
        data: {
          email: googleUser.email,
          passwordHash: null,
          role: "USER",
          subscriptionStatus: "TRIALING",
          trialStartedAt,
          trialEndsAt,
        },
        select: { id: true },
      });
      userId = newUser.id;
    }

    await prisma.oAuthConnection.create({
      data: {
        userId,
        provider: "google",
        providerAccountId: googleUser.sub,
        email: googleUser.email,
        displayName: googleUser.name ?? null,
      },
    });
  }

  await createSession(userId);

  const redirectPath = await getOnboardingRedirect(userId);
  return NextResponse.redirect(`${getAppBaseUrl(request)}${redirectPath}`);
}
