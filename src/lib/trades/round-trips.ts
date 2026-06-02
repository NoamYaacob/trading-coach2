/**
 * Pure round-trip trade reconstruction from broker fills.
 *
 * Each `NormalizedTradeEvent` is a single broker fill (entry, scale-in, or
 * exit).  A "round-trip trade" is a position that opened from flat, was
 * possibly grown/reduced, and returned to flat.  We reconstruct these by
 * walking fills chronologically per contract and matching exits against
 * earlier entries using FIFO.
 *
 * Used by the /trades page and the dashboard "Today's trades" panel.  Pure
 * function — no DB, no I/O, safe for unit tests.
 */

import { classifyFill, normalizeSide } from "../guardian-engine/fill-classifier.ts";
import { FUTURES_SPECS } from "../instruments.ts";

/** Check if a symbol matches the futures month-code pattern (e.g. "MNQM6").
 *  Exported so callers (scripts, UI) can validate a symbol the same way. */
export function isValidFuturesSymbol(symbol: string): boolean {
  return /^([A-Z]+)[FGHJKMNQUVXZ]\d{1,2}$/.test(symbol);
}

/** Exported for diagnostics. Parses a month-coded futures symbol (e.g. "MNQM6")
 *  and returns its dollar-per-point value from FUTURES_SPECS. Returns 1 for
 *  unknown symbols so callers never crash. */
export function getContractPointValue(symbol: string): number {
  const match = symbol.match(/^([A-Z]+)[FGHJKMNQUVXZ]\d{1,2}$/);
  const root = match?.[1];
  if (root && root in FUTURES_SPECS) return FUTURES_SPECS[root]!.pointValue;
  return 1;
}

/**
 * Extract the broker-reported commission/fee for a single fill.
 *
 * Tradovate fills carry a `commission` field that the sync ingestion stores in
 * `NormalizedTradeEvent.rawPayload` (no schema column — see tradovate-sync).
 * This reads it back as a positive magnitude (a cost).  Returns `null` when no
 * fee data is present, so callers can distinguish "fees are zero" from "fees
 * unknown" and never fabricate a net figure.
 */
export function extractFillFee(fill: FillInput): number | null {
  const rp = fill.rawPayload;
  if (rp != null && typeof rp === "object") {
    const raw = (rp as Record<string, unknown>).commission;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      // Commission is a cost; normalise to a positive magnitude regardless of
      // the sign the broker reports it with.
      return Math.abs(raw);
    }
  }
  return null;
}

/**
 * Combine entry-side and close-side fees for a round trip into a single
 * `{ fees, feesAvailable }`.
 *
 * `feesAvailable` is true when EITHER side carried broker fee data.  When
 * neither side did, `fees` is `null` (unknown — never fabricated as 0) so the
 * UI can fall back to the authoritative broker session snapshot for net P&L.
 */
function combineFees(
  anyEntryFee: boolean,
  entryFeesConsumed: number,
  closeFee: number | null,
): { fees: number | null; feesAvailable: boolean } {
  const feesAvailable = anyEntryFee || closeFee != null;
  if (!feesAvailable) return { fees: null, feesAvailable: false };
  return { fees: entryFeesConsumed + (closeFee ?? 0), feesAvailable: true };
}

export type FillInput = {
  id: string;
  externalTradeId: string | null;
  contractId: number | null;
  side: string | null;
  quantity: string | null;
  price: string | null;
  pnl: string | null;
  occurredAt: Date;
  rawPayload: unknown;
};

