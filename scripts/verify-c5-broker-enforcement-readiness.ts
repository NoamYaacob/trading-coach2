#!/usr/bin/env tsx
/**
 * C5 Broker-Enforcement Readiness Verification — READ ONLY, zero writes.
 *
 * Phase C5 prepares for broker-side daily-loss enforcement BEFORE any real
 * broker write is enabled. This script reports whether DEMO7433035 would be
 * eligible for the listener-path broker enforcement gates — WITHOUT sending any
 * Tradovate write, without flipping any flag, and without mutating any DB row.
 *
 * It reuses the production pure gate evaluator (evaluateBrokerEnforcementGates)
 * so the verdict mirrors exactly what the listener path would decide. The only
 * difference: this script never calls triggerEnforcement, so no broker write
 * and no GuardianIntervention/audit row is ever produced.
 *
 * IMPORTANT — read-only contract:
 *   - Prisma: findFirst / findUnique / findMany / count only.
 *   - No create / update / updateMany / upsert / delete / deleteMany / raw.
 *   - No fetch / axios / Tradovate calls. No token or secret printing.
 *   - The env flags are READ and reported, never set.
 *
 * Safety expectation for THIS phase:
 *   BROKER_ENFORCEMENT_ENABLED is expected to be unset/false, and
 *   ENFORCEMENT_DRY_RUN is expected to be true. A verdict of "would NOT enforce
 *   (gate: broker_enforcement_disabled)" is the CORRECT, SAFE state right now.
 *
 * Checks (PASS / WARN / FAIL table):
 *   A.  DEMO7433035 account resolves
 *   B.  account env is "demo"
 *   C.  active InternalLockEvent exists (clearedAt IS NULL)
 *   D.  ruleType is daily_loss_limit
 *   E.  brokerActionTaken is false (no broker action recorded on the lock yet)
 *   F.  BROKER_ENFORCEMENT_ENABLED current value (expected NOT true this phase)
 *   G.  ENFORCEMENT_DRY_RUN current value (expected true this phase)
 *   H.  Tradovate connection exists with env/status/permissionLevel capability
 *   I.  no BrokerOrderActionLog rows for this account today (no real broker action)
 *   J.  broker-enforcement eligibility — pure gate evaluation (no write)
 */

import { resolve } from "path";

import { config } from "dotenv";
config({ path: resolve(process.cwd(), ".env.local") });

import { prisma } from "../src/lib/db.ts";
import { deriveCmeTradingDayKey } from "../src/lib/trading-day.ts";
import { dateKeyInTimezone } from "../src/lib/account-protection.ts";
import {
  evaluateBrokerEnforcementGates,
  parseBrokerEnforcementAllowlist,
} from "../src/lib/guardian-engine/broker-enforcement-gate.ts";

const TARGET_LABEL = "DEMO7433035";
const TARGET_EXTERNAL_ID = "47669364";

type Status = "PASS" | "WARN" | "FAIL" | "INFO";
type CheckResult = { label: string; status: Status; detail: string };

