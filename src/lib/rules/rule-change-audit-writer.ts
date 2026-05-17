import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type RuleChangeAuditPayload = {
  userId: string;
  accountId?: string | null;
  scope: "default" | "account";
  oldValuesJson?: Record<string, unknown> | null;
  newValuesJson: Record<string, unknown>;
  allowed: boolean;
  reason: string;
  blockReason?: string | null;
  sessionRiskState?: string | null;
  listenerFreshAt?: Date | null;
  hasOpenPosition?: boolean | null;
  ip?: string | null;
  userAgent?: string | null;
};

export async function writeRuleChangeAudit(payload: RuleChangeAuditPayload): Promise<void> {
  try {
    await prisma.ruleChangeAudit.create({
      data: {
        userId: payload.userId,
        accountId: payload.accountId ?? null,
        scope: payload.scope,
        oldValuesJson: payload.oldValuesJson != null ? (payload.oldValuesJson as Prisma.InputJsonValue) : undefined,
        newValuesJson: payload.newValuesJson as Prisma.InputJsonValue,
        allowed: payload.allowed,
        reason: payload.reason,
        blockReason: payload.blockReason ?? null,
        sessionRiskState: payload.sessionRiskState ?? null,
        listenerFreshAt: payload.listenerFreshAt ?? null,
        hasOpenPosition: payload.hasOpenPosition ?? null,
        ip: payload.ip ?? null,
        userAgent: payload.userAgent ?? null,
      },
    });
  } catch (err) {
    // Audit writes must never crash the main request path.
    console.error("[rule-change-audit] write failed:", err);
  }
}