export type RoundTripTrade = {
  /** Composite id from the closing fill so React keys are stable. */
  id: string;
  /** Symbol from rawPayload.contract.name / .symbol, falls back to contractId. */
  symbol: string;
  /** Position direction at entry — "LONG" if first fill was BUY, else "SHORT". */
  side: "LONG" | "SHORT";
  /** Total contracts closed in this round trip. */
  qty: number;
  /** Volume-weighted entry price across all opening fills. */
  entryPrice: number;
  /** Volume-weighted exit price across all closing fills for this trip. */
  exitPrice: number;
  openedAt: Date;
  closedAt: Date;
  holdMs: number;
  /** Realized P&L BEFORE fees/commissions.  Sum of broker-provided pnl on
   *  closing fills when available; otherwise computed as
   *  (exit-entry)*qty*sideMultiplier.  Retained for diagnostics / fee math —
   *  user-facing surfaces should display `netPnl`. */
  pnl: number;
  /** True if at least one closing fill had a non-null broker pnl. */
  pnlSource: "broker" | "computed";
  /**
   * Whether the gross `pnl` value came from the broker fill P&L or was purely
   * computed from entry/exit prices.  Fill-based round-trips are
   * "broker_gross" (Tradovate fill P&L does not deduct commissions).
   */
  pnlType: "broker_gross" | "computed";
  /**
   * Total commission/fees attributed to this round trip, summed from the
   * `commission` carried on its constituent fills (prorated across partially
   * consumed opening lots + the closing fill).  `null` when NONE of the fills
   * carried fee data — meaning a true net figure cannot be derived for this
   * trade from the broker fill stream.
   *
   * Fees are a positive magnitude (a cost) subtracted from gross to get net.
   */
  fees: number | null;
  /** True when at least one constituent fill carried broker fee data, so
   *  `netPnl` reflects fees actually reported by the broker. */
  feesAvailable: boolean;
  /**
   * Net realized P&L AFTER fees: `pnl - (fees ?? 0)`.  This is the
   * user-facing P&L.  When `feesAvailable` is false it equals `pnl` (the
   * broker reported no per-fill commission for this trade); the authoritative
   * net session figure in that case is LiveSessionState.dailyPnl (broker
   * session snapshot), surfaced as "Broker Session P&L" on the dashboard.
   */
  netPnl: number;
  /** True when `symbol` resolved to a real futures contract (valid month code).
   *  False when the symbol could not be resolved (e.g. "#4327110" / "—") and the
   *  point-value multiplier defaulted to $1/pt — such P&L is LOW CONFIDENCE and
   *  callers should label it as incomplete rather than trusting it. */
  symbolResolved: boolean;
};

type OpenLot = {
  qty: number;
  price: number;
  openedAt: Date;
  /** Commission per contract for this lot (total lot fee / original lot qty),
   *  so a partial close can attribute the correct fraction of the entry fee.
   *  `null` when the opening fill carried no fee data. */
  feePerUnit: number | null;
};

type OpenPosition = {
  side: "LONG" | "SHORT";
  lots: OpenLot[];
  /** Symbol captured from the first opening fill — preferred over the closing
   *  fill's symbol since "what was traded" is determined at entry. */
  symbol: string;
};

/** Static mapping of known Tradovate contract IDs to futures symbols.
 *  Used when rawPayload has no valid symbol and contractIdMap has no entry.
 *  This is a safe fallback based on verified production data (confirmed against
 *  the official Tradovate Performance reports for DEMO7433035 and 1868411). */
const KNOWN_CONTRACT_ID_MAP: Record<number, string> = {
  4327110: "MNQM6", // Micro E-mini Nasdaq-100 Mar 2026
  4214191: "NQM6",  // E-mini Nasdaq-100 Mar 2026
};

/** Read the raw symbol candidate from a fill's rawPayload (if any). Does NOT
 *  validate — callers decide whether to accept it. */
function rawPayloadSymbol(fill: FillInput): string | undefined {
  const payload = fill.rawPayload as
    | { contract?: { name?: string; symbol?: string }; symbol?: string; contractName?: string }
    | null
    | undefined;
  return (
    payload?.contract?.name ??
    payload?.contract?.symbol ??
    payload?.symbol ??
    payload?.contractName ??
    undefined
  );
}

/** Resolve the effective Tradovate contract id for a fill.
 *
 *  Critical: the DB `contractId` column is null for fills ingested by paths that
 *  stored the broker payload verbatim without copying the id into the column.
 *  Those payloads still carry the numeric id, but in several different shapes:
 *    - TradovateOrderFill.contractId / contract.id (webhook path)
 *    - rawPayload.symbol holding the *numeric id* as a string, e.g.
 *      {"symbol":"4327110","orderId":"…"} (sync path where ex.symbol was the
 *      contract id rather than a real futures symbol)
 *  So we scan every id-bearing and symbol-bearing field and accept the first
 *  numeric-only value. A numeric-only "symbol" is an id, never a real symbol. */
