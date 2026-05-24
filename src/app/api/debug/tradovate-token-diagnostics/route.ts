import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/subscription";
import { prisma } from "@/lib/db";

/**
 * GET /api/debug/tradovate-token-diagnostics
 *
 * Admin-only read-only diagnostic. Returns the token lifecycle state and case
 * classification for every Tradovate BrokerConnection in the database so an
 * operator can determine why connections appear expired on the Dashboard and
 * which healing path is appropriate.
 *
 * Auth: Must be an authenticated admin user (ADMIN_EMAILS env var), or supply
 *   x-cron-secret header matching CRON_SECRET.
 *
 * Safety:
 *   - Read-only. No DB writes of any kind.
 *   - Never returns accessTokenEncrypted or refreshTokenEncrypted.
 *   - No Tradovate API calls.
 *   - No broker writes. No enforcement side-effects.
 */

const AUTH_INVALID_MARKERS = [
  "invalid_grant",
  "invalid_token",
  "invalid_client",
  "revoked",
  "unauthorized",
  "re-authorize",
  "reconnect",
  "refresh_token grant",
];

const SELF_HEAL_LOOKAHEAD_MS = 25 * 60 * 1000; // cron fires if token valid for 25+ min
const SELF_HEAL_WINDOW_MS = 2 * 60 * 60 * 1000; // lastRenewedAt must be within 2 hours
const FALSE_EXPIRY_BUFFER_MS = 5 * 60 * 1000;   // Case A: token valid for 5+ more min

type CaseLabel =
  | "A_valid_token_but_expired_status"
  | "B_expired_token_refresh_exists_transient"
  | "C_true_auth_failure_reconnect_required"
  | "D_unknown"
  | null;

function classifyCase(
  connectionStatus: string,
  tokenExpiresAt: Date | null,
  refreshTokenExists: boolean,
  lastRenewError: string | null,
  now: Date,
): CaseLabel {
  if (connectionStatus !== "expired") return null;

  const renewError = (lastRenewError ?? "").toLowerCase();
  const isGenuineAuthFailure = AUTH_INVALID_MARKERS.some((m) => renewError.includes(m));

  // Case C: confirmed auth failure or no refresh token at all
  if (isGenuineAuthFailure || !refreshTokenExists) {
    return "C_true_auth_failure_reconnect_required";
  }

  // Case A: token is still valid (false expiry — status bug, not token bug)
  if (tokenExpiresAt != null && tokenExpiresAt.getTime() > now.getTime() + FALSE_EXPIRY_BUFFER_MS) {
    return "A_valid_token_but_expired_status";
  }

  // Case B: token actually expired but refresh token present, no confirmed auth failure
  if (tokenExpiresAt == null || tokenExpiresAt.getTime() <= now.getTime()) {
    return "B_expired_token_refresh_exists_transient";
  }

  // Edge: token expiring within 5 min but not yet expired — treat as Case B
  return "B_expired_token_refresh_exists_transient";
}

function isSelfHealEligible(
  connectionStatus: string,
  tokenExpiresAt: Date | null,
  lastRenewedAt: Date | null,
  now: Date,
): boolean {
  if (connectionStatus !== "expired") return false;
  if (tokenExpiresAt == null) return false;
  if (tokenExpiresAt.getTime() <= now.getTime() + SELF_HEAL_LOOKAHEAD_MS) return false;
  if (lastRenewedAt == null) return false;
  const healCutoff = new Date(now.getTime() - SELF_HEAL_WINDOW_MS);
  return lastRenewedAt.getTime() >= healCutoff.getTime();
}

export async function GET(request: NextRequest) {
  // Auth gate: session admin OR x-cron-secret header
  const cronSecret = process.env.CRON_SECRET;
  const headerSecret = request.headers.get("x-cron-secret");
  const hasValidCronSecret = cronSecret != null && headerSecret === cronSecret;

  if (!hasValidCronSecret) {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (!isAdminEmail(currentUser.email)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const now = new Date();

  const connections = await prisma.brokerConnection.findMany({
    where: { platform: "tradovate" },
    select: {
      id: true,
      userId: true,
      env: true,
      connectionStatus: true,
      tokenExpiresAt: true,
      refreshTokenEncrypted: true, // used only to derive refreshTokenExists; never returned
      lastRenewedAt: true,
      lastRenewError: true,
      listenerStatus: true,
      listenerNextRetryAt: true,
      listenerDisabledAt: true,
      createdAt: true,
      accounts: {
        select: {
          id: true,
          label: true,
          connectionStatus: true,
          isActive: true,
          missingFromBrokerSince: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const diagnostics = connections.map((bc) => {
    const tokenExpired =
      bc.tokenExpiresAt != null ? bc.tokenExpiresAt.getTime() <= now.getTime() : null;

    const minutesUntilExpiry =
      bc.tokenExpiresAt != null
        ? Math.round((bc.tokenExpiresAt.getTime() - now.getTime()) / 60_000)
        : null;

    const minutesSinceRenewal =
      bc.lastRenewedAt != null
        ? Math.round((now.getTime() - bc.lastRenewedAt.getTime()) / 60_000)
        : null;

    const refreshTokenExists = bc.refreshTokenEncrypted != null;

    const caseClassification = classifyCase(
      bc.connectionStatus,
      bc.tokenExpiresAt,
      refreshTokenExists,
      bc.lastRenewError,
      now,
    );

    const selfHealEligible = isSelfHealEligible(
      bc.connectionStatus,
      bc.tokenExpiresAt,
      bc.lastRenewedAt,
      now,
    );

    return {
      id: bc.id,
      userId: bc.userId,
      env: bc.env,
      connectionStatus: bc.connectionStatus,
      tokenExpiresAt: bc.tokenExpiresAt?.toISOString() ?? null,
      minutesUntilExpiry,
      tokenExpired,
      refreshTokenExists,
      lastRenewedAt: bc.lastRenewedAt?.toISOString() ?? null,
      minutesSinceRenewal,
      lastRenewAttemptAt: null, // field does not exist in schema
      lastRenewError: bc.lastRenewError ?? null,
      listenerStatus: bc.listenerStatus ?? null,
      listenerNextRetryAt: bc.listenerNextRetryAt?.toISOString() ?? null,
      listenerDisabled: bc.listenerDisabledAt != null,
      accountCount: bc.accounts.length,
      accounts: bc.accounts.map((a) => ({
        id: a.id,
        label: a.label ?? null,
        connectionStatus: a.connectionStatus,
        isActive: a.isActive,
        missingFromBroker: a.missingFromBrokerSince != null,
      })),
      selfHealEligible,
      caseClassification,
    };
  });

  const expired = diagnostics.filter((d) => d.connectionStatus === "expired");

  return NextResponse.json({
    now: now.toISOString(),
    total: diagnostics.length,
    summary: {
      totalExpired: expired.length,
      caseA: expired.filter((d) => d.caseClassification === "A_valid_token_but_expired_status").length,
      caseB: expired.filter((d) => d.caseClassification === "B_expired_token_refresh_exists_transient").length,
      caseC: expired.filter((d) => d.caseClassification === "C_true_auth_failure_reconnect_required").length,
      caseD: expired.filter((d) => d.caseClassification === "D_unknown").length,
      selfHealEligible: diagnostics.filter((d) => d.selfHealEligible).length,
    },
    connections: diagnostics,
  });
}
