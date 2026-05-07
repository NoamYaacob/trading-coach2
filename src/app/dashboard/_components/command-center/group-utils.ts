import type {
  AccountStatus,
  CommandCenterAccount,
  CommandCenterFirmGroup,
  StatusBreakdown,
} from "./types";

export function emptyCounts(): Record<AccountStatus, number> {
  return {
    allowed: 0,
    warning: 0,
    locked: 0,
    setup_needed: 0,
    not_connected: 0,
    unavailable: 0,
  };
}

export function emptyBreakdown(): Record<AccountStatus, StatusBreakdown> {
  return {
    allowed: { total: 0, live: 0, practice: 0 },
    warning: { total: 0, live: 0, practice: 0 },
    locked: { total: 0, live: 0, practice: 0 },
    setup_needed: { total: 0, live: 0, practice: 0 },
    not_connected: { total: 0, live: 0, practice: 0 },
    unavailable: { total: 0, live: 0, practice: 0 },
  };
}

const ENV_SUFFIX: Record<string, string> = {
  live: "Live",
  demo: "Demo",
};

/**
 * Builds firm group sections from a flat account list.
 *
 * The map key is `firmKey::brokerConnectionId` so accounts from the same
 * prop firm on *different* broker connections (different OAuth credentials)
 * are never merged into the same group.
 *
 * sinkKeys — firm keys that sort to the bottom (personal, unassigned).
 *
 * Tradovate authorises live and demo as separate OAuth grants and exposes
 * no stable cross-environment user identifier (the OAuth `accountId` is
 * per-trading-account, and `/account/list`'s `userId` is scoped to a single
 * Tradovate environment). For sink groups (personal / unassigned) we append
 * the connection env to the firmLabel so duplicate cards are visibly
 * distinguishable instead of risking a silent merge of accounts that may
 * belong to different humans.
 */
export function buildCommandCenterGroups(
  accounts: CommandCenterAccount[],
  sinkKeys: ReadonlySet<string>,
): CommandCenterFirmGroup[] {
  const groupMap = new Map<string, CommandCenterFirmGroup>();

  for (const account of accounts) {
    const mapKey = `${account.firmKey}::${account.brokerConnectionId ?? ""}`;
    let group = groupMap.get(mapKey);
    if (!group) {
      const envSuffix =
        sinkKeys.has(account.firmKey) && account.brokerEnv
          ? ENV_SUFFIX[account.brokerEnv]
          : null;
      group = {
        groupId: mapKey,
        firmKey: account.firmKey,
        firmLabel: envSuffix ? `${account.firmLabel} · ${envSuffix}` : account.firmLabel,
        accounts: [],
        counts: emptyCounts(),
        totalDailyPnl: 0,
        totalRiskRemaining: 0,
        hasPnlData: false,
        hasRiskData: false,
        platform: account.platform,
        platformLabel: account.platformLabel,
        connectionStatus: account.connectionStatus,
        connectionStatusLabel: account.connectionStatusLabel,
        brokerConnectionId: account.brokerConnectionId,
        brokerEnv: account.brokerEnv,
        lastSyncAt: account.lastSyncAt,
        enforcementMode: account.enforcementMode,
      };
      groupMap.set(mapKey, group);
    }
    group.accounts.push(account);
    group.counts[account.status] += 1;
    // Unavailable accounts (broker no longer returns them) are kept in the
    // group for the user to see, but their stale balance/P&L/loss budget is
    // excluded from group totals — same rule as the dashboard summary.
    if (account.status !== "unavailable") {
      if (account.dailyPnl != null) {
        group.totalDailyPnl += account.dailyPnl;
        group.hasPnlData = true;
      }
      if (account.remainingDailyLoss != null) {
        group.totalRiskRemaining += account.remainingDailyLoss;
        group.hasRiskData = true;
      }
    }
    if (
      account.lastSyncAt != null &&
      (group.lastSyncAt == null || account.lastSyncAt > group.lastSyncAt)
    ) {
      group.lastSyncAt = account.lastSyncAt;
    }
  }

  return [...groupMap.values()].sort((a, b) => {
    const aSink = sinkKeys.has(a.firmKey);
    const bSink = sinkKeys.has(b.firmKey);
    if (aSink !== bSink) return aSink ? 1 : -1;
    return a.firmLabel.localeCompare(b.firmLabel);
  });
}
