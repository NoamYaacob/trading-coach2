import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { validateEnv } from "@/lib/env";

export async function GET() {
  const envReport = validateEnv();

  let dbStatus: "ok" | "unreachable" = "unreachable";
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = "ok";
  } catch {
    // db not reachable — status stays "unreachable"
  }

  const ok = dbStatus === "ok";

  return NextResponse.json(
    {
      ok,
      env: envReport.ok ? "ok" : "missing_vars",
      ...(envReport.missing.length ? { missing: envReport.missing } : {}),
      ...(envReport.warnings.length ? { warnings: envReport.warnings } : {}),
      db: dbStatus,
    },
    { status: ok ? 200 : 503 },
  );
}
