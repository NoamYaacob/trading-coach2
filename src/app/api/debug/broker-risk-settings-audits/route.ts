/**
 * GET /api/debug/broker-risk-settings-audits?accountId=<ConnectedAccount.id>[&limit=20]
 *
 * Read-only diagnostic endpoint. Returns the BrokerRiskSettingsSyncAudit
 * history for a single account so an operator can verify what Guardrail has
 * (or has not) written to Tradovate before running a recovery probe.
 *
 * Safety:
 *   - Read-only — never writes any DB row, never mutates anything
 *   - No broker calls, no TradovateClient import, no Tradovate API requests
 *   - Auth: authenticated session + x-cron-secret header
 *   - User-scoped: the account must belong to the current session user
 *   - No secret values returned (no tokens, no encrypted fields)
 *   - limit defaults to 20, capped at 100
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export async function GET(request: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const secret = request.headers.get("x-cron-secret");
  const expected = process.env.CRON_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const accountId = request.nextUrl.searchParams.get("accountId");
  if (!accountId) {
    return NextResponse.json(
      { error: "accountId query param required" },
      { status: 400 },
    );
  }

  const limitParam = request.nextUrl.searchParams.get("limit");
  const parsedLimit = limitParam != null ? parseInt(limitParam, 10) : DEFAULT_LIMIT;
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(parsedLimit, MAX_LIMIT)
    : DEFAULT_LIMIT;

  // Verify the account belongs to the current user before querying audits.
  const account = await prisma.connectedAccount.findFirst({
    where: { id: accountId, userId: currentUser.id },
    select: {
      id: true,
      label: true,
      externalAccountId: true,
      platform: true,
      connectionStatus: true,
      brokerConnection: {
        select: {
          env: true,
          permissionLevel: true,
        },
      },
    },
  });

  if (!account) {
    return NextResponse.json(
      { error: "account not found for this user" },
      { status: 404 },
    );
  }

  const audits = await prisma.brokerRiskSettingsSyncAudit.findMany({
    where: { accountId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      ruleType: true,
      amount: true,
      environment: true,
      dryRun: true,
      brokerEnforcementEnabled: true,
      outcome: true,
      gateFailureReason: true,
      skipReason: true,
      payloadPreviewJson: true,
      brokerResponseJson: true,
      errorMessage: true,
    },
  });

  // Summary counts across ALL rows for this account (not just the page).
  const allOutcomes = await prisma.brokerRiskSettingsSyncAudit.groupBy({
    by: ["outcome"],
    where: { accountId },
    _count: { outcome: true },
  });

  const countsByOutcome: Record<string, number> = {};
  let total = 0;
  for (const row of allOutcomes) {
    countsByOutcome[row.outcome] = row._count.outcome;
    total += row._count.outcome;
  }

  const summary = {
    total,
    success: countsByOutcome["success"] ?? 0,
    failed: countsByOutcome["failed"] ?? 0,
    preview: countsByOutcome["preview"] ?? 0,
    gate_blocked: countsByOutcome["gate_blocked"] ?? 0,
    dry_run: countsByOutcome["dry_run"] ?? 0,
    skipped: countsByOutcome["skipped"] ?? 0,
  };

  // hasAnySuccess: any row with outcome=success
  const hasAnySuccess = summary.success > 0;

  // hasAnyBrokerWrite: outcome=success AND brokerResponseJson is non-null, for
  // a write-type rule (excludes daily_loss_recovery_probe which is read-only
  // in preview mode). Checked against the fetched page; increase limit if
  // summary.success > audits.filter(success).length to catch all rows.
  const hasAnyBrokerWrite = audits.some(
    (a) =>
      a.outcome === "success" &&
      a.brokerResponseJson != null &&
      a.ruleType !== "daily_loss_recovery_probe",
  );

  // Latest recovery probe preview row (outcome=preview, ruleType=daily_loss_recovery_probe).
  const latestRecoveryPreview =
    audits.find(
      (a) => a.outcome === "preview" && a.ruleType === "daily_loss_recovery_probe",
    ) ?? null;

  return NextResponse.json({
    ok: true,
    note: "Read-only diagnostic — no writes, no broker calls.",
    account: {
      id: account.id,
      label: account.label,
      externalAccountId: account.externalAccountId,
      platform: account.platform,
      env: account.brokerConnection?.env ?? null,
      connectionStatus: account.connectionStatus,
      permissionLevel: account.brokerConnection?.permissionLevel ?? null,
    },
    query: {
      accountId,
      limit,
      defaultLimit: DEFAULT_LIMIT,
      maxLimit: MAX_LIMIT,
    },
    summary,
    hasAnySuccess,
    hasAnyBrokerWrite,
    latestRecoveryPreview: latestRecoveryPreview
      ? {
          id: latestRecoveryPreview.id,
          createdAt: latestRecoveryPreview.createdAt,
          ruleType: latestRecoveryPreview.ruleType,
          outcome: latestRecoveryPreview.outcome,
          payloadPreviewJson: latestRecoveryPreview.payloadPreviewJson,
          brokerResponseJson: latestRecoveryPreview.brokerResponseJson,
          errorMessage: latestRecoveryPreview.errorMessage,
        }
      : null,
    audits: audits.map((a) => ({
      id: a.id,
      createdAt: a.createdAt,
      ruleType: a.ruleType,
      amount: a.amount,
      environment: a.environment,
      dryRun: a.dryRun,
      brokerEnforcementEnabled: a.brokerEnforcementEnabled,
      outcome: a.outcome,
      gateFailureReason: a.gateFailureReason,
      skipReason: a.skipReason,
      payloadPreviewJson: a.payloadPreviewJson,
      brokerResponseJson: a.brokerResponseJson,
      errorMessage: a.errorMessage,
    })),
  });
}
