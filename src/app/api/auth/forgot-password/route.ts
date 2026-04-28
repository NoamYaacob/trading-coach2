import { type NextRequest, NextResponse } from "next/server";

import { createPasswordResetToken } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { EmailNotSentError, sendPasswordResetEmail } from "@/lib/email";
import { checkRateLimit, getRequestIp } from "@/lib/rate-limit";

// Always return the same message whether or not the email exists.
const GENERIC_SUCCESS = {
  message: "If an account exists for that email, we'll send a reset link.",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  const ip = getRequestIp(request);

  // 5 requests per 15 minutes per IP
  const ipLimit = checkRateLimit(`forgot:ip:${ip}`, 5, 15 * 60_000);
  if (!ipLimit.ok) {
    // Return generic success — do not reveal rate-limit state
    return NextResponse.json(GENERIC_SUCCESS);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(GENERIC_SUCCESS);
  }

  const raw = typeof (body as Record<string, unknown>).email === "string"
    ? (body as Record<string, unknown>).email as string
    : "";
  const email = raw.trim().toLowerCase();

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json(GENERIC_SUCCESS);
  }

  // 3 requests per hour per normalised email
  const emailLimit = checkRateLimit(`forgot:email:${email}`, 3, 3_600_000);
  if (!emailLimit.ok) {
    return NextResponse.json(GENERIC_SUCCESS);
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true },
    });

    // Only send reset emails for password-based accounts; still return generic
    // success for OAuth-only accounts to avoid leaking account existence.
    if (user?.passwordHash) {
      const userAgent = request.headers.get("user-agent") ?? undefined;
      const token = await createPasswordResetToken(user.id, ip, userAgent);
      await sendPasswordResetEmail({ to: user.email, token });
    }
  } catch (err: unknown) {
    if (!(err instanceof EmailNotSentError)) {
      // EmailNotSentError is already logged inside sendPasswordResetEmail.
      // Log unexpected errors (DB failures, etc.) without exposing them to the client.
      console.error(
        "[forgot-password] Internal error:",
        err instanceof Error ? err.message : "unknown error",
      );
    }
  }

  return NextResponse.json(GENERIC_SUCCESS);
}
