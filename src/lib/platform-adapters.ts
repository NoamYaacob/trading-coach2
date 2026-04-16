import type {
  PlatformAdapter,
  PlatformAdapterContext,
  PlatformAccountSnapshot,
  PlatformAdapterKey,
  PlatformSessionMetrics,
  PlatformSyncSnapshot,
  PlatformTradeEvent,
} from "@/lib/platform-adapter";
import { getPlatformIntegrationPlan } from "@/lib/platform-integration-plans";

function deriveTradeEventTitle(
  event: PlatformAdapterContext["recentSessionEvents"][number],
) {
  if (event.detectedIntent === "emotional_distress") {
    return "Latest trade-pressure event";
  }

  if (event.detectedIntent === "day_summary") {
    return "Latest review event";
  }

  return "Latest coach event";
}

function normalizeRecentTradeEvents(
  recentSessionEvents: PlatformAdapterContext["recentSessionEvents"],
): PlatformTradeEvent[] {
  return [...recentSessionEvents]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .filter((event) => event.detectedIntent || event.message)
    .map((event) => ({
      title: deriveTradeEventTitle(event),
      detail: event.message,
      recordedAt: event.createdAt,
      traderState: event.traderState,
    }));
}

class MockPlatformAdapter implements PlatformAdapter {
  readonly key = "mock" as const;

  readonly id = "mock-platform";

  readonly source = "MOCK" as const;

  readonly platformName = "Mock Platform";

  readonly display = {
    label: "Mock internal feed",
    shortDescription: "Internal mock adapter for local Guardian and session metrics.",
    connectionMode: "INTERNAL_MOCK" as const,
  };

  readonly integrationPlan = null;

  getConnectionSnapshot(context: PlatformAdapterContext): PlatformAccountSnapshot {
    const mockConnected = context.guardianConnectionStatus === "MOCK_CONNECTED";

    return {
      source: this.source,
      platformName: context.guardianPlatformName?.trim() || this.platformName,
      externalAccountId: mockConnected ? "mock-primary" : null,
      connectionState: mockConnected ? "CONNECTED" : "NOT_CONNECTED",
      connectionLabel: mockConnected ? "Mock connected" : "Not connected",
      syncReadiness: mockConnected ? "MOCK_READY" : "NOT_READY",
      adapterDisplay: this.display,
    };
  }

  getSessionMetrics(context: PlatformAdapterContext): PlatformSessionMetrics {
    return {
      todayTradesCount: context.todayTradesCount,
      todayPnL: context.todayPnL,
      consecutiveLosses: context.consecutiveLosses,
      syncedAt: context.syncedAt,
    };
  }

  getRecentTradeEvents(context: PlatformAdapterContext): PlatformTradeEvent[] {
    return normalizeRecentTradeEvents(context.recentSessionEvents);
  }

  buildSyncSnapshot(context: PlatformAdapterContext): PlatformSyncSnapshot {
    const recentTradeEvents = this.getRecentTradeEvents(context);

    return {
      account: this.getConnectionSnapshot(context),
      sessionMetrics: this.getSessionMetrics(context),
      recentTradeEvents,
      latestTradeActivity: recentTradeEvents[0] ?? null,
      integrationPlan: this.integrationPlan,
    };
  }
}

class TradovateAdapterStub implements PlatformAdapter {
  readonly key = "tradovate_stub" as const;

  readonly id = "tradovate-adapter-stub";

  readonly source = "TRADOVATE_STUB" as const;

  readonly platformName = "Tradovate";

  readonly display = {
    label: "Tradovate adapter stub",
    shortDescription: "External adapter selected. Live broker sync is not connected yet.",
    connectionMode: "EXTERNAL_STUB" as const,
  };

  readonly integrationPlan = getPlatformIntegrationPlan(this.key);

  getConnectionSnapshot(context: PlatformAdapterContext): PlatformAccountSnapshot {
    const connected = context.guardianConnectionStatus === "MOCK_CONNECTED";

    return {
      source: this.source,
      platformName: context.guardianPlatformName?.trim() || this.platformName,
      externalAccountId: connected ? "tradovate-demo-001" : null,
      connectionState: connected ? "CONNECTED" : "NOT_CONNECTED",
      connectionLabel: connected ? "Stub connected" : "Stub not connected",
      syncReadiness: connected ? "MOCK_READY" : "NOT_READY",
      adapterDisplay: this.display,
    };
  }

  getSessionMetrics(context: PlatformAdapterContext): PlatformSessionMetrics {
    return {
      todayTradesCount: context.todayTradesCount,
      todayPnL: context.todayPnL,
      consecutiveLosses: context.consecutiveLosses,
      syncedAt: context.syncedAt,
    };
  }

  getRecentTradeEvents(context: PlatformAdapterContext): PlatformTradeEvent[] {
    const normalizedEvents = normalizeRecentTradeEvents(context.recentSessionEvents);

    if (normalizedEvents.length > 0) {
      return normalizedEvents;
    }

    return [
      {
        title: "Stub trade sync ready",
        detail: "Tradovate stub can surface normalized trade activity here later.",
        recordedAt: context.syncedAt,
        traderState: null,
      },
    ];
  }

  buildSyncSnapshot(context: PlatformAdapterContext): PlatformSyncSnapshot {
    const recentTradeEvents = this.getRecentTradeEvents(context);

    return {
      account: this.getConnectionSnapshot(context),
      sessionMetrics: this.getSessionMetrics(context),
      recentTradeEvents,
      latestTradeActivity: recentTradeEvents[0] ?? null,
      integrationPlan: this.integrationPlan,
    };
  }
}

const platformAdapterRegistry: Record<PlatformAdapterKey, PlatformAdapter> = {
  mock: new MockPlatformAdapter(),
  tradovate_stub: new TradovateAdapterStub(),
};

export function normalizePlatformAdapterKey(
  value: string | null | undefined,
): PlatformAdapterKey | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "mock" || normalized === "tradovate_stub") {
    return normalized;
  }

  return null;
}

export function getPlatformAdapterRegistry() {
  return platformAdapterRegistry;
}

export function resolvePlatformAdapter(input?: {
  adapterKey?: PlatformAdapterKey | string | null;
  platformName?: string | null;
}): PlatformAdapter {
  const normalizedKey = normalizePlatformAdapterKey(input?.adapterKey);

  if (normalizedKey) {
    return platformAdapterRegistry[normalizedKey];
  }

  const normalizedPlatformName = input?.platformName?.trim().toLowerCase();

  if (normalizedPlatformName?.includes("tradovate")) {
    return platformAdapterRegistry.tradovate_stub;
  }

  return platformAdapterRegistry.mock;
}
