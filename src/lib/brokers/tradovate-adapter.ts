/**
 * Tradovate adapter — placeholder implementation.
 *
 * Real implementation requires:
 *   - OAuth credentials (client id / secret)
 *   - REST endpoints for account / positions / orders / fills
 *   - WebSocket subscription for live executions
 *   - Verified API support for cancel-orders / flatten / lockout actions
 *
 * Until those are in place, every method throws NotImplementedError. The
 * capability map advertises the planned status for each capability so the
 * Accounts page renders accurate "Coming soon" / "Requires OAuth" badges
 * without faking data.
 *
 * See docs/broker-integration-plan.md for the verification checklist.
 */

import type {
  BrokerAccountSnapshot,
  BrokerAdapter,
  BrokerCapabilityMap,
  BrokerConnectionStatus,
  BrokerExecution,
  BrokerOrder,
  BrokerPosition,
  BrokerProvider,
} from "./types";
import { NotImplementedError } from "./types";

export class TradovateAdapter implements BrokerAdapter {
  readonly provider: BrokerProvider = "tradovate";
  readonly displayName = "Tradovate";

  getCapabilities(): BrokerCapabilityMap {
    return {
      readAccount: {
        key: "readAccount",
        label: "Read account & balance",
        status: "requires_oauth",
        note: "Available after OAuth — not implemented yet.",
      },
      readBalance: {
        key: "readBalance",
        label: "Read balance",
        status: "requires_oauth",
      },
      readPositions: {
        key: "readPositions",
        label: "Read open positions",
        status: "requires_oauth",
      },
      readOrders: {
        key: "readOrders",
        label: "Read open orders",
        status: "requires_oauth",
      },
      readPnL: {
        key: "readPnL",
        label: "Read live P&L",
        status: "requires_oauth",
      },
      readExecutions: {
        key: "readExecutions",
        label: "Read fills / executions",
        status: "requires_oauth",
      },
      cancelOrders: {
        key: "cancelOrders",
        label: "Cancel open orders",
        status: "coming_soon",
        note: "Planned. Not enabled until end-to-end verification.",
      },
      flattenPositions: {
        key: "flattenPositions",
        label: "Flatten all positions (kill switch)",
        status: "coming_soon",
        note: "Planned. Not enabled until end-to-end verification.",
      },
      brokerLevelLockout: {
        key: "brokerLevelLockout",
        label: "Broker-level lockout",
        status: "unknown",
        note: "Tradovate API support to be verified.",
      },
      placeOrderBlock: {
        key: "placeOrderBlock",
        label: "Block new orders pre-trade",
        status: "unknown",
        note: "Tradovate API support to be verified.",
      },
      maxPositionSize: {
        key: "maxPositionSize",
        label: "Max position size",
        status: "not_supported",
        note: "Tradovate's position limit API (userAccountPositionLimit) only supports totalBy='Overall' — a global raw contract count. Product-specific limits (PerContract/PerProduct) were tested against the live API and return HTTP 400. Standard-equivalent max position size is enforced by Guardrail (detection-response) only, not as a broker-level pre-trade block.",
      },
    };
  }

  async getConnectionStatus(): Promise<BrokerConnectionStatus> {
    // Until OAuth is wired, we are always disconnected. We deliberately do
    // NOT return "connected" based on a stub — that would mislead the UI.
    return "disconnected";
  }

  async getAccountSnapshot(): Promise<BrokerAccountSnapshot> {
    throw new NotImplementedError("TradovateAdapter.getAccountSnapshot", "readAccount");
  }

  async getOpenPositions(): Promise<BrokerPosition[]> {
    throw new NotImplementedError("TradovateAdapter.getOpenPositions", "readPositions");
  }

  async getOpenOrders(): Promise<BrokerOrder[]> {
    throw new NotImplementedError("TradovateAdapter.getOpenOrders", "readOrders");
  }

  async getTodayExecutions(): Promise<BrokerExecution[]> {
    throw new NotImplementedError("TradovateAdapter.getTodayExecutions", "readExecutions");
  }

  async cancelAllOrders(): Promise<void> {
    throw new NotImplementedError("TradovateAdapter.cancelAllOrders", "cancelOrders");
  }

  async flattenAllPositions(): Promise<void> {
    throw new NotImplementedError("TradovateAdapter.flattenAllPositions", "flattenPositions");
  }

  async activateLockout(): Promise<void> {
    throw new NotImplementedError("TradovateAdapter.activateLockout", "brokerLevelLockout");
  }

  async deactivateLockout(): Promise<void> {
    throw new NotImplementedError("TradovateAdapter.deactivateLockout", "brokerLevelLockout");
  }
}
