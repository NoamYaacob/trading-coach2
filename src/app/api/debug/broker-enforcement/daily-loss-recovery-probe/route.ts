/**
 * POST /api/debug/broker-enforcement/daily-loss-recovery-probe
 *
 * Phase 2C-C demo-only recovery probe. Allows an operator to:
 *   (a) read the current userAccountAutoLiq record for a single allowlisted
 *       DEMO account (apply=false, default), or
 *   (b) attempt a controlled neutralization write — raise the daily-loss
 *       threshold, lift changesLocked, or both — exactly once, with a strict
 *       confirmation phrase (apply=true).
 *
 * This endpoint exists so we can run ONE live capability probe later to
 * answer the unresolved questions in the readiness audit:
 *   - Can Tradovate accept dailyLossAutoLiq=999_999_999 after a prior write?
 *   - Can changesLocked be flipped from true→false after the initial write?
 *
 * SAFETY CONTRACT (every request runs all of these in order, fail-closed):
 *
 *   Auth
 *     A1. Authenticated session (getCurrentUser).
 *     A2. Caller email passes isAdminEmail.
 *     A3. x-cron-secret header matches process.env.CRON_SECRET.
 *
 *   Body shape
 *     B1. accountId is a non-empty string.
 *     B2. mode ∈ RECOVERY_MODES.
 *     B3. apply is a boolean (default false).
 *     B4. confirm is required when apply=true and must equal
 *         RECOVERY_CONFIRM_PHRASE byte-for-byte.
 *
 *   Account
 *     C1. ConnectedAccount exists and is owned by the caller.
 *     C2. platform === "tradovate".
 *     C3. isActive === true AND missingFromBrokerSince === null.
 *     C4. BrokerConnection.env === "demo".
 *     C5. BrokerConnection.permissionLevel === "full_access".
 *     C6. BrokerConnection.connectionStatus is live (same set the gate
 *         helpers use).
 *     C7. ConnectedAccount.id ∈ BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST.
 *     C8. externalAccountId parses to a valid Tradovate masterid
 *         (parseTradovateMasterId).
 *
 *   Recovery-specific
 *     R1. An existing userAccountAutoLiq record must already exist for
 *         apply=true modes other than read_only. (No /create branch.)
 *
 * Every request — including pure previews — writes a row to
 * BrokerRiskSettingsSyncAudit. Outcomes:
 *   preview      — apply=false; read-only inspection completed
 *   gate_blocked — one of A/B/C/R gates failed
 *   success      — apply=true, gates passed, read-back confirmed the write
 *   failed       — apply=true, gates passed, write or read-back threw
 *
 * What this endpoint DOES NOT do (asserted by source-scan tests):
 *   - No order/cancel, no order/placeorder, no order/liquidatepositions.
 *   - No userAccountAutoLiq/create call.
 *   - No userAccountAutoLiq/delete call (no such API in our wrapper).
 *   - No mutation of BROKER_ENFORCEMENT_ENABLED or any other env var.
 *   - No dependency on ENABLE_TRADOVATE_ORDER_ACTIONS.
 *   - No doNotUnlock in any payload (asserted in payload builder).
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/subscription";
import { prisma } from "@/lib/db";
import { TradovateClient } from "@/lib/brokers/tradovate-client";
import {
  parseTradovateMasterId,
} from "@/lib/brokers/tradovate-master-id";
import {
  parseBrokerEnforcementAllowlist,
} from "@/lib/guardian-engine/broker-enforcement-gate";
import {
  RECOVERY_CONFIRM_PHRASE,
  buildRecoveryPayload,
  isRecoveryMode,
  isRecoveryReadbackConfirmed,
  type RecoveryMode,
} from "@/lib/brokers/tradovate-recovery-payload";
import {
  writeBrokerRiskSettingsSyncAudit,
  type BrokerRiskSettingsSyncAuditPayload,
} from "@/lib/brokers/broker-risk-settings-sync-audit-writer";

const NON_LIVE_CONNECTION_STATUSES = new Set([
  "expired",
  "connection_error",
  "not_connected",
  "pending_webhook",
  "oauth_pending_storage",
]);

type RequestBody = {
  accountId?: unknown;
  mode?: unknown;
  apply?: unknown;
  confirm?: unknown;
};

function jsonError(
  status: number,
  body: Record<string, unknown>,
): NextResponse {
  return NextResponse.json(body, { status });
}

/**
 * Build an audit base record shared between the gate-blocked, preview,
 * success, and failed exit branches. `dryRun=false` always — this endpoint
 * is governed by the per-request `apply` flag, not by ENFORCEMENT_DRY_RUN.
 */
function buildAuditBase(opts: {
  userId: string;
  accountId: string | null;
  externalAccountId: string | null;
  brokerConnectionId: string | null;
  environment: string | null;
}): Omit<BrokerRiskSettingsSyncAuditPayload, "outcome"> {
  return {
    userId: opts.userId,
    accountId: opts.accountId,
    externalAccountId: opts.externalAccountId,
    brokerConnectionId: opts.brokerConnectionId,
    broker: "tradovate",
    ruleType: "daily_loss_recovery_probe",
    environment: opts.environment,
    dryRun: false,
    brokerEnforcementEnabled: process.env.BROKER_ENFORCEMENT_ENABLED === "true",
  };
}

