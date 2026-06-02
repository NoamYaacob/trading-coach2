/**
 * Diagnostic: print the complete lockout state for a given account.
 *
 * Usage:
 *   DATABASE_URL="..." npx tsx scripts/check-lockout-status.ts <accountId>
 *
 * Prints:
 *   - ConnectedAccount id / label / permissionLevel / connectionStatus
 *   - BrokerConnection connectionStatus / env / platform
 *   - Latest LiveSessionState
 *   - Latest InternalLockEvent (ruleType = manual_lock)
 *   - Latest GuardianIntervention (triggerType = manual)
 *     → brokerLockStatus / brokerActionTaken / dedupKey / endpoint / response
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const accountId = process.argv[2];
  if (!accountId) {
    console.error("Usage: npx tsx scripts/check-lockout-status.ts <accountId>");
    process.exit(1);
  }

  // ── Account identity ────────────────────────────────────────────────────────
  const account = await prisma.connectedAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      label: true,
      displayName: true,
      externalAccountId: true,
      platform: true,
      isActive: true,
      protectionStatus: true,
      missingFromBrokerSince: true,
      brokerConnection: {
        select: {
          id: true,
          connectionStatus: true,
          permissionLevel: true,
          env: true,
          platform: true,
          brokerUserId: true,
          tokenExpiresAt: true,
          lastReconciliationAt: true,
          lastReconciliationStatus: true,
        },
      },
    },
  });

  if (!account) {
    console.error(`Account not found: ${accountId}`);
    process.exit(1);
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("ACCOUNT IDENTITY");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  id:                  ${account.id}`);
  console.log(`  label:               ${account.label ?? "(none)"}`);
  console.log(`  displayName:         ${account.displayName ?? "(none)"}`);
  console.log(`  externalAccountId:   ${account.externalAccountId ?? "(none)"}`);
  console.log(`  platform:            ${account.platform ?? "(none)"}`);
  console.log(`  isActive:            ${account.isActive}`);
  console.log(`  protectionStatus:    ${account.protectionStatus ?? "(none)"}`);
  console.log(`  missingFromBroker:   ${account.missingFromBrokerSince?.toISOString() ?? "null (still visible in broker)"}`);

  if (account.brokerConnection) {
    const bc = account.brokerConnection;
    console.log("\n───────────────────────────────────────────────────────────");
    console.log("BROKER CONNECTION");
    console.log("───────────────────────────────────────────────────────────");
    console.log(`  id:                  ${bc.id}`);
    console.log(`  platform:            ${bc.platform}`);
    console.log(`  env:                 ${bc.env}`);
    console.log(`  connectionStatus:    ${bc.connectionStatus}`);
    console.log(`  permissionLevel:     ${bc.permissionLevel ?? "(null — probe not yet run)"}`);
    console.log(`  brokerUserId:        ${bc.brokerUserId ?? "(null)"}`);
    console.log(`  tokenExpiresAt:      ${bc.tokenExpiresAt?.toISOString() ?? "(null)"}`);
    console.log(`  lastReconciledAt:    ${bc.lastReconciliationAt?.toISOString() ?? "(null)"}`);
    console.log(`  lastReconStatus:     ${bc.lastReconciliationStatus ?? "(null)"}`);

    const isReadOnly =
      bc.permissionLevel === "read_only" || bc.connectionStatus === "connected_readonly";
    console.log(`\n  ⚡ BROKER WRITE POSSIBLE:  ${isReadOnly ? "NO — read-only, broker lock will be skipped" : "YES — full_access or probe not yet run"}`);
  } else {
    console.log("\n  (no BrokerConnection linked)");
  }

  // ── LiveSessionState ────────────────────────────────────────────────────────
  const lss = await prisma.liveSessionState.findUnique({
    where: { accountId },
    select: { riskState: true, sessionDate: true, updatedAt: true },
  });

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("LIVE SESSION STATE");
  console.log("═══════════════════════════════════════════════════════════");
  if (lss) {
    console.log(`  riskState:           ${lss.riskState}`);
    console.log(`  sessionDate:         ${lss.sessionDate}`);
    console.log(`  updatedAt:           ${lss.updatedAt.toISOString()}`);
  } else {
    console.log("  (no LiveSessionState row)");
  }

  // ── Latest manual InternalLockEvent ────────────────────────────────────────
  const lockEvent = await prisma.internalLockEvent.findFirst({
    where: { accountId, ruleType: "manual_lock" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      ruleType: true,
      tradingDay: true,
      activeDedupKey: true,
      internalOnly: true,
      brokerActionTaken: true,
      clearedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("LATEST INTERNAL LOCK EVENT (manual_lock)");
  console.log("═══════════════════════════════════════════════════════════");
  if (lockEvent) {
    console.log(`  id:                  ${lockEvent.id}`);
    console.log(`  ruleType:            ${lockEvent.ruleType}`);
    console.log(`  tradingDay:          ${lockEvent.tradingDay}`);
    console.log(`  activeDedupKey:      ${lockEvent.activeDedupKey}`);
    console.log(`  internalOnly:        ${lockEvent.internalOnly}`);
    console.log(`  brokerActionTaken:   ${lockEvent.brokerActionTaken}`);
    console.log(`  clearedAt:           ${lockEvent.clearedAt?.toISOString() ?? "null (still active)"}`);
    console.log(`  createdAt:           ${lockEvent.createdAt.toISOString()}`);
    console.log(`  updatedAt:           ${lockEvent.updatedAt.toISOString()}`);
  } else {
    console.log("  (no manual_lock InternalLockEvent found)");
  }

  // ── Latest manual GuardianIntervention ─────────────────────────────────────
  const intervention = await prisma.guardianIntervention.findFirst({
    where: { accountId, triggerType: "manual" },
    orderBy: { sentAt: "desc" },
    select: {
      id: true,
      triggerType: true,
      outcome: true,
      brokerLockStatus: true,
      flattenStatus: true,
      listenerBrokerDedupKey: true,
      brokerEndpoint: true,
      brokerPayloadJson: true,
      brokerResponseJson: true,
      message: true,
      tradingDay: true,
      sentAt: true,
      internalLockEventId: true,
    },
  });

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("LATEST GUARDIAN INTERVENTION (manual trigger)");
  console.log("═══════════════════════════════════════════════════════════");
  if (intervention) {
    console.log(`  id:                  ${intervention.id}`);
    console.log(`  triggerType:         ${intervention.triggerType}`);
    console.log(`  outcome:             ${intervention.outcome}`);
    console.log(`  brokerLockStatus:    ${intervention.brokerLockStatus}`);
    console.log(`  flattenStatus:       ${intervention.flattenStatus}`);
    console.log(`  tradingDay:          ${intervention.tradingDay}`);
    console.log(`  sentAt:              ${intervention.sentAt?.toISOString() ?? "(null)"}`);
    console.log(`  internalLockEventId: ${intervention.internalLockEventId ?? "(null)"}`);
    console.log(`  dedupKey:            ${intervention.listenerBrokerDedupKey ?? "(null)"}`);
    console.log(`  brokerEndpoint:      ${intervention.brokerEndpoint ?? "(skipped — null)"}`);
    console.log(`  brokerPayload:       ${intervention.brokerPayloadJson != null ? JSON.stringify(intervention.brokerPayloadJson) : "(null)"}`);
    console.log(`  brokerResponse:      ${intervention.brokerResponseJson != null ? JSON.stringify(intervention.brokerResponseJson) : "(null)"}`);
    console.log(`\n  message: ${intervention.message}`);

    if (intervention.brokerLockStatus === "unavailable_read_only") {
      console.log("\n  ⚠  CONFIRMED: broker lock was skipped — connection is read-only.");
      console.log("     The account was locked in Guardrail only. Trading at Tradovate");
      console.log("     was NOT prevented.");
    } else if (intervention.brokerLockStatus === "broker_locked") {
      console.log("\n  ✓  Broker lock was confirmed — Tradovate should have blocked new orders.");
    } else {
      console.log(`\n  ⚠  Broker lock not confirmed (status: ${intervention.brokerLockStatus}).`);
    }
  } else {
    console.log("  (no manual GuardianIntervention found)");
  }

  console.log("\n═══════════════════════════════════════════════════════════\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