export function resolveEffectiveContractId(fill: FillInput): number | null {
  if (fill.contractId != null) return fill.contractId;
  const p = fill.rawPayload as
    | {
        contractId?: unknown;
        contract?: { id?: unknown; name?: unknown; symbol?: unknown };
        symbol?: unknown;
        contractName?: unknown;
      }
    | null
    | undefined;
  const candidates = [
    p?.contractId,
    p?.contract?.id,
    p?.symbol,
    p?.contract?.name,
    p?.contract?.symbol,
    p?.contractName,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === "string" && /^\d+$/.test(candidate)) return Number(candidate);
  }
  return null;
}

/** Build a contractId → symbol map from a set of fills, keeping only entries
 *  whose payload symbol is a valid futures month-code. Numeric-only payload
 *  values (e.g. "4327110") are rejected so they never masquerade as symbols.
 *  Centralized here so every caller (UI loader, diagnostic scripts) resolves
 *  identically. */
export function buildContractIdMap(fills: FillInput[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const f of fills) {
    const sym = rawPayloadSymbol(f);
    const cid = resolveEffectiveContractId(f);
    if (sym && isValidFuturesSymbol(sym) && cid != null && !map.has(cid)) {
      map.set(cid, sym);
    }
  }
  return map;
}

/** Detailed symbol-resolution result, surfaced for diagnostics and UI so the
 *  raw contract id and the final resolved symbol can be reported separately. */
export type SymbolResolution = {
  /** The effective contract id (DB column or recovered from rawPayload). */
  rawContractId: number | null;
  /** The resolved symbol — a valid futures code when `resolved` is true,
   *  otherwise a "#<id>" / "—" placeholder. */
  symbol: string;
  /** True when the symbol resolved to a real futures contract. */
  resolved: boolean;
  /** Point value in $/pt for the resolved symbol (1 when unresolved). */
  pointValue: number;
  /** Where the symbol came from — useful when explaining reconciliation. */
  source: "payload" | "discovered_map" | "known_map" | "unresolved";
};

/** Resolve a fill's symbol with full provenance. The resolution order is:
 *  1. valid futures symbol embedded in rawPayload,
 *  2. discovered contractId → symbol map (built from sibling fills),
 *  3. hardcoded known contractId → symbol map,
 *  4. unresolved placeholder ("#<id>" or "—").
 *  Numeric-only candidates are rejected at every step so a contract id can
 *  never be mistaken for a symbol. */
export function resolveSymbol(
  fill: FillInput,
  contractIdMap?: Map<number, string>,
): SymbolResolution {
  const rawContractId = resolveEffectiveContractId(fill);

  const fromPayload = rawPayloadSymbol(fill);
  if (fromPayload && isValidFuturesSymbol(fromPayload)) {
    return { rawContractId, symbol: fromPayload, resolved: true, pointValue: getContractPointValue(fromPayload), source: "payload" };
  }

  if (rawContractId != null && contractIdMap?.has(rawContractId)) {
    const mapped = contractIdMap.get(rawContractId)!;
    if (isValidFuturesSymbol(mapped)) {
      return { rawContractId, symbol: mapped, resolved: true, pointValue: getContractPointValue(mapped), source: "discovered_map" };
    }
  }

  if (rawContractId != null && rawContractId in KNOWN_CONTRACT_ID_MAP) {
    const known = KNOWN_CONTRACT_ID_MAP[rawContractId]!;
    return { rawContractId, symbol: known, resolved: true, pointValue: getContractPointValue(known), source: "known_map" };
  }

  return {
    rawContractId,
    symbol: rawContractId != null ? `#${rawContractId}` : "—",
    resolved: false,
    pointValue: 1,
    source: "unresolved",
  };
}

