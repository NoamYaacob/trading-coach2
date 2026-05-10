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

  let result: PermissionProbeResult;
  try {
    const client = new TradovateClient(accountId, userId);
    await client.initialize();
    const rules = await client.getUserAccountAutoLiq();
    result = classifyProbeOutcome({ ok: true, rules });
  } catch (err) {
    result = classifyProbeOutcome({ ok: false, error: err });
  }

  try {
    await prisma.brokerConnection.update({
      where: { id: brokerConnectionId },
      data: {
        permissionLevel: result.level,
        permissionsProbedAt: new Date(),
      },
    });
  } catch (persistErr) {
    console.warn("[permission-probe] failed to persist probe result", {
      brokerConnectionId,
      level: result.level,
      error: persistErr instanceof Error ? persistErr.message : String(persistErr),
    });
  }

  console.info("[permission-probe] probe completed", {
    brokerConnectionId,
    accountId,
    level: result.level,
    httpStatus: result.httpStatus,
    reason: result.reason,
    source: source ?? "unknown",
  });

  return result;
}
