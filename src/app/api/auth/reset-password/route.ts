import { type NextRequest, NextResponse } from "next/server";

import { hashPassword, validatePasswordResetToken } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { checkRateLimit, getRequestIp } from "@/lib/rate-limit";

const INVALID_LINK = {
  error: "This reset link is invalid or has expired. Request a new one.",
};

// Same rules as signup (length, upper, lower, digit, special).
function passwordMeetsPolicy(pw: string): boolean {
  return (
    pw.length >= 8 &&
    /[A-Z]/.test(pw) &&
    /[a-z]/.test(pw) &&
    /[0-9]/.test(pw) &&
    /[^A-Za-z0-9]/.test(pw)
  );
}

export async function POST(request: NextRequest) {
  const ip = getRequestIp(request);

  // 5 attempts per hour per IP — prevents token brute-forcing
  const limit = checkRateLimit(`reset:ip:${ip}`, 5, 3_600_000);
  if (!limit.ok) {
    return NextResponse.json(INVALID_LINK, {
      status: 429,
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(INVALID_LINK, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const token = typeof b.token === "string" ? b.token.trim() : null;
  const password = typeof b.password === "string" ? b.password : null;
  const confirmPassword = typeof b.confirmPassword === "string" ? b.confirmPassword : null;

  if (!token) {
    return NextResponse.json(INVALID_LINK, { status: 400 });
  }

  if (!password || !confirmPassword) {
    return NextResponse.json(
      { error: "Password and confirmation are required." },
      { status: 400 },
    );
  }

  if (password !== confirmPassword) {
    return NextResponse.json({ error: "Passwords do not match." }, { status: 400 });
  }

  if (!passwordMeetsPolicy(password)) {
    return NextResponse.json(
      {
        error:
          "Password must be at least 8 characters and include an uppercase letter, lowercase letter, number, and special character.",
      },
      { status: 400 },
    );
  }

  const result = await validatePasswordResetToken(token);
  if (!result.valid) {
    return NextResponse.json(INVALID_LINK, { status: 400 });
  }

  const newHash = await hashPassword(password);

  // Update password, mark token used, and invalidate all existing sessions
  // atomically so the old credentials can never be used after this point.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: result.userId },
      data: { passwordHash: newHash },
    }),
    prisma.passwordResetToken.update({
      where: { id: result.tokenId },
      data: { usedAt: new Date() },
    }),
    prisma.session.deleteMany({ where: { userId: result.userId } }),
  ]);

  return NextResponse.json({ message: "Password updated. You can log in now." });
}
