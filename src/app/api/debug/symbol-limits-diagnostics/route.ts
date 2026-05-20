/**
 * GET /api/debug/symbol-limits-diagnostics?account=DEMO7433035
 *
 * Phase 4E read-only QA diagnostic endpoint.
 *
 * Surfaces the live DB state for symbol-specific max contracts so a human can
 * verify, after saving symbol limits through the Trading Plan UI, that:
 *   - AccountRiskRules.maxContractsBySymbolJson was persisted correctly
 *   - the latest RuleChangeAudit captured the field in newValuesJson
 *   - the Phase 4C resolver would pick the per-symbol limit over the fallback
 *
 * Safety:
 *   - Read-only — never writes any DB row, never mutates anything
 *   - No broker calls, no Tradovate API requests, no sync, no applyMaxPositionSize
 *   - Auth: authenticated session + x-cron-secret header (same pattern as the
 *     other /api/debug diagnostic endpoints)
 *   - Only reads rows owned by the current user (account is matched by
 *     externalAccountId or id, scoped to userId)
 *
 * Query params:
 *   - account: required — the broker externalAccountId (e.g. DEMO7433035) or
 *     the internal ConnectedAccount.id
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseSymbolLimits, resolveSymbolLimit } from "@/lib/futures/symbol-limits";

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

  const accountParam = request.nextUrl.searchParams.get("account");
  if (!accountParam) {
    return NextResponse.json(
      { error: "account query param required (externalAccountId or id)" },
      { status: 400 },
    );
  }

  // Match by externalAccountId or internal id — scoped to the current user so
  // a caller can only diagnose their own accounts.
  const account = await prisma.connectedAccount.findFirst({
    where: {
      userId: currentUser.id,
      OR: [{ externalAccountId: accountParam }, { id: accountParam }],
    },
    select: {
      id: true,
      label: true,
      externalAccountId: true,
      connectionStatus: true,
      brokerConnection: { select: { env: true } },
      riskRules: {
        select: { maxContracts: true, maxContractsBySymbolJson: true },
      },
    },
  });

  if (!account) {
    return NextResponse.json(
      { error: "account not found for this user" },
      { status: 404 },
    );
  }

  const hasAccountRiskRules = account.riskRules !== null;
  const maxContracts = account.riskRules?.maxContracts ?? null;
  const maxContractsBySymbolJson = account.riskRules?.maxContractsBySymbolJson ?? null;
  const parsedSymbolLimits = parseSymbolLimits(maxContractsBySymbolJson);

  const hasLimit = (symbol: string, value: number): boolean =>
    parsedSymbolLimits.some((l) => l.symbol === symbol && l.maxContracts === value);

  const expectedPresetCheck = {
    hasNQ1: hasLimit("NQ", 1),
    hasMNQ10: hasLimit("MNQ", 10),
    hasES1: hasLimit("ES", 1),
    hasMES10: hasLimit("MES", 10),
    globalFallbackIs4: maxContracts === 4,
  };

  // ── Latest RuleChangeAudit for this account ──────────────────────────────
  const latestAudit = await prisma.ruleChangeAudit.findFirst({
    where: { accountId: account.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, allowed: true, reason: true, newValuesJson: true },
  });

  let latestRuleChangeAudit: {
    id: string;
    createdAt: string;
    allowed: boolean;
    reason: string;
    newValuesIncludesMaxContractsBySymbolJson: boolean;
    maxContractsBySymbolJsonFromAudit: unknown;
  } | null = null;

  if (latestAudit) {
    const newValues =
      latestAudit.newValuesJson != null && typeof latestAudit.newValuesJson === "object"
        ? (latestAudit.newValuesJson as Record<string, unknown>)
        : {};
    latestRuleChangeAudit = {
      id: latestAudit.id,
      createdAt: latestAudit.createdAt.toISOString(),
      allowed: latestAudit.allowed,
      reason: latestAudit.reason,
      newValuesIncludesMaxContractsBySymbolJson:
        Object.prototype.hasOwnProperty.call(newValues, "maxContractsBySymbolJson"),
      maxContractsBySymbolJsonFromAudit: newValues.maxContractsBySymbolJson ?? null,
    };
  }

  // ── Evaluator preview — pure in-memory simulation of the Phase 4C resolver ─
  // resolveSymbolLimit(symbol, limits, null) isolates the symbol-specific limit;
  // a null result means the resolver would fall back to the global maxContracts.
  function preview(symbol: string, expected: string) {
    const specificLimit = resolveSymbolLimit(symbol, parsedSymbolLimits, null);
    return {
      specificLimit,
      usesSpecific: specificLimit !== null,
      fallback: maxContracts,
      expected,
    };
  }

  const evaluatorPreview = {
    NQ: preview("NQ", "NQ should use 1, not fallback 4"),
    MNQ: preview("MNQ", "MNQ should use 10, not fallback 4"),
    ES: preview("ES", "ES should use 1, not fallback 4"),
    MES: preview("MES", "MES should use 10, not fallback 4"),
    CL: preview("CL", "CL should use fallback 4 if no CL row exists"),
  };

  // ── Verdict ──────────────────────────────────────────────────────────────
  const reasons: string[] = [];
  if (!hasAccountRiskRules) reasons.push("Account has no AccountRiskRules row.");
  if (!expectedPresetCheck.hasNQ1) reasons.push("NQ=1 symbol limit not found.");
  if (!expectedPresetCheck.hasMNQ10) reasons.push("MNQ=10 symbol limit not found.");
  if (!expectedPresetCheck.hasES1) reasons.push("ES=1 symbol limit not found.");
  if (!expectedPresetCheck.hasMES10) reasons.push("MES=10 symbol limit not found.");
  if (!expectedPresetCheck.globalFallbackIs4) {
    reasons.push(`Global fallback maxContracts is not 4 (got ${String(maxContracts)}).`);
  }
  if (!latestRuleChangeAudit) {
    reasons.push("No RuleChangeAudit row found for this account.");
  } else if (!latestRuleChangeAudit.newValuesIncludesMaxContractsBySymbolJson) {
    reasons.push("Latest RuleChangeAudit newValuesJson does not include maxContractsBySymbolJson.");
  }
  if (evaluatorPreview.CL.usesSpecific) {
    reasons.push("CL unexpectedly has a symbol-specific limit (should fall back to global).");
  }

  return NextResponse.json({
    ok: true,
    now: new Date().toISOString(),
    note: "Read-only diagnostic — no writes, no broker calls, no sync.",
    account: {
      id: account.id,
      label: account.label,
      externalAccountId: account.externalAccountId,
      connectionStatus: account.connectionStatus,
      env: account.brokerConnection?.env ?? null,
      hasAccountRiskRules,
    },
    rules: {
      maxContracts,
      maxContractsBySymbolJson,
      parsedSymbolLimits,
      expectedPresetCheck,
    },
    latestRuleChangeAudit,
    evaluatorPreview,
    safety: {
      tradovateClientImported: false,
      applyMaxPositionSizeCalled: false,
      brokerRiskSettingsSyncAuditWritten: false,
      readOnly: true,
    },
    verdict: {
      status: reasons.length === 0 ? "GO" : "NO_GO",
      reasons,
    },
  });
}
