import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { validateEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const envReport = validateEnv();

  // DB ping is best-effort — a slow or temporarily unreachable DB must not
  // cause Railway to mark the deploy as failed. The app is "up" as soon as
  // Next.js is listening; Railway only needs 200 to pass the healthcheck.
  let dbStatus: "ok" | "unreachable" = "unreachable";
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`.then(() => { dbStatus = "ok"; }),
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
    ]);
  } catch {
    // DB unreachable or timed out — informational only
  }

  return NextResponse.json(
    {
      ok: true,
      env: envReport.ok ? "ok" : "missing_vars",
      ...(envReport.missing.length ? { missing: envReport.missing } : {}),
      ...(envReport.warnings.length ? { warnings: envReport.warnings } : {}),
      db: dbStatus,
    },
    { status: 200 },
  );
}
