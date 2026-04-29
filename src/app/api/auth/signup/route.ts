import { UserRole, SubscriptionStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { createSession, hashPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTrialDates } from "@/lib/trial";
import { checkRateLimit, getRequestIp } from "@/lib/rate-limit";

type SignupRequest = {
  email?: string;
  password?: string;
};

export async function POST(request: Request) {
  const ip = getRequestIp(request);
  const limit = checkRateLimit(`signup:hr:${ip}`, 3, 3_600_000);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "too_many_requests" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const body = (await request.json()) as SignupRequest;
  const email = body.email?.trim().toLowerCase();
  const password = body.password?.trim();

  if (!email || !password) {
    return NextResponse.json(
      { error: "email and password are required" },
      { status: 400 },
    );
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: "password must be at least 8 characters" },
      { status: 400 },
    );
  }

  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });

  if (existingUser) {
    return NextResponse.json(
      { error: "an account with this email already exists" },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(password);
  const { trialStartedAt, trialEndsAt } = getTrialDates();

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: UserRole.USER,
      subscriptionStatus: SubscriptionStatus.TRIALING,
      trialStartedAt,
      trialEndsAt,
    },
    select: {
      id: true,
      email: true,
      role: true,
      subscriptionStatus: true,
      trialStartedAt: true,
      trialEndsAt: true,
    },
  });

  await createSession(user.id);

  return NextResponse.json({
    ok: true,
    redirectTo: "/onboarding/profile",
    user,
  });
}
