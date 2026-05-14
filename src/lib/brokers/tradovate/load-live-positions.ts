/**
 * Shared live-position loader for both sync and debug paths.
 *
 * Uses getRawPositions() (unfiltered position/list) then applies an explicit
 * numeric comparison against externalAccountId so both paths are guaranteed to
 * use identical filtering logic. This prevents parity bugs caused by
 * TradovateClient's internal #tvAccountId being null in one path but not another.
 *
 * Filter rule: Number(externalAccountId) === rawPosition.accountId
 * Never compare the Guardrail DB account.id (a CUID string) to accountId.
 */

import type { TradovateClient, TvPosition } from "@/lib/brokers/tradovate-client";

export type PositionLoadDiagnostics = {
  /** Numeric Tradovate account ID derived from externalAccountId for position filtering. */
  tradovateAccountIdUsedForPositionFetch: number | null;
  /** Total positions returned by position/list before any filtering. */
  rawPositionCount: number;
  /** Sample of raw positions (up to 5) for debugging — no tokens or PII. */
  rawPositionsSample: Array<{ id: number; accountId: number; contractId: number; netPos: number | null }>;
  /** Positions matching this account's numeric tradovate ID. */
  filteredByAccountCount: number;
  /** Non-zero netPos positions after the account filter. */
  filteredPositionCount: number;
  /** Sample of non-zero positions (up to 5). */
  filteredPositionsSample: Array<{ contractId: number; netPos: number }>;
  /** Always "position/list". */
  positionFetchSource: "position/list";
  /** Human-readable description of the filter applied. */
  positionFilterReason: string;
};

export type OpenPosition = {
  symbol: string;
  side: "LONG" | "SHORT";
  quantity: number;
  unrealizedPnL: number | null;
};

export type LivePositionsResult = {
  openPositions: OpenPosition[];
  /** Tradovate numeric contractIds for open positions — use these as flatten keys, not symbols. */
  openPositionContractIds: number[];
  hasOpenPositions: boolean;
  /** Inputs suitable for computeMiniEquivalentExposure / deriveMaxPositionSizeBreach. */
  exposureInputs: Array<{ symbol: string; netPos: number }>;
  diagnostics: PositionLoadDiagnostics;
};

/**
 * Load live open positions for a single account.
 *
 * Fetches all positions from Tradovate, filters to the account by numeric
 * Tradovate account ID, resolves contractIds to symbol names, and returns
 * full diagnostics so any filter discrepancy is immediately visible in logs.
 */
export async function loadLivePositions(
  client: TradovateClient,
  externalAccountId: string,
): Promise<LivePositionsResult> {
  const tvAccountId = parseInt(externalAccountId, 10);
  const tvAccountIdIsValid = !Number.isNaN(tvAccountId);

  const rawPositions: TvPosition[] = await client.getRawPositions();

  // Explicit numeric comparison — never compare the Guardrail DB account.id string.
  const byAccount = tvAccountIdIsValid
    ? rawPositions.filter((p) => p.accountId === tvAccountId)
    : rawPositions;

  const nonZero = byAccount.filter((p) => p.netPos !== null && p.netPos !== 0);
  const hasOpenPositions = nonZero.length > 0;
  // contractId is the Tradovate numeric ID — the correct key for flatten payloads.
  const openPositionContractIds = nonZero.map((p) => p.contractId);

  let openPositions: OpenPosition[] = [];
  let exposureInputs: Array<{ symbol: string; netPos: number }> = [];

  if (hasOpenPositions) {
    const uniqueIds = [...new Set(nonZero.map((p) => p.contractId))];
    const contractMap = await client.resolveContracts(uniqueIds);
    openPositions = nonZero.map((p) => ({
      symbol: contractMap.get(p.contractId) ?? String(p.contractId),
      side: (p.netPos ?? 0) > 0 ? ("LONG" as const) : ("SHORT" as const),
      quantity: Math.abs(p.netPos ?? 0),
      unrealizedPnL: p.openPl ?? null,
    }));
    exposureInputs = nonZero.map((p) => ({
      symbol: contractMap.get(p.contractId) ?? String(p.contractId),
      netPos: p.netPos!,
    }));
  }

  const diagnostics: PositionLoadDiagnostics = {
    tradovateAccountIdUsedForPositionFetch: tvAccountIdIsValid ? tvAccountId : null,
    rawPositionCount: rawPositions.length,
    rawPositionsSample: rawPositions.slice(0, 5).map((p) => ({
      id: p.id,
      accountId: p.accountId,
      contractId: p.contractId,
      netPos: p.netPos,
    })),
    filteredByAccountCount: byAccount.length,
    filteredPositionCount: nonZero.length,
    filteredPositionsSample: nonZero.slice(0, 5).map((p) => ({
      contractId: p.contractId,
      netPos: p.netPos!,
    })),
    positionFetchSource: "position/list",
    positionFilterReason: tvAccountIdIsValid
      ? `p.accountId === ${tvAccountId} (Number("${externalAccountId}"))`
      : `externalAccountId "${externalAccountId}" is not a valid integer — all ${rawPositions.length} positions included`,
  };

  return { openPositions, openPositionContractIds, hasOpenPositions, exposureInputs, diagnostics };
}
