#!/usr/bin/env tsx
/**
 * Read-only diagnostic: print the token lifecycle state for every Tradovate
 * BrokerConnection in the DB. Run this to determine why connections appear
 * expired on the dashboard and which healing path is appropriate.
 *
 * Usage (requires DATABASE_URL — copy from Railway service env):
 *   DATABASE_URL="postgresql://..." tsx scripts/diagnose-broker-tokens.ts
 *
 * Or via npm:
 *   DATABASE_URL="..." npm run diagnose:broker-tokens
 *
 * Output is safe to share — token values are NEVER printed.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const HEAL_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours
const LOOKAHEAD_MS = 25 * 60 * 1000;       // 25 minutes

async function main() {
  const now = new Date();
  const healCutoff = new Date(now.getTime() - HEAL_WINDOW_MS);
  const lookaheadCutoff = new Date(now.getTime() + LOOKAHEAD_MS);

  const connections = await prisma.brokerConnection.findMany({
    where: { platform: "tradovate" },
    select: {
      id: true,
      userId: true,
      env: true,
      connectionStatus: true,
      tokenExpiresAt: true,
      refreshTokenEncrypted: true,
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

  console.log(`\n${"═".repeat(72)}`);
  console.log(`Tradovate BrokerConnection Diagnostic — ${now.toISOString()}`);
  console.log(`${"═".repeat(72)}\n`);
  console.log(`Total connections: ${connections.length}\n`);

  for (const bc of connections) {
    const minutesUntilExpiry =
      bc.tokenExpiresAt != null
        ? Math.round((bc.tokenExpiresAt.getTime() - now.getTime()) / 60_000)
        : null;
    const minutesSinceRenewal =
      bc.lastRenewedAt != null
        ? Math.round((now.getTime() - bc.lastRenewedAt.getTime()) / 60_000)
        : null;

    const tokenIsExpired =
      bc.tokenExpiresAt != null && bc.tokenExpiresAt.getTime() <= now.getTime();
    const tokenIsFresh =
      bc.tokenExpiresAt != null && bc.tokenExpiresAt.getTime() > lookaheadCutoff.getTime();
    const renewedRecently =
      bc.lastRenewedAt != null && bc.lastRenewedAt.getTime() >= healCutoff.getTime();

    // Determine which case we're in
    const isExpired = bc.connectionStatus === "expired";
    const hasRefreshToken = bc.refreshTokenEncrypted != null;

    let healStatus: string;
    let caseLabel: string;
    if (!isExpired) {
      caseLabel = "N/A — not expired";
      healStatus = "no action needed";
    } else if (tokenIsFresh && renewedRecently) {
      caseLabel = "A — false expiry (race condition)";
      healStatus = "✅ CRON SELF-HEAL WILL FIRE — wait for next cron run (<10 min)";
    } else if (tokenIsFresh && !renewedRecently) {
      caseLabel = "A — false expiry (token valid, old renewal)";
      healStatus = "⚠️  cron heal WON'T fire (lastRenewedAt > 2h ago) — use manual heal script";
    } else if (tokenIsExpired && hasRefreshToken) {
      const authError = bc.lastRenewError?.toLowerCase() ?? "";
      const isGenuineAuthFailure =
        ["invalid_grant", "invalid_token", "invalid_client", "unauthorized", "revoked"].some(
          (m) => authError.includes(m),
        );
      if (isGenuineAuthFailure) {
        caseLabel = "C — genuine auth failure (invalid_grant or revoked)";
        healStatus = "❌ RECONNECT REQUIRED — the refresh token was rejected by Tradovate";
      } else if (authError.length > 0) {
        caseLabel = "B — transient or unknown error";
        healStatus =
          "⚠️  token expired, refresh token present — cron will attempt renewal on next run";
      } else {
        caseLabel = "B — token expired, no recorded error";
        healStatus = "⚠️  token expired, refresh token present — cron will attempt renewal";
      }
    } else if (tokenIsExpired && !hasRefreshToken) {
      caseLabel = "C — token expired, no refresh token";
      healStatus = "❌ RECONNECT REQUIRED — no refresh token stored";
    } else {
      // tokenExpiresAt is null
      caseLabel = "? — no expiry recorded";
      healStatus = hasRefreshToken
        ? "⚠️  cron will attempt renewal (no expiry metadata)"
        : "❌ no refresh token — likely needs reconnect";
    }

    console.log(`${"─".repeat(72)}`);
    console.log(`BrokerConnection: ${bc.id}`);
    console.log(`  User:              ${bc.userId}`);
    console.log(`  Env:               ${bc.env}`);
    console.log(`  connectionStatus:  ${bc.connectionStatus}`);
    console.log(
      `  tokenExpiresAt:    ${bc.tokenExpiresAt?.toISOString() ?? "null"}${
        minutesUntilExpiry !== null
          ? ` (${minutesUntilExpiry >= 0 ? `${minutesUntilExpiry}min remaining` : `EXPIRED ${Math.abs(minutesUntilExpiry)}min ago`})`
          : ""
      }`,
    );
    console.log(`  tokenIsExpired:    ${tokenIsExpired}`);
    console.log(`  refreshToken:      ${hasRefreshToken ? "exists ✓" : "MISSING ✗"}`);
    console.log(
      `  lastRenewedAt:     ${bc.lastRenewedAt?.toISOString() ?? "never"}${
        minutesSinceRenewal !== null ? ` (${minutesSinceRenewal}min ago)` : ""
      }`,
    );
    console.log(`  renewedRecently:   ${renewedRecently} (within last 2hr)`);
    console.log(`  lastRenewError:    ${bc.lastRenewError ?? "none"}`);
    console.log(`  listenerStatus:    ${bc.listenerStatus ?? "null"}`);
    console.log(`  listenerDisabled:  ${bc.listenerDisabledAt != null}`);
    console.log(`  accountCount:      ${bc.accounts.length}`);
    console.log(`  accounts:`);
    for (const a of bc.accounts) {
      console.log(
        `    ${a.label ?? a.id}: status=${a.connectionStatus} active=${a.isActive} missing=${a.missingFromBrokerSince != null}`,
      );
    }
    console.log(`\n  ► CASE:            ${caseLabel}`);
    console.log(`  ► HEAL STATUS:     ${healStatus}`);
    console.log(
      `  ► Cron self-heal:  ${isExpired && tokenIsFresh && renewedRecently ? "ELIGIBLE" : "NOT ELIGIBLE"} ` +
        `(needs: expired ✓${isExpired ? "" : "✗"}, tokenFresh ✓${tokenIsFresh ? "" : "✗"}, renewedRecently ${renewedRecently ? "✓" : "✗"})`,
    );
    console.log();
  }

  console.log(`${"═".repeat(72)}`);
  console.log("Summary:");
  const expired = connections.filter((c) => c.connectionStatus === "expired");
  const cronEligible = expired.filter((c) => {
    const tf =
      c.tokenExpiresAt != null && c.tokenExpiresAt.getTime() > lookaheadCutoff.getTime();
    const rr = c.lastRenewedAt != null && c.lastRenewedAt.getTime() >= healCutoff.getTime();
    return tf && rr;
  });
  const manualHealEligible = expired.filter((c) => {
    const tf =
      c.tokenExpiresAt != null && c.tokenExpiresAt.getTime() > now.getTime() + 5 * 60_000;
    const cronElig =
      c.tokenExpiresAt != null &&
      c.tokenExpiresAt.getTime() > lookaheadCutoff.getTime() &&
      c.lastRenewedAt != null &&
      c.lastRenewedAt.getTime() >= healCutoff.getTime();
    return tf && !cronElig;
  });
  console.log(`  Total expired:           ${expired.length}`);
  console.log(`  Cron self-heal eligible: ${cronEligible.length}`);
  console.log(`  Manual heal eligible:    ${manualHealEligible.length}`);
  console.log(`  Reconnect required:      ${expired.length - cronEligible.length - manualHealEligible.length}`);
  console.log(`${"═".repeat(72)}\n`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
