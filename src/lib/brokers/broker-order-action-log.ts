/**
 * Audit log writer for manual broker order actions (cancel orders, flatten positions).
 *
 * Separate from GuardianIntervention — that model records automatic enforcement
 * triggers. This model records on-demand / manual broker actions.
 *
 * Never logs access tokens, refresh tokens, or raw secrets.
 */

import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

export type WriteBrokerOrderActionLogInput = {
  userId: string;
  connectedAccountId: string;
  externalAccountId: string | null;
  /** "cancel_orders" | "flatten_positions" */
  actionType: string;
  triggerReason: string;
  dryRun: boolean;
  requestSummary: Record<string, unknown> | null;
  responseSummary: Record<string, unknown> | null;
  success: boolean;
  errorMessage: string | null;
};

export async function writeBrokerOrderActionLog(
  input: WriteBrokerOrderActionLogInput,
): Promise<void> {
  await prisma.brokerOrderActionLog.create({
    data: {
      userId: input.userId,
      connectedAccountId: input.connectedAccountId,
      externalAccountId: input.externalAccountId,
      actionType: input.actionType,
      triggerReason: input.triggerReason,
      dryRun: input.dryRun,
      requestSummary: (input.requestSummary ?? undefined) as Prisma.InputJsonValue | undefined,
      responseSummary: (input.responseSummary ?? undefined) as Prisma.InputJsonValue | undefined,
      success: input.success,
      errorMessage: input.errorMessage,
    },
  });
}
