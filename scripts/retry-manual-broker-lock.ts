#!/usr/bin/env tsx
/**
 * retry-manual-broker-lock.ts — safe retry of a manual broker lock after a
 * prior dry_run / failed / unavailable GuardianIntervention.
 *
 * Usage:
 *   npx tsx scripts/retry-manual-broker-lock.ts <accountLabelOrId>
 *       # read-only diagnostic — shows current lock and intervention state
 *
 *   npx tsx scripts/retry-manual-broker-lock.ts <accountLabelOrId> --execute
 *       # retries the actual broker write (only if retryable prior record exists)
 *
 * Safety contract — diagnostic mode (no --execute):
 *   - Prisma: findFirst / findUnique / count only. Zero writes.
 *   - No broker calls (no TradovateClient, no applyManualBrokerLock).
 *
 * Safety contract — execute mode (--execute):
 *   - Calls retryManualBrokerLock() which only writes when a retryable prior
 *     GuardianIntervention exists (brokerLockStatus IN dry_run / failed /
 *     unavailable_*) and brokerActionTaken=false.
 *   - Does NOT create new InternalLockEvents or LiveSessionState rows.
 *   - Does NOT place, cancel, or flatten orders.
 *   - Does NOT change schema, migrations, env vars, or the listener-worker.
 *   - Does NOT affect the automatic daily-loss broker enforcement path.
 */

import { resolve } from "path";

import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });

import { prisma } from "../src/lib/db.ts";
import { buildListenerBrokerDedupKey } from "../src/lib/guardian-engine/broker-enforcement-dedup.ts";
import { MANUAL_LOCK_RULE_TYPE } from "../src/app/api/accounts/[id]/lockout/lockout-helpers.ts";
import { retryManualBrokerLock } from "../src/lib/guardian-engine/manual-broker-lock-service.ts";

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const accountLabelOrId = args.find((a) => !a.startsWith("--"));
const executeMode = args.includes("--execute");

