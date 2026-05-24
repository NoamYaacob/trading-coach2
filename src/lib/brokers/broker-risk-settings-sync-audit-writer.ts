import { Prisma } from "@prisma/client";
// Relative import (not "@/lib/db") because this writer is reachable from the
// listener-worker import graph, and tsx does not resolve Next.js '@/' aliases.
// See the listener-worker import graph test in broker-enforcement-gate.test.ts.
import { prisma } from "../db";

export type BrokerRiskSettingsSyncAuditPayload = {
  userId: string;
  accountId?: string | null;
  externalAccountId?: string | null;
  brokerConnectionId?: string | null;
  /** Always "tradovate" for now */
  broker: string;
  /** Always "daily_loss_limit" for now */
  ruleType: string;
  /** The dollar amount from the saved rule (positive) */
  amount?: number | null;
  /** "demo" | "live" — from BrokerConnection.env */
  environment?: string | null;
  /** Whether ENFORCEMENT_DRY_RUN=true at call time */
  dryRun: boolean;
  /** Whether BROKER_ENFORCEMENT_ENABLED=true at call time */
  brokerEnforcementEnabled: boolean;
  outcome: "gate_blocked" | "dry_run" | "success" | "failed" | "skipped";
  gateFailureReason?: string | null;
  skipReason?: string | null;
  payloadPreviewJson?: Record<string, unknown> | null;
  brokerResponseJson?: unknown;
  errorMessage?: string | null;
};

export async function writeBrokerRiskSettingsSyncAudit(
  payload: BrokerRiskSettingsSyncAuditPayload,
): Promise<void> {
  try {
    await prisma.brokerRiskSettingsSyncAudit.create({
      data: {
        userId: payload.userId,
        accountId: payload.accountId ?? null,
        externalAccountId: payload.externalAccountId ?? null,
        brokerConnectionId: payload.brokerConnectionId ?? null,
        broker: payload.broker,
        ruleType: payload.ruleType,
        amount: payload.amount ?? null,
        environment: payload.environment ?? null,
        dryRun: payload.dryRun,
        brokerEnforcementEnabled: payload.brokerEnforcementEnabled,
        outcome: payload.outcome,
        gateFailureReason: payload.gateFailureReason ?? null,
        skipReason: payload.skipReason ?? null,
        payloadPreviewJson:
          payload.payloadPreviewJson != null
            ? (payload.payloadPreviewJson as Prisma.InputJsonValue)
            : undefined,
        brokerResponseJson:
          payload.brokerResponseJson != null
            ? (payload.brokerResponseJson as Prisma.InputJsonValue)
            : undefined,
        errorMessage: payload.errorMessage ?? null,
      },
    });
  } catch (err) {
    // Audit writes must never crash the main request path.
    console.error("[broker-risk-settings-sync-audit] write failed:", err);
  }
}
