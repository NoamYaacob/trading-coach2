import type {
  PlatformAdapterKey,
  PlatformIntegrationCapability,
  PlatformIntegrationPlan,
} from "@/lib/platform-adapter";

const capabilityLabels: Record<PlatformIntegrationCapability, string> = {
  ACCOUNT_SNAPSHOT: "account sync",
  SESSION_METRICS: "session metrics",
  TRADE_EVENTS: "trade events",
  POSITION_PNL_SYNC: "position / P&L sync",
};

export const tradovateIntegrationPlan: PlatformIntegrationPlan = {
  adapterKey: "tradovate_stub",
  label: "Tradovate integration plan",
  plannedCapabilities: [
    "ACCOUNT_SNAPSHOT",
    "SESSION_METRICS",
    "TRADE_EVENTS",
    "POSITION_PNL_SYNC",
  ],
  notImplementedYet: [
    "live order blocking",
    "live execution control",
    "streaming sync",
    "webhook auth handling",
  ],
  requiredAccountInputs: [
    "external account identifier",
    "account display name",
    "connection health",
  ],
  requiredAuthInputs: [
    "session token or equivalent platform auth context",
    "environment / account scope",
  ],
  requiredTradeEventFields: [
    "trade id",
    "symbol",
    "side",
    "quantity",
    "fill price",
    "realized P&L",
    "opened at",
    "closed at",
  ],
  requiredSessionMetricsFields: [
    "today trades count",
    "today realized P&L",
    "consecutive losses",
    "open positions summary",
  ],
  requiredSyncCheckpoints: [
    "account snapshot checkpoint",
    "trade event ingestion checkpoint",
    "session metrics sync checkpoint",
  ],
};

const integrationPlans: Partial<Record<PlatformAdapterKey, PlatformIntegrationPlan>> = {
  tradovate_stub: tradovateIntegrationPlan,
};

export function getPlatformIntegrationPlan(
  adapterKey: PlatformAdapterKey,
): PlatformIntegrationPlan | null {
  return integrationPlans[adapterKey] ?? null;
}

export function humanizePlannedCapabilities(
  capabilities: PlatformIntegrationCapability[],
) {
  return capabilities.map((capability) => capabilityLabels[capability]);
}