if (!accountLabelOrId) {
  console.error("Usage: npx tsx scripts/retry-manual-broker-lock.ts <accountLabelOrId> [--execute]");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(label: string, value: string | null | undefined | boolean | number) {
  const v = value == null ? "(null)" : String(value);
  console.log(`  ${label.padEnd(32)} ${v}`);
}

function section(title: string) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 60 - title.length - 4))}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(
    `\nretry-manual-broker-lock — ${executeMode ? "EXECUTE MODE" : "diagnostic mode (read-only)"}\n`,
  );

  // 1. Resolve account
  const account = await prisma.connectedAccount.findFirst({
    where: {
      OR: [{ id: accountLabelOrId }, { label: { equals: accountLabelOrId, mode: "insensitive" } }],
      isActive: true,
    },
    select: {
      id: true,
      label: true,
      platform: true,
      externalAccountId: true,
      brokerConnection: {
        select: { connectionStatus: true, permissionLevel: true },
      },
      sessionState: {
        select: { riskState: true, sessionDate: true },
      },
    },
  });

  section("Account");
  if (!account) {
    console.error(`  FAIL  No active account found for '${accountLabelOrId}'`);
    process.exit(1);
  }
  fmt("id", account.id);
  fmt("label", account.label);
  fmt("platform", account.platform);
  fmt("externalAccountId", account.externalAccountId);
  fmt("connectionStatus", account.brokerConnection?.connectionStatus);
  fmt("permissionLevel", account.brokerConnection?.permissionLevel);
  fmt("riskState", account.sessionState?.riskState);
  fmt("sessionDate", account.sessionState?.sessionDate);

  // 2. Active manual InternalLockEvent
  section("Active InternalLockEvent (manual_lock)");
  const lockEvent = await prisma.internalLockEvent.findFirst({
    where: {
      accountId: account.id,
      ruleType: MANUAL_LOCK_RULE_TYPE,
      clearedAt: null,
      activeDedupKey: { not: null },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      ruleType: true,
      tradingDay: true,
      activeDedupKey: true,
      brokerActionTaken: true,
      clearedAt: true,
      createdAt: true,
    },
  });

  if (!lockEvent) {
    console.log("  WARN  No active manual_lock InternalLockEvent found.");
    console.log("        (Either no manual lock exists, or it was already cleared.)");
    if (!executeMode) process.exit(0);
    // If execute mode is requested with no active lock, still exit cleanly.
    process.exit(0);
  }

  fmt("id", lockEvent.id);
  fmt("ruleType", lockEvent.ruleType);
  fmt("tradingDay", lockEvent.tradingDay);
  fmt("activeDedupKey", lockEvent.activeDedupKey);
  fmt("brokerActionTaken", lockEvent.brokerActionTaken);
  fmt("clearedAt", lockEvent.clearedAt?.toISOString());
  fmt("createdAt", lockEvent.createdAt.toISOString());

  // 3. Prior GuardianIntervention
  section("Prior GuardianIntervention");
  const dedupKey = buildListenerBrokerDedupKey(
    account.id,
    lockEvent.ruleType,
    lockEvent.tradingDay,
  );
  fmt("dedupKey", dedupKey);

  const prior = await prisma.guardianIntervention.findUnique({
    where: { listenerBrokerDedupKey: dedupKey },
    select: {
      id: true,
      triggerType: true,
      brokerLockStatus: true,
      outcome: true,
      message: true,
      sentAt: true,
    },
  });

  if (!prior) {
    console.log("  INFO  No prior GuardianIntervention found for this dedupKey.");
    console.log("        Use the Lockout button / POST /api/accounts/[id]/lockout to create one.");
    process.exit(0);
  }

  fmt("id", prior.id);
  fmt("triggerType", prior.triggerType);
  fmt("brokerLockStatus", prior.brokerLockStatus);
  fmt("brokerActionTaken (derived)", prior.brokerLockStatus === "broker_locked");
  fmt("outcome", prior.outcome);
  fmt("sentAt", prior.sentAt?.toISOString());
  console.log(`  message: ${prior.message}`);

  // 4. Retryability analysis
  section("Retryability Analysis");
  const RETRYABLE = new Set([
    "dry_run",
    "broker_lock_failed",
    "unavailable_permission",
    "unavailable_read_only",
    "unavailable_consent_missing",
    "monitoring_only",
    "not_requested",
  ]);
  const retryable =
    prior.brokerLockStatus !== "broker_locked" &&
    (RETRYABLE.has(prior.brokerLockStatus ?? "") ||
      (prior.brokerLockStatus ?? "").startsWith("unavailable_"));

  if (prior.brokerLockStatus === "broker_locked") {
    console.log("  OK    Already broker-locked — no retry needed.");
    process.exit(0);
  } else if (retryable) {
    console.log(`  READY Prior status '${prior.brokerLockStatus}' is retryable.`);
    console.log(`        ENFORCEMENT_DRY_RUN=${process.env.ENFORCEMENT_DRY_RUN ?? "(not set)"}`);
    if (!executeMode) {
      console.log("\n  Run with --execute to perform the retry.\n");
    }
  } else {
    console.log(`  SKIP  Prior status '${prior.brokerLockStatus}' is NOT retryable.`);
    process.exit(0);
  }

  if (!executeMode) {
    process.exit(0);
  }

  // 5. Execute retry
  section("Executing Retry");
  console.log(`  Calling retryManualBrokerLock('${lockEvent.id}') …\n`);

  const result = await retryManualBrokerLock(lockEvent.id);

  fmt("outcome", result.outcome);
  fmt("brokerActionTaken", result.brokerActionTaken);
  if (result.status) fmt("status", result.status);
  fmt("dedupKey", result.dedupKey);
  console.log(`  message: ${result.message}`);

  if (result.outcome === "retried" && result.brokerActionTaken) {
    console.log("\n  ✓ Broker lock confirmed — Tradovate has the risk setting applied.");
  } else if (result.outcome === "retried") {
    console.log("\n  ✗ Retry attempted but broker lock was NOT confirmed. Internal lock preserved.");
  } else {
    console.log(`\n  No broker write was performed (outcome: ${result.outcome}).`);
  }

  console.log();
}

main()
  .catch((err) => {
    console.error("\nFatal error:", err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
