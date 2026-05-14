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

/**
 * Filters groups to those that should show the expired-connection banner.
 *
 * Three conditions must ALL be true for the banner to fire:
 *
 *   (a) The group's broker connection is expired or errored.
 *
 *   (b) At least one account in the group has missingFromBrokerSince === null
 *       AND status !== "unavailable". Accounts gone from the broker
 *       (missingFromBrokerSince set → status: "unavailable") are not
 *       actionable; reconnecting won't restore them.
 *
 *   (c) No other group has a healthy connection for the same brokerEnv.
 *       When the user already has an active Demo grant, an old expired Demo
 *       grant is irrelevant — the MFFU accounts on that old grant may not
 *       have had a sync run to set missingFromBrokerSince yet, but they are
 *       not the active connection and the banner is noise.
 *
 * Suppressed scenarios:
 *   - All accounts have missingFromBrokerSince set (confirmed gone from broker)
 *   - Expired grant for an env where a healthy grant already exists
 *     (e.g. old expired Demo BC when user reconnected to a new Demo BC)
 *
 * missingFromBrokerSince and status are available on every CommandCenterAccount
 * (loaded from the DB query in data.ts and mapped in the computed array).
 */
export function filterExpiredGroups(groups: CommandCenterFirmGroup[]): CommandCenterFirmGroup[] {
  // Connection statuses that indicate a functioning OAuth grant.
  const HEALTHY = new Set([
    "connected_live",
    "connected_readonly",
    "pending_webhook",
    "oauth_pending_storage",
  ]);

  // Collect the envs already covered by at least one healthy group.
  const healthyEnvs = new Set<string | null>();
  for (const g of groups) {
    if (HEALTHY.has(g.connectionStatus)) {
      healthyEnvs.add(g.brokerEnv);
    }
  }

  return groups.filter(
    (g) =>
      // (a) expired or errored connection
      (g.connectionStatus === "expired" || g.connectionStatus === "connection_error") &&
      // (b) at least one account not yet confirmed gone from broker
      g.accounts.some(
        (a) => a.missingFromBrokerSince === null && a.status !== "unavailable",
      ) &&
      // (c) no healthy connection already covers this env
      !healthyEnvs.has(g.brokerEnv),
  );
}

/**
 * Filters accounts to those matching the given accountType.
 * Returns the full list unchanged when typeFilter is "all".
 */
export function filterAccountsByType(
  accounts: CommandCenterAccount[],
  typeFilter: string,
): CommandCenterAccount[] {
  if (typeFilter === "all") return accounts;
  return accounts.filter((a) => a.accountType === typeFilter);
}

/**
 * Recomputes group aggregate totals from a filtered subset of visible accounts.
 *
 * Called by the UI whenever a status filter hides some rows so the group header
 * reflects only the accounts currently shown — not the full unfiltered group.
 * Mirrors the same exclusion rule as buildCommandCenterGroups: unavailable
 * accounts are kept in the list for visibility but their stale P&L / risk
 * budget is excluded from totals.
 */
export function recomputeGroupAggregates(
  group: CommandCenterFirmGroup,
  visibleAccounts: CommandCenterAccount[],
): CommandCenterFirmGroup {
  const counts = emptyCounts();
  let totalDailyPnl = 0;
  let totalRiskRemaining = 0;
  let hasPnlData = false;
  let hasRiskData = false;
  for (const a of visibleAccounts) {
    counts[a.status] += 1;
    if (a.status !== "unavailable") {
      if (a.dailyPnl != null) {
        totalDailyPnl += a.dailyPnl;
        hasPnlData = true;
      }
      if (a.remainingDailyLoss != null) {
        totalRiskRemaining += a.remainingDailyLoss;
        hasRiskData = true;
      }
    }
  }
  return { ...group, accounts: visibleAccounts, counts, totalDailyPnl, totalRiskRemaining, hasPnlData, hasRiskData };
}
