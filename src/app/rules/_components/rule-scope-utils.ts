/**
 * Parses the scope and id query params from the Trading Plan page URL.
 * Returns scope="default" with accountId=null when params are absent or invalid.
 */
export function parseRuleScopeParams(params: { scope?: string; id?: string }): {
  scope: "default" | "account";
  accountId: string | null;
} {
  const isAccount = params.scope === "account" && Boolean(params.id);
  return {
    scope: isAccount ? "account" : "default",
    accountId: isAccount ? params.id! : null,
  };
}

/**
 * Builds the URL that opens the Trading Plan editor with a specific account selected.
 * Use this wherever an account-specific rule edit link is needed.
 */
export function buildAccountRulesUrl(accountId: string): string {
  return `/rules?scope=account&id=${accountId}`;
}

const PLATFORM_LABEL: Record<string, string> = {
  tradovate: "Tradovate",
  tradingview: "TradingView",
  manual: "Manual",
};

export type RuleScopeAccount = {
  id: string;
  label: string;
  platform: string;
  propFirm: string | null;
  connectionStatus: string;
  brokerConnectionId: string | null;
  hasAccountRules: boolean;
  missingFromBrokerSince: Date | null;
  brokerConnection: {
    id: string;
    platform: string;
    env: string;
    brokerUserId: string | null;
    connectionStatus: string;
  } | null;
};

export type RuleScopeGroup = {
  /** `{firmLabel}::{brokerConnectionId}` — unique per firm+connection pair */
  groupKey: string;
  firmLabel: string;
  platform: string;
  env: string;
  connectionStatus: string;
  brokerUserId: string | null;
  accounts: RuleScopeAccount[];
};

export type RuleScopeResult = {
  groups: RuleScopeGroup[];
  /** Accounts with no broker connection (manual, legacy). */
  unattached: RuleScopeAccount[];
};

/**
 * Groups broker-connected accounts by firm+connection and collects unattached
 * accounts separately. Groups are sorted alphabetically by firmLabel.
 */
export function buildRuleScopes(accounts: RuleScopeAccount[]): RuleScopeResult {
  const groupMap = new Map<string, RuleScopeGroup>();
  const unattached: RuleScopeAccount[] = [];

  for (const account of accounts) {
    if (!account.brokerConnectionId || !account.brokerConnection) {
      unattached.push(account);
      continue;
    }
    const bc = account.brokerConnection;
    const firmLabel = account.propFirm ?? (PLATFORM_LABEL[bc.platform] ?? bc.platform);
    const groupKey = `${firmLabel}::${account.brokerConnectionId}`;

    let group = groupMap.get(groupKey);
    if (!group) {
      group = {
        groupKey,
        firmLabel,
        platform: bc.platform,
        env: bc.env,
        connectionStatus: bc.connectionStatus,
        brokerUserId: bc.brokerUserId,
        accounts: [],
      };
      groupMap.set(groupKey, group);
    }
    group.accounts.push(account);
  }

  const groups = [...groupMap.values()].sort((a, b) =>
    a.firmLabel.localeCompare(b.firmLabel),
  );

  return { groups, unattached };
}
