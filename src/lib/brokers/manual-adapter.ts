/**
 * Manual Mode adapter.
 *
 * Manual Mode is treated as a broker for capability-matrix purposes. Its
 * profile is honest:
 *   - read methods return what the journal can supply (executions only)
 *   - destructive methods are explicitly NOT supported (manual mode cannot
 *     reach the broker to cancel orders or flatten positions)
 *
 * The actual reading of journal data happens at the page level using
 * `prisma.manualTradeEntry.findMany()` + `computeManualRiskState`. This
 * adapter is currently a thin descriptor. We can fold the journal reader
 * into here later if it simplifies the page code.
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

export class ManualAdapter implements BrokerAdapter {
  readonly provider: BrokerProvider = "manual";
  readonly displayName = "Manual Mode";

  getCapabilities(): BrokerCapabilityMap {
    return {
      readAccount: {
        key: "readAccount",
        label: "Read account & balance",
        status: "not_supported",
        note: "Manual Mode has no broker connection.",
      },
      readBalance: {
        key: "readBalance",
        label: "Read balance",
        status: "not_supported",
      },
      readPositions: {
        key: "readPositions",
        label: "Read open positions",
        status: "not_supported",
        note: "Open positions are not tracked manually.",
      },
      readOrders: {
        key: "readOrders",
        label: "Read open orders",
        status: "not_supported",
      },
      readPnL: {
        key: "readPnL",
        label: "Read P&L",
        status: "available",
        note: "Calculated from Journal entries.",
      },
      readExecutions: {
        key: "readExecutions",
        label: "Read trades",
        status: "available",
        note: "From Journal entries.",
      },
      cancelOrders: {
        key: "cancelOrders",
        label: "Cancel open orders",
        status: "not_supported",
        note: "Requires broker connection.",
      },
      flattenPositions: {
        key: "flattenPositions",
        label: "Flatten all positions (kill switch)",
        status: "not_supported",
        note: "Requires broker connection.",
      },
      brokerLevelLockout: {
        key: "brokerLevelLockout",
        label: "Broker-level lockout",
        status: "not_supported",
        note: "App-level lock only — Guardrail cannot block orders at the broker.",
      },
      placeOrderBlock: {
        key: "placeOrderBlock",
        label: "Block new orders pre-trade",
        status: "not_supported",
      },
    };
  }

  async getConnectionStatus(): Promise<BrokerConnectionStatus> {
    // Manual mode is always "available" — there is no remote connection
    // to fail. Surfaces should still flag it as Manual, not Live, so users
    // know enforcement is app-level only.
    return "connected";
  }

  async getAccountSnapshot(): Promise<BrokerAccountSnapshot> {
    throw new NotImplementedError("ManualAdapter.getAccountSnapshot", "readAccount");
  }

  async getOpenPositions(): Promise<BrokerPosition[]> {
    throw new NotImplementedError("ManualAdapter.getOpenPositions", "readPositions");
  }

  async getOpenOrders(): Promise<BrokerOrder[]> {
    throw new NotImplementedError("ManualAdapter.getOpenOrders", "readOrders");
  }

  /**
   * Manual Mode "executions" come from the journal. The manual page reads
   * them directly from Prisma; this method is intentionally not the
   * canonical entry point. It returns an empty array so capability
   * surfaces that probe the adapter don't crash.
   */
  async getTodayExecutions(): Promise<BrokerExecution[]> {
    return [];
  }

  async cancelAllOrders(): Promise<void> {
    throw new NotImplementedError("ManualAdapter.cancelAllOrders", "cancelOrders");
  }

  async flattenAllPositions(): Promise<void> {
    throw new NotImplementedError("ManualAdapter.flattenAllPositions", "flattenPositions");
  }

  async activateLockout(): Promise<void> {
    throw new NotImplementedError("ManualAdapter.activateLockout", "brokerLevelLockout");
  }

  async deactivateLockout(): Promise<void> {
    throw new NotImplementedError("ManualAdapter.deactivateLockout", "brokerLevelLockout");
  }
}