function extractSymbol(fill: FillInput, contractIdMap?: Map<number, string>): string {
  return resolveSymbol(fill, contractIdMap).symbol;
}

// NOTE: contractKey intentionally keys off the *DB* contractId column only (not
// the rawPayload-recovered id). It governs FIFO bucket grouping, and changing it
// would re-pair fills and alter round-trip counts/P&L that already reconcile to
// the official broker reports. Symbol/point-value resolution (resolveSymbol)
// separately recovers the id from rawPayload — that affects only the $/pt
// multiplier, never which fills are matched together.
function contractKey(fill: FillInput): string {
  if (fill.contractId != null) return `cid:${fill.contractId}`;
  const payload = fill.rawPayload as { symbol?: string } | null;
  return `sym:${payload?.symbol ?? "unknown"}`;
}

/**
 * Reconstruct round-trip trades from a chronological list of fills.
 *
 * Fills are sorted by occurredAt + externalTradeId for stable ordering when
 * two fills share a timestamp.  Per contract, lots are tracked FIFO: each
 * entry fill enqueues a lot, each exit fill consumes lots from the front of
 * the queue.  When the position returns to flat, a round-trip is emitted.
 *
 * Reversals (sign flip without touching flat) close the existing position
 * and open a new one in the opposite direction with the remaining quantity.
 *
 * @param contractIdMap Optional map of contractId (number) → symbol (string) for
 *   resolving contractId when rawPayload has no symbol. If provided, fills
 *   with missing rawPayload symbols will be looked up here before falling back
 *   to numeric contractId.
 */
