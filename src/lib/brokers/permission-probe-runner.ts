/**
 * Integration runner for the permission probe.
 *
 * Wraps the pure classifier in `permission-probe.ts` with the broker-client
 * call and the BrokerConnection persistence. Called from:
 *   - Tradovate OAuth callback (one-shot after token exchange / first sync)
 *   - Periodic cron sync (refreshes a stale probe result)
 *
 * Idempotent: subsequent calls overwrite the prior probe outcome with the
 * latest one. Failures are logged but never thrown — a probe failure must
 * not break the surrounding flow (login, sync, etc.).
 */

import { prisma } from "@/lib/db";
import { TradovateClient } from "./tradovate-client";
import {
  classifyProbeOutcome,
  type PermissionProbeResult,
} from "./permission-probe";

export type RunProbeArgs = {
  brokerConnectionId: string;
  /** A ConnectedAccount.id linked to this connection — used to scope the GET. */
  accountId: string;
  /** Owning userId (TradovateClient requires it for token lookup). */
  userId: string;
  /** Caller context for log attribution: "finalize" | "reconnect" | "cron". */
  source?: string;
};

/**
 * Run the capability probe for a BrokerConnection and persist the result.
 *
 * Returns the probe result. On any internal error, returns a `level: "unknown"`
 * result with a reason describing the failure — never throws.
 */
export async function runPermissionProbe(
  args: RunProbeArgs,
): Promise<PermissionProbeResult> {
  const { brokerConnectionId, accountId, userId, source } = args;

  // ── Pre-probe diagnostics ───────────────────────────────────────────────────
  let previousPermissionLevel: string | null = null;
  try {
    const [bc, acct] = await Promise.all([
      prisma.brokerConnection.findUnique({
        where: { id: brokerConnectionId },
        select: { permissionLevel: true, env: true, connectionStatus: true, permissionsProbedAt: true },
      }),
      prisma.connectedAccount.findUnique({
        where: { id: accountId },
        select: { externalAccountId: true, platform: true, connectionStatus: true },
      }),
    ]);
    previousPermissionLevel = bc?.permissionLevel ?? null;
    console.info("[permission-probe] starting probe", {
      brokerConnectionId,
      accountId,
      source: source ?? "unknown",
      env: bc?.env ?? null,
      bcConnectionStatus: bc?.connectionStatus ?? null,
      bcPreviousPermissionLevel: previousPermissionLevel,
      bcPermissionsProbedAt: bc?.permissionsProbedAt?.toISOString() ?? null,
      accountPlatform: acct?.platform ?? null,
      accountConnectionStatus: acct?.connectionStatus ?? null,
      // Log whether externalAccountId is set — a missing one means getUserAccountAutoLiq
      // will throw NO_ACCOUNT_ID, making the probe return "unknown" instead of the real level.
      hasExternalAccountId: Boolean(acct?.externalAccountId),
      externalAccountId: acct?.externalAccountId ?? null,
    });
  } catch (lookupErr) {
    console.warn("[permission-probe] pre-probe lookup failed (non-fatal)", {
      brokerConnectionId,
      accountId,
      error: lookupErr instanceof Error ? lookupErr.message : String(lookupErr),
    });
  }

  // ── Probe call ──────────────────────────────────────────────────────────────
  // Endpoint: GET userAccountAutoLiq/deps?masterid={tvAccountId}
  // 200 → Account Risk Settings read confirmed (same permission gate as write endpoints).
  // 401/403 → Account Risk Settings permission missing; broker writes will fail.
  const probeEndpoint = "userAccountAutoLiq/deps";
  const probeMethod = "GET";

  let result: PermissionProbeResult;
  try {
    const client = new TradovateClient(accountId, userId);
    await client.initialize();
    const rules = await client.getUserAccountAutoLiq();
    result = classifyProbeOutcome({ ok: true, rules });
    console.info("[permission-probe] probe API call succeeded", {
      brokerConnectionId,
      accountId,
      source: source ?? "unknown",
      endpoint: probeEndpoint,
      method: probeMethod,
      httpStatus: result.httpStatus,
      rulesCount: rules.length,
      detectedPermissionLevel: result.level,
      reason: result.reason,
    });
  } catch (err) {
    result = classifyProbeOutcome({ ok: false, error: err });
    const errAny = err as Record<string, unknown> | null;
    console.info("[permission-probe] probe API call failed", {
      brokerConnectionId,
      accountId,
      source: source ?? "unknown",
      endpoint: probeEndpoint,
      method: probeMethod,
      httpStatus: result.httpStatus,
      errorCode: (errAny && typeof errAny.code === "string") ? errAny.code : (err instanceof Error ? err.name : "unknown"),
      // Log the error message. getUserAccountAutoLiq throws for: NO_ACCOUNT_ID (missing
      // externalAccountId), API_ERROR (401/403/5xx from Tradovate), NETWORK_ERROR,
      // CONFIG_MISSING, TOKEN_LOAD_FAILED. None of these messages contain token values.
      errorMessage: err instanceof Error ? err.message : String(err),
      detectedPermissionLevel: result.level,
      reason: result.reason,
    });
  }

  // ── Persist ─────────────────────────────────────────────────────────────────
  try {
    await prisma.brokerConnection.update({
      where: { id: brokerConnectionId },
      data: {
        permissionLevel: result.level,
        permissionsProbedAt: new Date(),
      },
    });
    console.info("[permission-probe] probe result persisted", {
      brokerConnectionId,
      source: source ?? "unknown",
      previousPermissionLevel,
      newPermissionLevel: result.level,
      httpStatus: result.httpStatus,
      reason: result.reason,
    });
  } catch (persistErr) {
    console.warn("[permission-probe] failed to persist probe result", {
      brokerConnectionId,
      level: result.level,
      error: persistErr instanceof Error ? persistErr.message : String(persistErr),
    });
  }

  // ── Cascade healthy BC status to stale account rows ──────────────────────────
  // A probe runs after reconnect. At that point the BC.connectionStatus is
  // already "connected_readonly", but linked ConnectedAccount rows may still
  // carry stale "expired" or "connection_error" status from the prior expiry
  // cascade. Heal them here so the Dashboard reflects the correct state without
  // waiting for the next full sync.
  try {
    const bc = await prisma.brokerConnection.findUnique({
      where: { id: brokerConnectionId },
      select: { connectionStatus: true },
    });
    if (
      bc &&
      (bc.connectionStatus === "connected_readonly" || bc.connectionStatus === "connected_live")
    ) {
      const healed = await prisma.connectedAccount.updateMany({
        where: {
          brokerConnectionId,
          connectionStatus: { in: ["expired", "connection_error"] },
          missingFromBrokerSince: null,
        },
        data: { connectionStatus: bc.connectionStatus, errorMessage: null },
      });
      if (healed.count > 0) {
        console.info("[permission-probe] healed stale account connectionStatus rows", {
          brokerConnectionId,
          source: source ?? "unknown",
          bcConnectionStatus: bc.connectionStatus,
          healedCount: healed.count,
        });
      }
    }
  } catch (healErr) {
    console.warn("[permission-probe] cascade heal failed (non-fatal)", {
      brokerConnectionId,
      error: healErr instanceof Error ? healErr.message : String(healErr),
    });
  }

  return result;
}
