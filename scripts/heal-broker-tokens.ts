#!/usr/bin/env tsx
/**
 * Safe one-off heal: restores expired BrokerConnections to connected_readonly
 * ONLY when the stored access token is still valid (tokenExpiresAt > now + 5min).
 *
 * Safe because:
 *   - Only touches connectionStatus and lastRenewError — never tokens
 *   - Skips connections where tokenExpiresAt <= now + 5min (token genuinely expired)
 *   - Skips connections with confirmed invalid_grant/revoked lastRenewError
 *   - Dry-run by default; pass --apply to actually write
 *
 * Usage (requires DATABASE_URL — copy from Railway service env):
 *   DATABASE_URL="postgresql://..." tsx scripts/heal-broker-tokens.ts
 *   DATABASE_URL="postgresql://..." tsx scripts/heal-broker-tokens.ts --apply
 *
 * Run diagnose-broker-tokens.ts first to understand the current state before
 * applying this script.
 *
 * SAFE: does not expose or modify any token values.
 * SAFE: if the healed token is actually invalid, the next sync attempt will
 *       fail with 401 and re-mark the connection expired cleanly.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");

const AUTH_INVALID_MARKERS = [
  "invalid_grant",
  "invalid_token",
  "invalid_client",
  "revoked",
  "unauthorized",
];

async function main() {
  const now = new Date();
  const minExpiresAt = new Date(now.getTime() + 5 * 60_000); // token must be valid for at least 5 more min

  console.log(`\n${"═".repeat(72)}`);
  console.log(`Broker Token Heal — ${now.toISOString()}`);
  console.log(`Mode: ${apply ? "APPLY (writing changes)" : "DRY-RUN (pass --apply to write)"}`);
  console.log(`${"═".repeat(72)}\n`);

  const expired = await prisma.brokerConnection.findMany({
    where: {
      platform: "tradovate",
      connectionStatus: "expired",
    },
    select: {
      id: true,
      env: true,
      connectionStatus: true,
      tokenExpiresAt: true,
      lastRenewedAt: true,
      lastRenewError: true,
      refreshTokenEncrypted: true,
      accounts: {
        select: { id: true, label: true, connectionStatus: true, missingFromBrokerSince: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Found ${expired.length} expired BrokerConnection(s).\n`);

  let healed = 0;
  let skippedGenuineAuthFailure = 0;
  let skippedTokenExpired = 0;

  for (const bc of expired) {
    const minutesRemaining =
      bc.tokenExpiresAt != null
        ? Math.round((bc.tokenExpiresAt.getTime() - now.getTime()) / 60_000)
        : null;

    const renewError = bc.lastRenewError?.toLowerCase() ?? "";
    const isGenuineAuthFailure = AUTH_INVALID_MARKERS.some((m) => renewError.includes(m));

    console.log(`BrokerConnection ${bc.id} (${bc.env})`);
    console.log(`  tokenExpiresAt:  ${bc.tokenExpiresAt?.toISOString() ?? "null"} (${minutesRemaining !== null ? `${minutesRemaining}min` : "unknown"})`);
    console.log(`  lastRenewError:  ${bc.lastRenewError ?? "none"}`);

    if (isGenuineAuthFailure) {
      console.log(`  → SKIP: lastRenewError contains auth-invalid marker. Reconnect required.\n`);
      skippedGenuineAuthFailure++;
      continue;
    }

    if (bc.tokenExpiresAt == null || bc.tokenExpiresAt.getTime() <= minExpiresAt.getTime()) {
      console.log(
        `  → SKIP: token expired or expiring in <5min (${minutesRemaining !== null ? `${minutesRemaining}min remaining` : "no expiry recorded"}). Cannot safely restore.\n`,
      );
      skippedTokenExpired++;
      continue;
    }

    // Token is still valid and no confirmed auth failure — safe to heal.
    console.log(`  → ELIGIBLE: token valid for ${minutesRemaining}min, no confirmed auth failure.`);

    if (!apply) {
      console.log(`  → DRY-RUN: would set connectionStatus=connected_readonly, clear lastRenewError.\n`);
      healed++;
      continue;
    }

    // Apply: restore BrokerConnection
    await prisma.brokerConnection.update({
      where: { id: bc.id },
      data: { connectionStatus: "connected_readonly", lastRenewError: null },
    });
    console.log(`  ✅ HEALED: BrokerConnection set to connected_readonly.`);

    // Cascade heal to linked ConnectedAccounts that are expired and still present at broker
    const healedAccounts = await prisma.connectedAccount.updateMany({
      where: {
        brokerConnectionId: bc.id,
        connectionStatus: "expired",
        missingFromBrokerSince: null,
      },
      data: { connectionStatus: "connected_readonly", errorMessage: null },
    });
    if (healedAccounts.count > 0) {
      console.log(`  ✅ HEALED: ${healedAccounts.count} linked ConnectedAccount(s) restored.`);
    }
    console.log();
    healed++;
  }

  console.log(`${"═".repeat(72)}`);
  console.log(`Results:`);
  console.log(`  Healed${apply ? "" : " (dry-run)"}:      ${healed}`);
  console.log(`  Skipped (token expired): ${skippedTokenExpired}`);
  console.log(`  Skipped (auth failure):  ${skippedGenuineAuthFailure} ← RECONNECT REQUIRED`);
  console.log(`${"═".repeat(72)}`);

  if (!apply && healed > 0) {
    console.log(`\nRe-run with --apply to apply the heal:\n  DATABASE_URL="..." tsx scripts/heal-broker-tokens.ts --apply\n`);
  }
  if (skippedGenuineAuthFailure > 0) {
    console.log(`\n⚠️  ${skippedGenuineAuthFailure} connection(s) require a Reconnect — Tradovate rejected the refresh token.\n`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
