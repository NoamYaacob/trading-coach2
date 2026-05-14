import { NextResponse } from "next/server";

import { getCurrentUser, hashPassword, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/db";

const PASSWORD_RULES = /^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{8,}$/;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { newPassword?: string };

  if (!body.newPassword) {
    return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  }

  if (!PASSWORD_RULES.test(body.newPassword)) {
    return NextResponse.json(
      { error: "New password does not meet requirements." },
      { status: 400 },
    );
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });

  if (dbUser?.passwordHash) {
    return NextResponse.json(
      { error: "Account already has a password. Use PATCH to change it." },
      { status: 400 },
    );
  }

  const newHash = await hashPassword(body.newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash },
  });

  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    currentPassword?: string;
    newPassword?: string;
  };

  if (!body.currentPassword || !body.newPassword) {
    return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  }

  if (!PASSWORD_RULES.test(body.newPassword)) {
    return NextResponse.json(
      { error: "New password does not meet requirements." },
      { status: 400 },
    );
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });

  if (!dbUser?.passwordHash) {
    return NextResponse.json(
      { error: "No password set for this account." },
      { status: 400 },
    );
  }

  const valid = await verifyPassword(body.currentPassword, dbUser.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  }

  const newHash = await hashPassword(body.newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: newHash },
  });

  return NextResponse.json({ ok: true });
}
