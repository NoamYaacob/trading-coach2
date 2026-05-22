/**
 * GET /api/debug/pre-beta-env-posture
 *
 * Read-only diagnostic that reports the web/app service's runtime env posture
 * and a GO / NO_GO verdict for the guided beta. Used to confirm — before the
 * beta opens — that broker enforcement, order placement, live listeners,
 * internal locks, and billing are all off, and that the required Tradovate
 * OAuth/encryption env is present.
 *
 * Safety:
 *   - Strictly read-only — no DB access, no writes, no env mutation.
 *   - No broker calls — never imports or invokes Tradovate.
 *   - Secret-bearing vars are reported presence-only; raw values are never
 *     read into the response.
 *   - Auth: authenticated session (401) + x-cron-secret matching CRON_SECRET
 *     (403) — the always-required pattern shared by the read-only debug
 *     diagnostics (broker-enforcement-gates, broker-enforcement-simulation,
 *     internal-lock-diagnostic, tradovate-listener/dry-run-summary).
 *
 * Response fields:
 *   note            — read-only disclaimer
 *   generatedAt     — ISO timestamp of evaluation
 *   service         — always "web"; listener-worker/cron are separate services
 *   flags           — interpreted booleans for the 7 operational flags
 *   secretsPresent  — presence-only booleans for the 9 secret-bearing vars
 *   services        — listener-worker/cron marked unknown_from_web_runtime
 *   status          — "GO" | "NO_GO"
 *   reasons         — human-readable explanation of the verdict
 *   dangerousFlags  — guarded flags found enabled
 *   missingRequiredForBeta — required Tradovate env found missing
 *   notes           — advisory observations that do not change the verdict
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";

import { buildRuntimePosture } from "./posture";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const secret = request.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const posture = buildRuntimePosture(process.env);

  return NextResponse.json({
    note: "Read-only diagnostic — no DB writes, no broker calls. Reports the web/app service runtime env posture only.",
    generatedAt: new Date().toISOString(),
    service: posture.service,
    flags: posture.flags,
    secretsPresent: posture.secretsPresent,
    services: posture.services,
    status: posture.verdict.status,
    reasons: posture.verdict.reasons,
    dangerousFlags: posture.verdict.dangerousFlags,
    missingRequiredForBeta: posture.verdict.missingRequiredForBeta,
    notes: posture.verdict.notes,
  });
}