export async function POST(request: NextRequest) {
  // ── A1: authenticated session ───────────────────────────────────────────
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return jsonError(401, { error: "unauthorized" });
  }

  // ── A2: admin-only ──────────────────────────────────────────────────────
  if (!isAdminEmail(currentUser.email)) {
    return jsonError(403, { error: "forbidden", reason: "admin_required" });
  }

  // ── A3: x-cron-secret ───────────────────────────────────────────────────
  const secret = request.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    return jsonError(403, { error: "forbidden", reason: "cron_secret_required" });
  }

  // ── Parse body ──────────────────────────────────────────────────────────
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return jsonError(400, { error: "invalid_json" });
  }

  // ── B1: accountId ───────────────────────────────────────────────────────
  if (typeof body.accountId !== "string" || body.accountId.trim().length === 0) {
    return jsonError(400, { error: "invalid_body", field: "accountId" });
  }
  const accountId = body.accountId.trim();

  // ── B2: mode ────────────────────────────────────────────────────────────
  if (!isRecoveryMode(body.mode)) {
    return jsonError(400, { error: "invalid_body", field: "mode" });
  }
  const mode: RecoveryMode = body.mode;

  // ── B3: apply (default false) ───────────────────────────────────────────
  const apply = body.apply === true;

  // ── B4: confirm phrase (apply=true only) ────────────────────────────────
  if (apply && body.confirm !== RECOVERY_CONFIRM_PHRASE) {
    // No audit row yet — we don't have account context. This is a client
    // input error, not a probe attempt.
    return jsonError(400, {
      error: "confirm_phrase_required",
      reason:
        "apply=true requires the exact confirm phrase. " +
        "See RECOVERY_CONFIRM_PHRASE in tradovate-recovery-payload.ts.",
    });
  }

  // ── Load account + connection ───────────────────────────────────────────
  const account = await prisma.connectedAccount.findFirst({
    where: { id: accountId, userId: currentUser.id },
    select: {
      id: true,
      platform: true,
      externalAccountId: true,
      isActive: true,
      missingFromBrokerSince: true,
      brokerConnectionId: true,
      brokerConnection: {
        select: { env: true, connectionStatus: true, permissionLevel: true },
      },
    },
  });

  if (!account) {
    return jsonError(404, { error: "account_not_found" });
  }

  const baseAudit = buildAuditBase({
    userId: currentUser.id,
    accountId: account.id,
    externalAccountId: account.externalAccountId ?? null,
    brokerConnectionId: account.brokerConnectionId ?? null,
    environment: account.brokerConnection?.env ?? null,
  });

  // Helper: write a gate_blocked audit and return the matching HTTP error.
  const blockGate = async (
    status: number,
    gateFailureReason: string,
    skipReason: string,
  ): Promise<NextResponse> => {
    await writeBrokerRiskSettingsSyncAudit({
      ...baseAudit,
      outcome: "gate_blocked",
      gateFailureReason,
      skipReason,
      payloadPreviewJson: { mode, apply },
    });
    return jsonError(status, {
      error: "gate_blocked",
      gateFailureReason,
      skipReason,
    });
  };

  // ── C2: platform === tradovate ──────────────────────────────────────────
  if (account.platform !== "tradovate") {
    return blockGate(
      400,
      "platform_not_tradovate",
      `Platform '${account.platform}' is not supported by this probe.`,
    );
  }

  // ── C3: account must be available ───────────────────────────────────────
  if (!account.isActive) {
    return blockGate(409, "account_inactive", "Account is inactive (archived).");
  }
  if (account.missingFromBrokerSince != null) {
    return blockGate(
      409,
      "account_missing_from_broker",
      "Account is no longer returned by Tradovate.",
    );
  }

  // ── C4: demo-only — live always blocked ─────────────────────────────────
  const env = account.brokerConnection?.env ?? null;
  if (env !== "demo") {
    return blockGate(
      403,
      env === "live" ? "env_live_blocked" : "env_not_demo",
      `Account env is '${env ?? "unknown"}'. Recovery probe is demo-only.`,
    );
  }

  // ── C5: permission must be full_access ──────────────────────────────────
  const permissionLevel = account.brokerConnection?.permissionLevel ?? null;
  if (permissionLevel !== "full_access") {
    return blockGate(
      403,
      "insufficient_permissions",
      `Permission level '${permissionLevel ?? "unknown"}' is insufficient — Account Risk Settings: Full Access required.`,
    );
  }

  // ── C6: connection must be live ─────────────────────────────────────────
  const connStatus = account.brokerConnection?.connectionStatus ?? "not_connected";
  if (NON_LIVE_CONNECTION_STATUSES.has(connStatus)) {
    return blockGate(
      409,
      "connection_not_live",
      `Connection status '${connStatus}' is not live.`,
    );
  }

  // ── C7: allowlist ───────────────────────────────────────────────────────
  const allowlist = parseBrokerEnforcementAllowlist(
    process.env.BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST,
  );
  if (!allowlist.includes(account.id)) {
    return blockGate(
      403,
      "account_not_allowlisted",
      `Account '${account.id}' is not in BROKER_ENFORCEMENT_DEMO_ACCOUNT_ALLOWLIST.`,
    );
  }

  // ── C8: externalAccountId must parse to a valid masterid ────────────────
  const masterid = parseTradovateMasterId(account.externalAccountId);
  if (masterid == null) {
    return blockGate(
      409,
      "invalid_external_account_id",
      `externalAccountId '${account.externalAccountId ?? "null"}' is not a valid Tradovate masterid.`,
    );
  }

  // ── All gates passed — perform the requested operation ──────────────────
  let client: TradovateClient;
  try {
    client = new TradovateClient(account.id, currentUser.id);
    await client.initialize();
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await writeBrokerRiskSettingsSyncAudit({
      ...baseAudit,
      outcome: "failed",
      gateFailureReason: "client_init_failed",
      errorMessage,
      payloadPreviewJson: { mode, apply },
    });
    return jsonError(500, { error: "client_init_failed", message: errorMessage });
  }

  // Always do a read first — both modes need the current record.
  let existing: Awaited<ReturnType<TradovateClient["readDailyLossAutoLiqRecord"]>>;
  try {
    existing = await client.readDailyLossAutoLiqRecord();
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await writeBrokerRiskSettingsSyncAudit({
      ...baseAudit,
      outcome: "failed",
      gateFailureReason: "readback_failed",
      errorMessage,
      payloadPreviewJson: { mode, apply },
    });
    return jsonError(502, { error: "readback_failed", message: errorMessage });
  }

  // Compute the payload that WOULD be sent if apply=true. For preview mode,
  // this is the only thing we return.
  const payloadPreview =
    mode === "read_only" || existing == null
      ? null
      : buildRecoveryPayload(mode, existing);

  // ── Preview path (apply=false) ──────────────────────────────────────────
  if (!apply) {
    await writeBrokerRiskSettingsSyncAudit({
      ...baseAudit,
      outcome: "preview",
      payloadPreviewJson: {
        mode,
        apply: false,
        existing,
        wouldSend: payloadPreview,
      },
    });
    return NextResponse.json({
      mode,
      apply: false,
      existing,
      wouldSend: payloadPreview,
      note:
        "Preview only — no Tradovate write was made. " +
        "To run a real probe, set apply=true and include the confirm phrase.",
    });
  }

  // ── Apply path (apply=true) ─────────────────────────────────────────────

  // R1: for any write mode, the existing record must already exist —
  // recovery never creates a new record.
  if (mode !== "read_only" && existing == null) {
    return await blockGate(
      409,
      "no_existing_record",
      "No existing userAccountAutoLiq record for this account. Recovery only neutralizes existing records.",
    );
  }

  // read_only with apply=true is a degenerate but legal case — we already
  // performed the read above. Surface confirmed=true (we observed the record)
  // and write a success row.
  if (mode === "read_only") {
    await writeBrokerRiskSettingsSyncAudit({
      ...baseAudit,
      outcome: "success",
      payloadPreviewJson: { mode, apply: true, existing },
      brokerResponseJson: existing,
    });
    return NextResponse.json({
      mode,
      apply: true,
      existing,
      confirmed: existing != null,
      note: "Read-only — no write was made; current record is returned.",
    });
  }

  // Write modes — payloadPreview is guaranteed non-null at this point.
  if (payloadPreview == null) {
    // Defensive: should be unreachable because mode is not read_only and
    // existing is not null.
    return await blockGate(
      500,
      "payload_build_failed",
      "Internal error: failed to build recovery payload.",
    );
  }

  try {
    const result = await client.applyDailyLossRecoveryUpdate(payloadPreview);
    const confirmed = isRecoveryReadbackConfirmed(mode, result.readBack);

    await writeBrokerRiskSettingsSyncAudit({
      ...baseAudit,
      outcome: confirmed ? "success" : "failed",
      gateFailureReason: confirmed ? null : "readback_unconfirmed",
      skipReason: confirmed
        ? null
        : "Tradovate accepted the write but the read-back did not match the expected values.",
      payloadPreviewJson: {
        mode,
        apply: true,
        existing,
        sent: payloadPreview,
        readBack: result.readBack,
      },
      brokerResponseJson: result.response,
    });

    return NextResponse.json({
      mode,
      apply: true,
      attempted: true,
      endpoint: result.endpoint,
      payloadPreview,
      response: result.response,
      readBack: result.readBack,
      confirmed,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await writeBrokerRiskSettingsSyncAudit({
      ...baseAudit,
      outcome: "failed",
      gateFailureReason: "broker_call_threw",
      errorMessage,
      payloadPreviewJson: { mode, apply: true, existing, sent: payloadPreview },
    });
    return jsonError(502, {
      error: "broker_call_failed",
      mode,
      apply: true,
      message: errorMessage,
    });
  }
}