async function run(): Promise<void> {
  const now = new Date();
  const cmeTradingDayKey = deriveCmeTradingDayKey(now);
  const todayCtKey = dateKeyInTimezone(now, "America/Chicago");
  const results: CheckResult[] = [];

  console.log("=".repeat(72));
  console.log("C5 Broker-Enforcement Readiness Verification — READ ONLY");
  console.log("=".repeat(72));
  console.log(`  Run time (UTC):       ${now.toISOString()}`);
  console.log(`  CME trading day key:  ${cmeTradingDayKey}`);
  console.log(`  CT calendar day key:  ${todayCtKey}`);
  console.log();

  // ── A. Account ──────────────────────────────────────────────────────────────
  const account = await prisma.connectedAccount.findFirst({
    where: {
      OR: [
        { label: TARGET_LABEL },
        { displayName: TARGET_LABEL },
        { externalAccountId: TARGET_EXTERNAL_ID },
        { externalAccountId: TARGET_LABEL },
      ],
    },
    select: {
      id: true,
      label: true,
      displayName: true,
      externalAccountId: true,
      userId: true,
      isActive: true,
      missingFromBrokerSince: true,
      brokerConnection: {
        select: { id: true, env: true, connectionStatus: true, permissionLevel: true },
      },
      user: { select: { guardianProfile: { select: { guardianEnabled: true } } } },
    },
  });

  if (!account) {
    console.error(`FATAL: No account found matching "${TARGET_LABEL}" / "${TARGET_EXTERNAL_ID}"`);
    await prisma.$disconnect();
    process.exit(1);
  }

  results.push({
    label: "A. DEMO7433035 account resolves",
    status: "PASS",
    detail: `id=${account.id} label=${account.label ?? "(null)"} externalAccountId=${account.externalAccountId ?? "(null)"} isActive=${account.isActive} missingFromBrokerSince=${account.missingFromBrokerSince ? account.missingFromBrokerSince.toISOString() : "null"}`,
  });

  const conn = account.brokerConnection;
  const env = conn?.env ?? null;

  // ── B. env is demo ──────────────────────────────────────────────────────────
  results.push({
    label: "B. Account env is demo",
    status: env === "demo" ? "PASS" : "FAIL",
    detail: env === "demo" ? "env=demo" : `env='${env ?? "null"}' — broker enforcement is demo-only this phase`,
  });

  // ── C. active InternalLockEvent ─────────────────────────────────────────────
  const activeLocks = await prisma.internalLockEvent.findMany({
    where: { accountId: account.id, clearedAt: null },
    select: { id: true, ruleType: true, tradingDay: true, observedAmount: true, brokerActionTaken: true, internalOnly: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const dailyLossLock = activeLocks.find((l) => l.ruleType === "daily_loss_limit") ?? null;
  const primaryLock = dailyLossLock ?? activeLocks[0] ?? null;

  results.push({
    label: "C. Active InternalLockEvent exists (clearedAt IS NULL)",
    status: activeLocks.length > 0 ? "PASS" : "WARN",
    detail:
      activeLocks.length > 0
        ? `active=${activeLocks.length}: ${activeLocks.map((l) => `[${l.id}] ${l.ruleType} tradingDay=${l.tradingDay}`).join("; ")}`
        : "No active internal lock. Eligibility cannot be fully evaluated until a daily_loss_limit lock exists (run C1 to create one).",
  });

  // ── D. ruleType is daily_loss_limit ─────────────────────────────────────────
  results.push({
    label: "D. Active lock ruleType is daily_loss_limit",
    status: dailyLossLock != null ? "PASS" : "WARN",
    detail:
      dailyLossLock != null
        ? `daily_loss_limit lock present: [${dailyLossLock.id}] tradingDay=${dailyLossLock.tradingDay} observedAmount=${dailyLossLock.observedAmount}`
        : activeLocks.length > 0
          ? `Active lock(s) exist but none are daily_loss_limit (found: ${activeLocks.map((l) => l.ruleType).join(",")})`
          : "No active daily_loss_limit lock",
  });

  // ── E. brokerActionTaken is false before enforcement ────────────────────────
  if (primaryLock != null) {
    results.push({
      label: "E. brokerActionTaken is false (no broker action yet)",
      status: primaryLock.brokerActionTaken === false ? "PASS" : "WARN",
      detail:
        primaryLock.brokerActionTaken === false
          ? `lock [${primaryLock.id}] brokerActionTaken=false, internalOnly=${primaryLock.internalOnly}`
          : `lock [${primaryLock.id}] brokerActionTaken=true — a broker action was already recorded`,
    });
  } else {
    results.push({
      label: "E. brokerActionTaken is false (no broker action yet)",
      status: "WARN",
      detail: "No active lock to inspect",
    });
  }

  // ── F. BROKER_ENFORCEMENT_ENABLED ───────────────────────────────────────────
  const brokerEnforcementEnabled = process.env.BROKER_ENFORCEMENT_ENABLED === "true";
  results.push({
    label: "F. BROKER_ENFORCEMENT_ENABLED (expected NOT true this phase)",
    status: brokerEnforcementEnabled ? "WARN" : "PASS",
    detail: brokerEnforcementEnabled
      ? `BROKER_ENFORCEMENT_ENABLED='${process.env.BROKER_ENFORCEMENT_ENABLED}' — broker writes ARE enabled. Phase C5 expects this OFF until activation.`
      : `BROKER_ENFORCEMENT_ENABLED='${process.env.BROKER_ENFORCEMENT_ENABLED ?? "(unset)"}' — broker writes disabled (correct, safe state for C5)`,
  });

  // ── G. ENFORCEMENT_DRY_RUN ──────────────────────────────────────────────────
  const enforcementDryRun = process.env.ENFORCEMENT_DRY_RUN === "true";
  results.push({
    label: "G. ENFORCEMENT_DRY_RUN (expected true this phase)",
    status: enforcementDryRun ? "PASS" : "WARN",
    detail: enforcementDryRun
      ? "ENFORCEMENT_DRY_RUN=true — any enforcement would be simulated, no Tradovate write (correct, safe state for C5)"
      : `ENFORCEMENT_DRY_RUN='${process.env.ENFORCEMENT_DRY_RUN ?? "(unset)"}' — dry-run is NOT on. Keep it true until real activation is approved.`,
  });

  // ── H. Tradovate connection + capability ────────────────────────────────────
  const connectionStatus = conn?.connectionStatus ?? null;
  const permissionLevel = conn?.permissionLevel ?? null;
  const NON_LIVE = new Set(["expired", "connection_error", "not_connected", "pending_webhook", "oauth_pending_storage"]);
  const connectionLive = connectionStatus != null && !NON_LIVE.has(connectionStatus);
  const hasFullAccess = permissionLevel === "full_access";
  results.push({
    label: "H. Tradovate connection capability (status + permission)",
    status: conn == null ? "FAIL" : connectionLive && hasFullAccess ? "PASS" : "WARN",
    detail:
      conn == null
        ? "No brokerConnection linked to this account"
        : `connectionId=${conn.id} env=${env} connectionStatus='${connectionStatus ?? "null"}' (live=${connectionLive}) permissionLevel='${permissionLevel ?? "null"}' (Account Risk Settings full_access=${hasFullAccess})`,
  });

  // ── I. no BrokerOrderActionLog rows for today ───────────────────────────────
  const todayStartUtc = new Date(`${todayCtKey}T00:00:00.000Z`);
  const orderActionLogToday = await prisma.brokerOrderActionLog.count({
    where: { connectedAccountId: account.id, createdAt: { gte: todayStartUtc } },
  });
  // Also report any non-dry-run order action ever, as a stronger signal.
  const realOrderActionsEver = await prisma.brokerOrderActionLog.count({
    where: { connectedAccountId: account.id, dryRun: false },
  });
  results.push({
    label: "I. No BrokerOrderActionLog for today (no real broker action)",
    status: orderActionLogToday === 0 ? "PASS" : "WARN",
    detail: `BrokerOrderActionLog rows since ${todayCtKey} 00:00Z: ${orderActionLogToday}; non-dry-run rows ever: ${realOrderActionsEver}`,
  });

  // ── J. Broker-enforcement eligibility (pure gate eval, NO write) ────────────
  // Reuses the production evaluator so the verdict mirrors the listener path.
  // No GuardianIntervention dedup row is created — we pass a benign value for
  // the dedup precondition (assume none exists) since this is a preview only.
  const allowlistIds = parseBrokerEnforcementAllowlist(process.env.BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST);
  const listenerLiveEnabled = process.env.TRADOVATE_LISTENER_ENABLE_LIVE === "true";

  const gate = evaluateBrokerEnforcementGates({
    brokerEnforcementEnabled,
    listenerLiveEnabled,
    allowlistAccountIds: allowlistIds,
    accountId: account.id,
    env: env ?? "live",
    isActive: account.isActive,
    missingFromBroker: account.missingFromBrokerSince != null,
    connectionStatus,
    permissionLevel,
    activeInternalLockEventId: dailyLossLock?.id ?? null,
    ruleType: dailyLossLock?.ruleType ?? "daily_loss_limit",
    observedAmount: dailyLossLock?.observedAmount != null ? Number(dailyLossLock.observedAmount) : null,
    tradingDay: dailyLossLock?.tradingDay ?? cmeTradingDayKey,
    existingInterventionWithDedupKey: false,
  });

  // In C5, "allowed=false because broker_enforcement_disabled" is the CORRECT
  // safe state. We mark INFO so it reads clearly rather than as a failure.
  const eligibilityStatus: Status = gate.allowed
    ? "WARN" // would enforce now — unexpected while we intend to stay dormant
    : "INFO";
  results.push({
    label: "J. Broker-enforcement eligibility (pure gate eval, no write)",
    status: eligibilityStatus,
    detail: gate.allowed
      ? `WOULD ENFORCE — all gates pass. brokerActionType='${gate.brokerActionType}'. (Dormant only because ENFORCEMENT_DRY_RUN/triggerEnforcement is not invoked by this script.)`
      : `Would NOT enforce — blocked at gate '${gate.gateFailureReason}'. ${gate.skipReason}`,
  });

  // Report which gates currently pass, so readiness is visible before flags flip.
  const remainingGates: string[] = [];
  if (env !== "demo") remainingGates.push("env_not_demo");
  if (!allowlistIds.includes(account.id)) remainingGates.push("account_not_allowlisted");
  if (!account.isActive) remainingGates.push("account_inactive");
  if (account.missingFromBrokerSince != null) remainingGates.push("account_missing_from_broker");
  if (!connectionLive) remainingGates.push("connection_not_live");
  if (!hasFullAccess) remainingGates.push("insufficient_permissions");
  if (dailyLossLock == null) remainingGates.push("no_active_internal_lock");
  results.push({
    label: "J2. Non-flag gate readiness (independent of enforcement flags)",
    status: remainingGates.length === 0 ? "PASS" : "WARN",
    detail:
      remainingGates.length === 0
        ? "All account/connection/lock gates pass. Only the BROKER_ENFORCEMENT_ENABLED + allowlist + dry-run flags gate activation."
        : `Gates still failing (independent of flags): ${remainingGates.join(", ")}`,
  });

  // ── Summary table ───────────────────────────────────────────────────────────
  console.log("─".repeat(72));
  console.log("Readiness table:");
  console.log();
  let pass = 0, warn = 0, fail = 0;
  for (const r of results) {
    const icon =
      r.status === "PASS" ? "✅ PASS"
      : r.status === "WARN" ? "⚠️  WARN"
      : r.status === "FAIL" ? "❌ FAIL"
      : "ℹ️  INFO";
    if (r.status === "PASS") pass++;
    else if (r.status === "WARN") warn++;
    else if (r.status === "FAIL") fail++;
    console.log(`  ${icon}  ${r.label}`);
    console.log(`           ${r.detail}`);
  }
  console.log();
  console.log("─".repeat(72));
  console.log(`  PASS: ${pass}  WARN: ${warn}  FAIL: ${fail}  (INFO not counted)`);
  console.log();

  // ── Verdict ─────────────────────────────────────────────────────────────────
  console.log("── C5 Readiness Verdict ────────────────────────────────────────────────");
  console.log();
  if (fail > 0) {
    console.log("  NOT READY — one or more hard prerequisites failed (see FAIL rows).");
  } else if (remainingGates.length === 0 && !gate.allowed) {
    console.log("  READY FOR DRY-RUN ACTIVATION — every account/connection/lock gate");
    console.log("  passes; the only thing keeping enforcement dormant is the");
    console.log("  BROKER_ENFORCEMENT_ENABLED flag (and dry-run). This is the intended");
    console.log("  safe pre-activation state. Do NOT flip flags without approval.");
  } else if (gate.allowed) {
    console.log("  ATTENTION — gates report enforcement WOULD run if triggerEnforcement");
    console.log("  were invoked. Confirm BROKER_ENFORCEMENT_ENABLED and ENFORCEMENT_DRY_RUN");
    console.log("  are set to the intended safe values before any listener wiring.");
  } else {
    console.log("  PRE-READY — account/connection/lock gates are not all satisfied yet.");
    console.log("  Resolve the WARN rows above (e.g. create the daily_loss_limit lock,");
    console.log("  confirm full_access permission) before dry-run activation.");
  }
  console.log();
  console.log("  Reminder: this script performed NO broker write and NO DB mutation.");
  console.log("═".repeat(72));

  await prisma.$disconnect();
}

run().catch(async (err) => {
  console.error("Script error:", err);
  await prisma.$disconnect();
  process.exit(1);
});
