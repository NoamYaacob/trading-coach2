import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { prisma } from "@/lib/db";
import { ensureTradovateAccessToken } from "@/lib/brokers/tradovate-ensure-token";

/**
 * POST /api/cron/renew-tradovate-tokens
 *
 * Proactively renews Tradovate access tokens for active BrokerConnections
 * whose tokens are expiring soon or have no recorded expiry metadata.
 *
 * Why this exists:
 *   tradovate-sync renews tokens as a side-effect of syncing stale accounts.
 *   But when there are no stale accounts (e.g., off-hours, recently synced),
 *   the sync cron skips the connection and the token can expire unrenewed.
 *   This job ensures renewal happens independently of account-sync activity.
 *
 * Selection window — RENEWAL_LOOKAHEAD_MS (25 min):
 *   Wider than REFRESH_BUFFER_MS (15 min) to ensure that connections whose
 *   tokens expire within two cron intervals (2 × 10 min = 20 min) are always
 *   caught. ensureTradovateAccessToken re-checks shouldRenewToken internally
 *   and is a no-op when the token is still comfortably fresh.
 *
 * Failure semantics (delegated to ensureTradovateAccessToken):
 *   auth_invalid → BrokerConnection + linked accounts marked "expired".
 *                  Reconnect will appear on the Dashboard. This is correct —
 *                  Tradovate rejected the credentials and a re-auth is needed.
 *   transient    → error recorded in response; connection NOT marked expired.
 *                  The next cron invocation will retry.
 *
 * Auth: requires x-cron-secret header matching CRON_SECRET env var.
 *
 * Configure in railway.toml (HTTP cron) or Railway Cron service:
 *   Schedule:  every 10 minutes  (cron expression: *\/10 * * * *)
 *   Method:    POST
 *   URL:       https://<your-app>/api/cron/renew-tradovate-tokens
 *   Header:    x-cron-secret: <CRON_SECRET>
 *
 * Or via the companion npm script:
 *   npm run cron:renew-tokens
 * with APP_URL and CRON_SECRET set in the environment.
 */

/** 25-minute look-ahead window — wider than the 15-min REFRESH_BUFFER_MS. */
const RENEWAL_LOOKAHEAD_MS = 25 * 60 * 1000;

export async function POST(request: NextRequest) {
  const secret = request.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const lookaheadCutoff = new Date(now.getTime() + RENEWAL_LOOKAHEAD_MS);

  // Select only connections that actually need attention:
  //   - tokenExpiresAt is null (no expiry metadata — renew defensively), OR
  //   - tokenExpiresAt is within the next 25 minutes (expiring soon or already expired).
  // Connections whose tokens have >= 25 min remaining are skipped at the DB level.
  const connections = await prisma.brokerConnection.findMany({
    where: {
      platform: "tradovate",
      connectionStatus: { in: ["connected_readonly", "connected_live"] },
      OR: [
        { tokenExpiresAt: null },
        { tokenExpiresAt: { lte: lookaheadCutoff } },
      ],
    },
    select: {
      id: true,
      userId: true,
      tokenExpiresAt: true,
      lastRenewedAt: true,
    },
  });

  console.info("[cron/renew-tradovate-tokens] connections selected for renewal check", {
    count: connections.length,
    lookaheadMinutes: RENEWAL_LOOKAHEAD_MS / 60_000,
  });

  if (connections.length === 0) {
    return NextResponse.json({
      ok: true,
      checked: 0,
      renewed: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    });
  }

  type RenewalError = { connectionId: string; errorCode: string; errorMessage: string };
  const errors: RenewalError[] = [];
  let renewed = 0;
  let skipped = 0;

  for (const bc of connections) {
    try {
      const result = await ensureTradovateAccessToken({
        brokerConnectionId: bc.id,
        userId: bc.userId,
      });

      if (result.renewed) {
        renewed++;
        console.info("[cron/renew-tradovate-tokens] renewed", {
          connectionId: bc.id,
          newExpiresAt: result.tokenExpiresAt?.toISOString() ?? null,
        });
      } else {
        // Token was still fresh when ensureTradovateAccessToken re-checked.
        // (Can happen when the connection appeared in the lookahead window but
        // the token had already been renewed by a concurrent sync.)
        skipped++;
        console.info("[cron/renew-tradovate-tokens] skipped — token still fresh", {
          connectionId: bc.id,
          expiresAt: result.tokenExpiresAt?.toISOString() ?? null,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "UNKNOWN";
      const code =
        typeof err === "object" && err !== null && "code" in err
          ? String((err as { code: unknown }).code)
          : "UNKNOWN";

      console.warn("[cron/renew-tradovate-tokens] renewal failed", {
        connectionId: bc.id,
        code,
        message,
      });

      errors.push({ connectionId: bc.id, errorCode: code, errorMessage: message });
    }
  }

  const failed = errors.length;

  console.info("[cron/renew-tradovate-tokens] done", {
    checked: connections.length,
    renewed,
    skipped,
    failed,
  });

  return NextResponse.json({
    ok: failed === 0,
    checked: connections.length,
    renewed,
    skipped,
    failed,
    errors,
  });
}
