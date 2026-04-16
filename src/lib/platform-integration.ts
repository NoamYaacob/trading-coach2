import type { GuardianSnapshot } from "@/lib/guardian";
import type {
  PlatformAdapterContext,
  PlatformAdapterKey,
  PlatformConnectionProgression,
  PlatformSyncSnapshot,
} from "@/lib/platform-adapter";
import { resolvePlatformAdapter } from "@/lib/platform-adapters";

export type BrokerIntegrationSnapshot = PlatformSyncSnapshot;

type RecentSessionEventInput = PlatformAdapterContext["recentSessionEvents"][number];

function buildPlatformAdapterContext(input: {
  guardian: GuardianSnapshot;
  recentSessionEvents?: RecentSessionEventInput[];
}): PlatformAdapterContext {
  return {
    guardianPlatformName: input.guardian.profile.platformName,
    guardianConnectionStatus: input.guardian.profile.connectionStatus,
    todayTradesCount: input.guardian.evaluation.todayTradesCount,
    todayPnL: input.guardian.evaluation.todayPnL,
    consecutiveLosses: input.guardian.evaluation.consecutiveLosses,
    syncedAt: input.guardian.status.updatedAt,
    recentSessionEvents: input.recentSessionEvents ?? [],
  };
}

export function getPlatformAdapter(input?: {
  adapterKey?: PlatformAdapterKey | string | null;
  platformName?: string | null;
}) {
  return resolvePlatformAdapter(input);
}

export function buildBrokerIntegrationSnapshot(input: {
  guardian: GuardianSnapshot;
  recentSessionEvents?: RecentSessionEventInput[];
  adapterKey?: PlatformAdapterKey | string | null;
}): BrokerIntegrationSnapshot {
  const adapter = getPlatformAdapter({
    adapterKey: input.adapterKey ?? input.guardian.profile.adapterKey,
    platformName: input.guardian.profile.platformName,
  });
  const context = buildPlatformAdapterContext(input);

  return adapter.buildSyncSnapshot(context);
}

export function derivePlatformConnectionProgression(input: {
  guardian: GuardianSnapshot;
  brokerIntegration: BrokerIntegrationSnapshot;
}): PlatformConnectionProgression {
  const { guardian, brokerIntegration } = input;
  const hasAdapterKey = Boolean(guardian.profile.adapterKey?.trim());
  const isMock = brokerIntegration.account.adapterDisplay.connectionMode === "INTERNAL_MOCK";
  const isConnected = brokerIntegration.account.connectionState === "CONNECTED";

  if (!hasAdapterKey) {
    return {
      kind: "NOT_CONFIGURED",
      label: "No integration configured",
      description: "No platform adapter is selected yet.",
      liveSyncAvailable: false,
      connectionMode: brokerIntegration.account.adapterDisplay.connectionMode,
      nextStep: "Select an adapter before preparing platform sync.",
    };
  }

  if (isMock && isConnected) {
    return {
      kind: "MOCK_ACTIVE",
      label: "Mock feed active",
      description: "Internal mock data is driving the current integration layer.",
      liveSyncAvailable: false,
      connectionMode: brokerIntegration.account.adapterDisplay.connectionMode,
      nextStep: "Use this mode for Guardian testing until a live adapter is added.",
    };
  }

  if (isMock) {
    return {
      kind: "ADAPTER_SELECTED",
      label: "Mock adapter selected",
      description: "Internal mock feed is selected, but no sync source is active right now.",
      liveSyncAvailable: false,
      connectionMode: brokerIntegration.account.adapterDisplay.connectionMode,
      nextStep: "Keep mock selected for internal testing, or switch to an external stub.",
    };
  }

  if (isConnected) {
    return {
      kind: "READY_FOR_LIVE_CONNECTION",
      label: "External adapter prepared",
      description: "An external adapter is selected and the product is ready for future live connection work.",
      liveSyncAvailable: false,
      connectionMode: brokerIntegration.account.adapterDisplay.connectionMode,
      nextStep: "Live sync is not implemented yet. Keep using Guardian with simulated data.",
    };
  }

  if (brokerIntegration.account.adapterDisplay.connectionMode === "EXTERNAL_STUB") {
    return {
      kind: "STUB_SELECTED",
      label: "External adapter selected",
      description: "A broker adapter stub is selected, but there is no live broker sync yet.",
      liveSyncAvailable: false,
      connectionMode: brokerIntegration.account.adapterDisplay.connectionMode,
      nextStep: "This adapter is ready for future live connection support.",
    };
  }

  return {
    kind: "SYNC_UNAVAILABLE",
    label: "Sync unavailable",
    description: "The integration layer is configured, but live sync is not available yet.",
    liveSyncAvailable: false,
    connectionMode: brokerIntegration.account.adapterDisplay.connectionMode,
    nextStep: "Use current mock or stub data until live sync is implemented.",
  };
}
