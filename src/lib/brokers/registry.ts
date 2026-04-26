/**
 * Broker adapter registry.
 *
 * Centralised lookup of adapters by provider. UI surfaces (Accounts page,
 * Guardian, Dashboard) ask the registry for capability matrices instead
 * of hard-coding broker-specific copy. This keeps the truth in one place
 * and lets us flip statuses ("coming_soon" -> "available") in a single
 * file as integrations land.
 *
 * Providers without a real adapter yet (rithmic, ninjatrader, other) get
 * a generic placeholder profile — every capability is "coming_soon" and
 * every method throws NotImplementedError.
 */

import type { BrokerAdapter, BrokerCapabilityMap, BrokerProvider } from "./types";
import { NotImplementedError } from "./types";
import { ManualAdapter } from "./manual-adapter";
import { TradovateAdapter } from "./tradovate-adapter";

class PlaceholderAdapter implements BrokerAdapter {
  readonly provider: BrokerProvider;
  readonly displayName: string;

  constructor(provider: BrokerProvider, displayName: string) {
    this.provider = provider;
    this.displayName = displayName;
  }

  getCapabilities(): BrokerCapabilityMap {
    const note = `${this.displayName} integration is on the roadmap.`;
    const make = (
      key: keyof BrokerCapabilityMap,
      label: string,
    ): BrokerCapabilityMap[keyof BrokerCapabilityMap] => ({
      key,
      label,
      status: "coming_soon",
      note,
    });
    return {
      readAccount: make("readAccount", "Read account & balance"),
      readBalance: make("readBalance", "Read balance"),
      readPositions: make("readPositions", "Read open positions"),
      readOrders: make("readOrders", "Read open orders"),
      readPnL: make("readPnL", "Read live P&L"),
      readExecutions: make("readExecutions", "Read fills / executions"),
      cancelOrders: make("cancelOrders", "Cancel open orders"),
      flattenPositions: make("flattenPositions", "Flatten all positions (kill switch)"),
      brokerLevelLockout: make("brokerLevelLockout", "Broker-level lockout"),
      placeOrderBlock: make("placeOrderBlock", "Block new orders pre-trade"),
    };
  }

  async getConnectionStatus() {
    return "disconnected" as const;
  }

  async getAccountSnapshot(): Promise<never> {
    throw new NotImplementedError(`${this.displayName}.getAccountSnapshot`);
  }

  async getOpenPositions(): Promise<never> {
    throw new NotImplementedError(`${this.displayName}.getOpenPositions`);
  }

  async getOpenOrders(): Promise<never> {
    throw new NotImplementedError(`${this.displayName}.getOpenOrders`);
  }

  async getTodayExecutions(): Promise<never> {
    throw new NotImplementedError(`${this.displayName}.getTodayExecutions`);
  }

  async cancelAllOrders(): Promise<void> {
    throw new NotImplementedError(`${this.displayName}.cancelAllOrders`);
  }

  async flattenAllPositions(): Promise<void> {
    throw new NotImplementedError(`${this.displayName}.flattenAllPositions`);
  }

  async activateLockout(): Promise<void> {
    throw new NotImplementedError(`${this.displayName}.activateLockout`);
  }

  async deactivateLockout(): Promise<void> {
    throw new NotImplementedError(`${this.displayName}.deactivateLockout`);
  }
}

const PROVIDER_DISPLAY_NAMES: Record<BrokerProvider, string> = {
  tradovate: "Tradovate",
  rithmic: "Rithmic",
  ninjatrader: "NinjaTrader",
  manual: "Manual Mode",
  demo: "Demo",
  other: "Other",
};

export function getBrokerDisplayName(provider: BrokerProvider): string {
  return PROVIDER_DISPLAY_NAMES[provider];
}

/** Returns a fresh adapter instance for the given provider. */
export function getBrokerAdapter(provider: BrokerProvider): BrokerAdapter {
  switch (provider) {
    case "manual":
      return new ManualAdapter();
    case "tradovate":
      return new TradovateAdapter();
    case "rithmic":
    case "ninjatrader":
    case "demo":
    case "other":
    default:
      return new PlaceholderAdapter(provider, PROVIDER_DISPLAY_NAMES[provider]);
  }
}

/**
 * The set of providers we want the Accounts capability matrix to render,
 * in the order they should appear (most relevant first).
 */
export const VISIBLE_PROVIDERS: BrokerProvider[] = [
  "tradovate",
  "rithmic",
  "ninjatrader",
  "manual",
];

export function getVisibleAdapters(): BrokerAdapter[] {
  return VISIBLE_PROVIDERS.map(getBrokerAdapter);
}
