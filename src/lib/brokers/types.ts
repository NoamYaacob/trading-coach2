/**
 * Broker integration types.
 *
 * The product direction is broker-connected risk enforcement. This module
 * defines the contract every broker adapter must satisfy. Read methods may
 * be implemented gradually; destructive enforcement methods (cancel orders,
 * flatten positions, broker-level lockout) MUST throw NotImplementedError
 * until verified end-to-end against the live broker API.
 *
 * The "manual" provider is a legacy database value. Active accounts use
 * the tradovate adapter; other providers use the PlaceholderAdapter.
 */

// ─── Identity ─────────────────────────────────────────────────────────────

export type BrokerProvider =
  | "tradovate"
  | "rithmic"
  | "ninjatrader"
  | "manual"
  | "demo"
  | "other";

// ─── Capabilities ─────────────────────────────────────────────────────────

export type BrokerCapabilityKey =
  | "readAccount"
  | "readBalance"
  | "readPositions"
  | "readOrders"
  | "readPnL"
  | "readExecutions"
  | "cancelOrders"
  | "flattenPositions"
  | "brokerLevelLockout"
  | "placeOrderBlock";

/**
 * Capability state values.
 *
 * - `available`       — adapter implements the method against a live source.
 * - `requires_oauth`  — the data source exists but the user has not yet
 *                       completed the broker OAuth flow.
 * - `coming_soon`     — Guardrail will support this once the integration is
 *                       built end-to-end. Used for actions we plan to ship.
 * - `unknown`         — broker API support has not been verified yet.
 *                       Distinct from `coming_soon` because we are not
 *                       certain it is even possible.
 * - `not_supported`   — the broker / mode cannot do this action by design.
 */
export type BrokerCapabilityStatus =
  | "available"
  | "requires_oauth"
  | "coming_soon"
  | "unknown"
  | "not_supported";

export type BrokerCapability = {
  key: BrokerCapabilityKey;
  label: string;
  status: BrokerCapabilityStatus;
  /** Optional human-readable note for UI surfaces. */
  note?: string;
};

export type BrokerCapabilityMap = Record<BrokerCapabilityKey, BrokerCapability>;

// ─── Connection state ─────────────────────────────────────────────────────

export type BrokerConnectionStatus =
  | "disconnected"
  | "connected"
  | "degraded"
  | "expired"
  | "error";

// ─── Data shapes ──────────────────────────────────────────────────────────

export type BrokerAccountSnapshot = {
  accountId: string;
  label: string;
  currency: string;
  balance: number | null;
  equity: number | null;
  todayPnL: number | null;
  /** Unrealised P&L from the cash-balance snapshot endpoint, when available. */
  openPnlFromSnapshot: number | null;
  asOf: Date;
};

export type BrokerSide = "LONG" | "SHORT";

export type BrokerPosition = {
  positionId: string;
  symbol: string;
  side: BrokerSide;
  quantity: number;
  averagePrice: number | null;
  unrealizedPnL: number | null;
  asOf: Date;
};

export type BrokerOrderStatus =
  | "WORKING"
  | "FILLED"
  | "PARTIAL"
  | "CANCELLED"
  | "REJECTED";

export type BrokerOrderType = "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT" | "OTHER";

export type BrokerOrder = {
  orderId: string;
  symbol: string;
  side: BrokerSide;
  quantity: number;
  status: BrokerOrderStatus;
  type: BrokerOrderType;
  limitPrice: number | null;
  stopPrice: number | null;
  placedAt: Date;
};

export type BrokerExecution = {
  executionId: string;
  orderId: string | null;
  symbol: string;
  side: BrokerSide;
  quantity: number;
  price: number;
  /** Realised P&L on this fill, when available from the broker. */
  pnl: number | null;
  occurredAt: Date;
};

// ─── Errors ───────────────────────────────────────────────────────────────

/**
 * Thrown by adapter methods that are not yet implemented or whose
 * preconditions are not met (e.g. broker not connected). Callers should
 * surface this to the user as "Coming soon" / "Not available" — never
 * silently swallow it and pretend the action succeeded.
 */
export class NotImplementedError extends Error {
  readonly code = "NOT_IMPLEMENTED";
  readonly capability: BrokerCapabilityKey | null;
  constructor(method: string, capability: BrokerCapabilityKey | null = null) {
    super(`${method} is not yet implemented for this broker.`);
    this.name = "NotImplementedError";
    this.capability = capability;
  }
}

// ─── Adapter contract ─────────────────────────────────────────────────────

export interface BrokerAdapter {
  readonly provider: BrokerProvider;
  readonly displayName: string;

  /** Static (or near-static) capability map — used to render UI matrices. */
  getCapabilities(): BrokerCapabilityMap;

  /** Lightweight connection probe. Should not throw on disconnect. */
  getConnectionStatus(): Promise<BrokerConnectionStatus>;

  // ── Read methods ────────────────────────────────────────────────────────
  // Throw NotImplementedError when the adapter has not implemented the
  // capability OR when the user has not completed required OAuth.

  getAccountSnapshot(): Promise<BrokerAccountSnapshot>;
  getOpenPositions(): Promise<BrokerPosition[]>;
  getOpenOrders(): Promise<BrokerOrder[]>;
  getTodayExecutions(): Promise<BrokerExecution[]>;

  // ── Destructive / enforcement methods ──────────────────────────────────
  // MUST throw NotImplementedError until verified against the live broker.

  cancelAllOrders(): Promise<void>;
  flattenAllPositions(): Promise<void>;
  activateLockout(): Promise<void>;
  deactivateLockout(): Promise<void>;
}
