import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { validateEnv } from "@/lib/env";
import { isTokenEncryptionKeyValid } from "@/lib/security/token-crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  const envReport = validateEnv();

  // Token encryption key check — does not expose the key value.
  const tokenCrypto = isTokenEncryptionKeyValid() ? "ok" : "missing_or_invalid";
  if (tokenCrypto !== "ok") {
    envReport.warnings.push(
      "TRADOVATE_TOKEN_ENCRYPTION_KEY is missing or not a valid 32-byte base64 key — " +
        "Tradovate token storage will fail at runtime.",
    );
  }

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
      commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? "unknown",
      env: envReport.ok ? "ok" : "missing_vars",
      ...(envReport.missing.length ? { missing: envReport.missing } : {}),
      ...(envReport.warnings.length ? { warnings: envReport.warnings } : {}),
      db: dbStatus,
      tokenCrypto,
    },
    { status: 200 },
  );
}
