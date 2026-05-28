import { NextResponse } from "next/server";

import { buildVersionInfo } from "./version-info";

export const dynamic = "force-dynamic";

/**
 * GET /api/version
 *
 * Returns build/deploy metadata so external tooling and operators can verify
 * exactly which commit is being served. Only metadata that's already public
 * by virtue of being in git history is exposed — no secrets, no database
 * URL, no API keys, no env-var wholesale dump.
 */
export async function GET() {
  return NextResponse.json(buildVersionInfo(process.env), { status: 200 });
}
