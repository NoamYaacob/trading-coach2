import { type TraderCurrentState } from "@prisma/client";

export type PlatformSource = "MOCK" | "TRADOVATE_STUB";

export type PlatformAdapterKey = "mock" | "tradovate_stub";

export type PlatformConnectionState = "CONNECTED" | "NOT_CONNECTED";

export type PlatformSyncReadiness = "MOCK_READY" | "NOT_READY";

export type PlatformConnectionMode = "INTERNAL_MOCK" | "EXTERNAL_STUB";

export type PlatformTradeEvent = {
  title: string;
  detail: string;
  recordedAt: Date | null;
  traderState: TraderCurrentState | null;
};

export type PlatformAdapterDisplay = {
  label: string;
  shortDescription: string;
  connectionMode: PlatformConnectionMode;
};

export type PlatformAccountSnapshot = {
  source: PlatformSource;
  platformName: string;
  externalAccountId: string | null;
  connectionState: PlatformConnectionState;
  connectionLabel: string;
  syncReadiness: PlatformSyncReadiness;
  adapterDisplay: PlatformAdapterDisplay;
};

export type PlatformSessionMetrics = {
  todayTradesCount: number;
  todayPnL: number;
  consecutiveLosses: number;
  syncedAt: Date | null;
};

export type PlatformSyncSnapshot = {
  account: PlatformAccountSnapshot;
  sessionMetrics: PlatformSessionMetrics;
  recentTradeEvents: PlatformTradeEvent[];
  latestTradeActivity: PlatformTradeEvent | null;
  integrationPlan: PlatformIntegrationPlan | null;
};

export type PlatformConnectionProgressionKind =
  | "NOT_CONFIGURED"
  | "ADAPTER_SELECTED"
  | "MOCK_ACTIVE"
  | "STUB_SELECTED"
  | "READY_FOR_LIVE_CONNECTION"
  | "SYNC_UNAVAILABLE";

export type PlatformConnectionProgression = {
  kind: PlatformConnectionProgressionKind;
  label: string;
  description: string;
  liveSyncAvailable: boolean;
  connectionMode: PlatformConnectionMode;
  nextStep: string;
};

export type PlatformIntegrationCapability =
  | "ACCOUNT_SNAPSHOT"
  | "SESSION_METRICS"
  | "TRADE_EVENTS"
  | "POSITION_PNL_SYNC";

export type PlatformIntegrationPlan = {
  adapterKey: PlatformAdapterKey;
  label: string;
  plannedCapabilities: PlatformIntegrationCapability[];
  notImplementedYet: string[];
  requiredAccountInputs: string[];
  requiredAuthInputs: string[];
  requiredTradeEventFields: string[];
  requiredSessionMetricsFields: string[];
  requiredSyncCheckpoints: string[];
};

export type PlatformAdapterContext = {
  guardianPlatformName: string | null | undefined;
  guardianConnectionStatus: string;
  todayTradesCount: number;
  todayPnL: number;
  consecutiveLosses: number;
  syncedAt: Date | null;
  recentSessionEvents: Array<{
    message: string;
    detectedIntent: string | null;
    traderState: TraderCurrentState;
    createdAt: Date;
  }>;
};

export interface PlatformAdapter {
  readonly key: PlatformAdapterKey;
  readonly id: string;
  readonly source: PlatformSource;
  readonly platformName: string;
  readonly display: PlatformAdapterDisplay;
  readonly integrationPlan: PlatformIntegrationPlan | null;
  getConnectionSnapshot(context: PlatformAdapterContext): PlatformAccountSnapshot;
  getSessionMetrics(context: PlatformAdapterContext): PlatformSessionMetrics;
  getRecentTradeEvents(context: PlatformAdapterContext): PlatformTradeEvent[];
  buildSyncSnapshot(context: PlatformAdapterContext): PlatformSyncSnapshot;
}
