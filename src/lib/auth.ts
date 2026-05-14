import { createHash, randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";

import { prisma } from "@/lib/db";

const SESSION_COOKIE_NAME = "trading-coach-session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
// TODO(future): "Log out from all devices" — expose prisma.session.deleteMany({ where: { userId } })
//               as an authenticated API route so users can invalidate all their own sessions.

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await prisma.session.deleteMany({
      where: { tokenHash: hashSessionToken(token) },
    });
  }

  cookieStore.delete(SESSION_COOKIE_NAME);
}

// ── Password reset tokens ──────────────────────────────────────────────────

const RESET_TOKEN_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createPasswordResetToken(
  userId: string,
  requestedIp?: string,
  userAgent?: string,
): Promise<string> {
  // Invalidate any existing unused tokens for this user
  await prisma.passwordResetToken.updateMany({
    where: { userId, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = randomBytes(32).toString("hex");
  const tokenHash = hashResetToken(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MS);

  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
      requestedIp: requestedIp ?? null,
      userAgent: userAgent ?? null,
    },
  });

  return token;
}

type ValidTokenResult =
  | { valid: true; userId: string; tokenId: string }
  | { valid: false };

export async function validatePasswordResetToken(
  token: string,
): Promise<ValidTokenResult> {
  const tokenHash = hashResetToken(token);

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!record) return { valid: false };
  if (record.usedAt !== null) return { valid: false };
  if (record.expiresAt < new Date()) return { valid: false };

  return { valid: true, userId: record.userId, tokenId: record.id };
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          subscriptionStatus: true,
          trialStartedAt: true,
          trialEndsAt: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!session || session.expiresAt < new Date()) {
    cookieStore.delete(SESSION_COOKIE_NAME);

    if (session) {
      await prisma.session.delete({
        where: { id: session.id },
      });
    }

    return null;
  }

  return session.user;
}