export function reconstructRoundTrips(
  fills: FillInput[],
  contractIdMap?: Map<number, string>
): RoundTripTrade[] {
  const sorted = [...fills].sort((a, b) => {
    const t = a.occurredAt.getTime() - b.occurredAt.getTime();
    if (t !== 0) return t;
    const aId = a.externalTradeId != null ? Number(a.externalTradeId) : 0;
    const bId = b.externalTradeId != null ? Number(b.externalTradeId) : 0;
    return aId - bId;
  });

  const positions = new Map<string, OpenPosition>();
  const trades: RoundTripTrade[] = [];

  for (const fill of sorted) {
    const side = normalizeSide(fill.side);
    const qty = Number(fill.quantity);
    const price = Number(fill.price);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (!Number.isFinite(price)) continue;

    const key = contractKey(fill);
    const open = positions.get(key);
    const netBefore = open
      ? open.lots.reduce((s, l) => s + l.qty, 0) * (open.side === "LONG" ? 1 : -1)
      : 0;
    const cls = classifyFill(netBefore, side, qty);
    const symbol = extractSymbol(fill, contractIdMap);
    const brokerPnl = fill.pnl != null ? Number(fill.pnl) : null;
    const fillFee = extractFillFee(fill);
    const feePerUnit = fillFee != null && qty > 0 ? fillFee / qty : null;

    if (cls === "entry") {
      positions.set(key, {
        side: side === "BUY" ? "LONG" : "SHORT",
        lots: [{ qty, price, openedAt: fill.occurredAt, feePerUnit }],
        symbol,
      });
      continue;
    }

    if (cls === "scale_in" && open) {
      open.lots.push({ qty, price, openedAt: fill.occurredAt, feePerUnit });
      continue;
    }

    if (cls === "reduction" && open) {
      let remaining = qty;
      let consumedQty = 0;
      let entryWeighted = 0;
      let earliestOpen: Date | null = null;
      // Entry-side fees attributed to the lots consumed by this close.
      let entryFeesConsumed = 0;
      let anyEntryFee = false;

      while (remaining > 0 && open.lots.length > 0) {
        const lot = open.lots[0]!;
        const take = Math.min(remaining, lot.qty);
        consumedQty += take;
        entryWeighted += lot.price * take;
        if (lot.feePerUnit != null) {
          entryFeesConsumed += lot.feePerUnit * take;
          anyEntryFee = true;
        }
        if (earliestOpen == null || lot.openedAt < earliestOpen) earliestOpen = lot.openedAt;
        lot.qty -= take;
        remaining -= take;
        if (lot.qty === 0) open.lots.shift();
      }

      const sideMul = open.side === "LONG" ? 1 : -1;
      const entryPriceAvg = consumedQty > 0 ? entryWeighted / consumedQty : 0;
      const pointValue = getContractPointValue(open.symbol);
      const computedPnl = (price - entryPriceAvg) * consumedQty * sideMul * pointValue;
      const grossPnl = brokerPnl != null ? brokerPnl : computedPnl;
      const { fees, feesAvailable } = combineFees(anyEntryFee, entryFeesConsumed, fillFee);

      trades.push({
        id: `${key}-${fill.id}`,
        symbol: open.symbol,
        side: open.side,
        qty: consumedQty,
        entryPrice: entryPriceAvg,
        exitPrice: price,
        openedAt: earliestOpen ?? fill.occurredAt,
        closedAt: fill.occurredAt,
        holdMs: fill.occurredAt.getTime() - (earliestOpen?.getTime() ?? fill.occurredAt.getTime()),
        pnl: grossPnl,
        pnlSource: brokerPnl != null ? "broker" : "computed",
        pnlType: brokerPnl != null ? "broker_gross" : "computed",
        fees,
        feesAvailable,
        netPnl: grossPnl - (fees ?? 0),
        symbolResolved: isValidFuturesSymbol(open.symbol),
      });

      if (open.lots.length === 0) positions.delete(key);
      continue;
    }

    if (cls === "reversal" && open) {
      const openQty = open.lots.reduce((s, l) => s + l.qty, 0);
      let closeRemaining = openQty;
      let entryWeighted = 0;
      let earliestOpen: Date | null = null;
      let entryFeesConsumed = 0;
      let anyEntryFee = false;

      for (const lot of open.lots) {
        entryWeighted += lot.price * lot.qty;
        if (lot.feePerUnit != null) {
          entryFeesConsumed += lot.feePerUnit * lot.qty;
          anyEntryFee = true;
        }
        if (earliestOpen == null || lot.openedAt < earliestOpen) earliestOpen = lot.openedAt;
      }

      const sideMul = open.side === "LONG" ? 1 : -1;
      const entryPriceAvg = openQty > 0 ? entryWeighted / openQty : 0;
      const pointValue = getContractPointValue(open.symbol);
      const computedPnl = (price - entryPriceAvg) * openQty * sideMul * pointValue;
      const grossPnl = brokerPnl != null ? brokerPnl : computedPnl;
      // The closing fill's commission covers the whole fill (qty). Attribute
      // only the closed-portion share to this round trip; the remainder rides
      // with the newly-opened opposite lot.
      const closeFeeShare = feePerUnit != null ? feePerUnit * openQty : null;
      const { fees, feesAvailable } = combineFees(anyEntryFee, entryFeesConsumed, closeFeeShare);

      trades.push({
        id: `${key}-${fill.id}-rev`,
        symbol: open.symbol,
        side: open.side,
        qty: openQty,
        entryPrice: entryPriceAvg,
        exitPrice: price,
        openedAt: earliestOpen ?? fill.occurredAt,
        closedAt: fill.occurredAt,
        holdMs: fill.occurredAt.getTime() - (earliestOpen?.getTime() ?? fill.occurredAt.getTime()),
        pnl: grossPnl,
        pnlSource: brokerPnl != null ? "broker" : "computed",
        pnlType: brokerPnl != null ? "broker_gross" : "computed",
        fees,
        feesAvailable,
        netPnl: grossPnl - (fees ?? 0),
        symbolResolved: isValidFuturesSymbol(open.symbol),
      });

      // Opened a new opposite-side position with the remaining quantity. The
      // per-unit fee carries over so a later close attributes the right share.
      closeRemaining = qty - openQty;
      positions.set(key, {
        side: side === "BUY" ? "LONG" : "SHORT",
        lots: [{ qty: closeRemaining, price, openedAt: fill.occurredAt, feePerUnit }],
        symbol,
      });
      continue;
    }
  }

  return trades;
}
