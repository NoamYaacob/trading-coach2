import { NextResponse } from "next/server";

import { createSession, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";

type LoginRequest = {
  email?: string;
  password?: string;
};

export async function POST(request: Request) {
  const body = (await request.json()) as LoginRequest;
  const email = body.email?.trim().toLowerCase();
  const password = body.password?.trim();

  if (!email || !password) {
    return NextResponse.json(
      { error: "email and password are required" },
      { status: 400 },
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      passwordHash: true,
      role: true,
      subscriptionStatus: true,
      trialStartedAt: true,
      trialEndsAt: true,
    },
  });

  if (!user?.passwordHash) {
    return NextResponse.json(
      { error: "invalid email or password" },
      { status: 401 },
    );
  }

  const isValidPassword = await verifyPassword(password, user.passwordHash);

  if (!isValidPassword) {
    return NextResponse.json(
      { error: "invalid email or password" },
      { status: 401 },
    );
  }

  await createSession(user.id);

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      subscriptionStatus: user.subscriptionStatus,
      trialStartedAt: user.trialStartedAt,
      trialEndsAt: user.trialEndsAt,
    },
  });
}
