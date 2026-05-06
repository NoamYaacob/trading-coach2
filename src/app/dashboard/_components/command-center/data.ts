import { prisma } from "@/lib/db";

import { getProtectionLockState } from "@/lib/account-protection";
import type { EnforcementTrigger } from "@/lib/brokers/enforcement";
import { deriveRulesLabel } from "@/app/accounts/_components/account-rule-helpers";
import { buildCommandCenterGroups, emptyCounts } from "./group-utils";
import { derivePropFirmSetupNeeded, deriveStatus, deriveBreachReason } from "./data-helpers";
import type {
  CommandCenterAccount,
  CommandCenterData,
  CommandCenterFirmGroup,
  CommandCenterSummary,
  EnforcementMode,
  PendingDiscoveredAccount,
  ProtectionStatus,
  RuleSource,
} from "./types";

const PLATFORM_LABEL: Record<string, string> = {
  tradovate: "Tradovate",
  tradingview: "TradingView",
};

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  evaluation: "Evaluation",
  funded: "Funded",
  personal: "Personal",
  demo: "Demo",
};

const CONNECTION_STATUS_LABEL: Record<string, string> = {
  connected_live: "Connected",
  pending_webhook: "Awaiting first event",
  oauth_pending_storage: "OAuth pending",
  not_connected: "Not connected",
  connection_error: "Connection error",
  expired: "Expired — re-authorize",
};

// Personal brokerage / personal-source accounts have no prop firm — they get
// their own group instead of being lumped under "Unassigned firm" (which is
// reserved for prop-firm-style accounts that never had a firm selected).
const FALLBACK_FIRM_LABEL = "Unassigned firm";
const PERSONAL_BROKER_FIRM_LABEL = "Personal accounts";
const PERSONAL_BROKER_FIRM_KEY = "__personal_broker__";
const FALLBACK_FIRM_KEY = "__unassigned__";

function deriveFirmKeyAndLabel(account: {
  platform: string;
  propFirm: string | null;
  accountType: string;
}): { key: string; label: string } {
  if (account.propFirm && account.propFirm.trim().length > 0) {
    const label = account.propFirm.trim();
    return { key: label.toLowerCase(), label };
  }
  if (account.accountType === "personal") {
    return { key: PERSONAL_BROKER_FIRM_KEY, label: PERSONAL_BROKER_FIRM_LABEL };
  }
  return { key: FALLBACK_FIRM_KEY, label: FALLBACK_FIRM_LABEL };
}

function deriveEnforcementMode(input: {
  platform: string;
  connectionStatus: string;
  isActive: boolean;
}): EnforcementMode {
  if (!input.isActive) return "not_connected";
  // Both connected_live (full) and connected_readonly (post-OAuth import) count
  // as "broker_readonly" mode for UI purposes — the chip/label is the same and
  // we explicitly do not claim broker-side enforcement is active.
  if (
    input.connectionStatus === "connected_live" ||
    input.connectionStatus === "connected_readonly"
  ) {
    return "broker_readonly";
  }
  return "not_connected";
}

export async function loadCommandCenterData(userId: string): Promise<CommandCenterData> {
  const [accounts, defaultRules] = await Promise.all([
    prisma.connectedAccount.findMany({
      where: {
        userId,
        isActive: true,
        // Active dashboard hides ignored + archived. Pending decision is
        // surfaced in a dedicated panel, not in the main accounts list.
        protectionStatus: { in: ["protected", "monitor_only"] },
      },
      include: {
        riskRules: true,
        sessionState: true,
        interventions: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        brokerConnection: { select: { createdAt: true } },
      },
      orderBy: [{ propFirm: "asc" }, { label: "asc" }],
    }),
    prisma.riskRules.findUnique({ where: { userId } }),
  ]);

  // Pending-decision rows: rendered in a separate "New accounts found" panel.
  const pendingRows = await prisma.connectedAccount.findMany({
    where: { userId, isActive: true, protectionStatus: "pending_decision" },
    select: {
      id: true,
      label: true,
      externalAccountId: true,
      platform: true,
      accountType: true,
      brokerConnectionId: true,
      lastSeenInBrokerAt: true,
    },
    orderBy: { lastSeenInBrokerAt: "desc" },
  });

  const protectionLock = getProtectionLockState({
    sessionStartHour: defaultRules?.sessionStartHour ?? null,
    sessionEndHour: defaultRules?.sessionEndHour ?? null,
    cutoffMinutes: defaultRules?.protectionLockCutoffMinutes ?? null,
  });

  const defaultMaxDailyLoss =
    defaultRules?.maxDailyLoss != null ? Number(defaultRules.maxDailyLoss) : null;
  const defaultMaxTradesPerDay = defaultRules?.maxTradesPerDay ?? null;
  const defaultStopAfterLosses = defaultRules?.stopAfterLosses ?? null;
  const hasDefaultRules = Boolean(
    defaultMaxDailyLoss != null || defaultMaxTradesPerDay != null || defaultStopAfterLosses != null,
  );

  const computed: CommandCenterAccount[] = accounts.map((account) => {
    const accountRules = account.riskRules;
    const sessionState = account.sessionState;
    const lastIntervention = account.interventions[0] ?? null;

    const hasAccountRules = Boolean(
      accountRules &&
        (accountRules.maxDailyLoss != null ||
          accountRules.maxTradesPerDay != null ||
          accountRules.stopAfterLosses != null),
    );
    const ruleSource: RuleSource = hasAccountRules
      ? "account"
      : hasDefaultRules
        ? "default"
        : "none";

    const maxDailyLoss =
      accountRules?.maxDailyLoss != null
        ? Number(accountRules.maxDailyLoss)
        : defaultMaxDailyLoss;
    const maxTradesPerDay = accountRules?.maxTradesPerDay ?? defaultMaxTradesPerDay;
    const stopAfterLosses = accountRules?.stopAfterLosses ?? defaultStopAfterLosses;

    const dailyPnl = sessionState ? Number(sessionState.dailyPnl) : null;
    const tradesCount = sessionState ? sessionState.tradesCount : null;
    const tradeCountSource: "verified" | "estimated" | "unavailable" = sessionState
      ? ((sessionState.tradeCountSource ?? "verified") as "verified" | "estimated" | "unavailable")
      : "unavailable";
    const consecutiveLosses = sessionState ? sessionState.consecutiveLosses : null;
    const riskState = sessionState
      ? (sessionState.riskState as "NORMAL" | "WARNING" | "STOPPED")
      : null;

    const balance = account.balance != null ? Number(account.balance) : null;
    const lossUsed = dailyPnl != null ? Math.abs(Math.min(dailyPnl, 0)) : null;

    // Base remaining loss budget from user-configured limit
    let remainingDailyLoss: number | null =
      maxDailyLoss != null && lossUsed != null
        ? Math.max(0, maxDailyLoss - lossUsed)
        : maxDailyLoss != null
          ? maxDailyLoss
          : null;

    // Part B: for personal accounts, cap the displayed budget at account balance
    const balanceLimitedWarning =
      account.accountType === "personal" &&
      balance != null &&
      maxDailyLoss != null &&
      maxDailyLoss > balance;
    if (account.accountType === "personal" && balance != null && remainingDailyLoss != null) {
      remainingDailyLoss = Math.min(remainingDailyLoss, balance);
    }

    // Part C: prop firm accounts — effective budget = min of user + prop firm limits
    const isPropFirm = account.propFirm != null && account.propFirm.trim() !== "";
    const propFirmSetupNeeded = derivePropFirmSetupNeeded({
      isPropFirm,
      hasAccountRules,
      hasDefaultRules,
      hasPropFirmDailyLossLimit: accountRules?.propFirmDailyLossLimit != null,
      hasPropFirmMaxDrawdown: accountRules?.propFirmMaxDrawdown != null,
      hasPropFirmDrawdownRemaining: accountRules?.propFirmDrawdownRemaining != null,
    });
    let propFirmLimited = false;
    if (isPropFirm && accountRules != null) {
      const pfDailyLimit =
        accountRules.propFirmDailyLossLimit != null
          ? Number(accountRules.propFirmDailyLossLimit)
          : null;
      const pfDrawdownRemaining =
        accountRules.propFirmDrawdownRemaining != null
          ? Number(accountRules.propFirmDrawdownRemaining)
          : null;
      if (pfDailyLimit != null) {
        const pfDailyRemaining =
          lossUsed != null ? Math.max(0, pfDailyLimit - lossUsed) : pfDailyLimit;
        if (remainingDailyLoss == null || pfDailyRemaining < remainingDailyLoss) {
          remainingDailyLoss = pfDailyRemaining;
          propFirmLimited = true;
        }
      }
      if (pfDrawdownRemaining != null) {
        if (remainingDailyLoss == null || pfDrawdownRemaining < remainingDailyLoss) {
          remainingDailyLoss = pfDrawdownRemaining;
          propFirmLimited = true;
        }
      }
    }

    const dailyLossUsedPct =
      maxDailyLoss != null && maxDailyLoss > 0 && lossUsed != null
        ? Math.min(1, lossUsed / maxDailyLoss)
        : null;
    const tradesUsedPct =
      maxTradesPerDay != null && maxTradesPerDay > 0 && tradesCount != null
        ? Math.min(1, tradesCount / maxTradesPerDay)
        : null;

    const balanceUnavailableForBudget =
      account.accountType === "personal" && balance == null && maxDailyLoss != null;

    const rulesLabel = deriveRulesLabel(hasAccountRules, hasDefaultRules, isPropFirm);

    const status = deriveStatus({
      isActive: account.isActive,
      platform: account.platform,
      connectionStatus: account.connectionStatus,
      hasAnyRules: hasAccountRules || hasDefaultRules,
      propFirmSetupNeeded,
      riskState,
      dailyLossUsedPct,
      tradesCount,
      maxTradesPerDay,
      tradeCountSource,
      missingFromBrokerSince: account.missingFromBrokerSince,
    });

    let setupNeededReason: "no_rules" | "pending_connection" | "prop_firm_rules_missing" | null = null;
    if (status === "setup_needed") {
      if (
        account.connectionStatus === "pending_webhook" ||
        account.connectionStatus === "oauth_pending_storage"
      ) {
        setupNeededReason = "pending_connection";
      } else if (propFirmSetupNeeded) {
        setupNeededReason = "prop_firm_rules_missing";
      } else {
        setupNeededReason = "no_rules";
      }
    }

    const breachReason = deriveBreachReason({
      status,
      riskState,
      dailyLossUsedPct,
      tradesCount,
      maxTradesPerDay,
      consecutiveLosses,
      stopAfterLosses,
      tradeCountSource,
    });

    const enforcementMode = deriveEnforcementMode({
      platform: account.platform,
      connectionStatus: account.connectionStatus,
      isActive: account.isActive,
    });

    const { key: firmKey, label: firmLabel } = deriveFirmKeyAndLabel({
      platform: account.platform,
      propFirm: account.propFirm,
      accountType: account.accountType,
    });

    const platformLabel = PLATFORM_LABEL[account.platform] ?? account.platform;
    const accountTypeLabel = ACCOUNT_TYPE_LABEL[account.accountType] ?? account.accountType;
    const connectionStatusLabel =
      CONNECTION_STATUS_LABEL[account.connectionStatus] ??
      account.connectionStatus.replace(/_/g, " ");

    const hasOpenIntervention = Boolean(
      lastIntervention &&
        (status === "locked" || status === "warning") &&
        // Only count interventions from the last 24h as "open" for the dashboard counter.
        Date.now() - lastIntervention.createdAt.getTime() < 24 * 60 * 60 * 1000,
    );

    // Pre-connection activity disclosure: tradesCount uses the full broker
    // trading day (Option A — needed for accurate risk enforcement). When the
    // broker connection itself was created today, the count may include fills
    // that happened before Guardrail was watching the account. Conservative
    // detection: same UTC date as today AND tradesCount > 0.
    const brokerConnectedAt = account.brokerConnection?.createdAt ?? null;
    const now = new Date();
    const tradesMayIncludePreConnection =
      brokerConnectedAt != null &&
      tradesCount != null &&
      tradesCount > 0 &&
      brokerConnectedAt.getUTCFullYear() === now.getUTCFullYear() &&
      brokerConnectedAt.getUTCMonth() === now.getUTCMonth() &&
      brokerConnectedAt.getUTCDate() === now.getUTCDate();

    return {
      id: account.id,
      label: account.label,
      platform: account.platform,
      platformLabel,
      propFirm: account.propFirm,
      firmKey,
      firmLabel,
      accountType: account.accountType,
      accountTypeLabel,
      connectionStatus: account.connectionStatus,
      connectionStatusLabel,
      status,
      enforcementMode,
      ruleSource,
      rulesLabel,
      balance,
      openPnl: account.openPnl != null ? Number(account.openPnl) : null,
      dailyPnl,
      maxDailyLoss,
      remainingDailyLoss,
      dailyLossUsedPct,
      tradesCount,
      tradesMayIncludePreConnection,
      tradeCountSource,
      maxTradesPerDay,
      tradesUsedPct,
      consecutiveLosses,
      stopAfterLosses,
      lastSyncAt: account.lastSyncAt,
      fillsSyncedAt: account.fillsSyncedAt,
      balanceLimitedWarning,
      balanceUnavailableForBudget,
      propFirmSetupNeeded,
      propFirmLimited,
      setupNeededReason,
      breachReason,
      brokerLockStatus: (lastIntervention?.brokerLockStatus ?? null) as
        | "not_requested"
        | "unavailable_read_only"
        | "unavailable_permission"
        | "pending"
        | "broker_locked"
        | "monitoring_only"
        | "broker_lock_failed"
        | "dry_run"
        | null,
      brokerConnectionId: account.brokerConnectionId ?? null,
      lastInterventionTrigger: (lastIntervention?.triggerType ?? null) as EnforcementTrigger | null,
      lastInterventionAt: lastIntervention?.createdAt ?? null,
      hasOpenIntervention,
      protectionStatus: account.protectionStatus as ProtectionStatus,
      pendingProtectionStatus:
        (account.pendingProtectionStatus as ProtectionStatus | null) ?? null,
      pendingProtectionEffectiveDate: account.pendingProtectionEffectiveDate ?? null,
      missingFromBrokerSince: account.missingFromBrokerSince,
      isLockedForToday: protectionLock.isLocked,
    };
  });

  // Accounts the broker no longer returns ("unavailable") are excluded from
  // every aggregate — totalActive, counts, totalDailyPnl, totalRiskRemaining,
  // openInterventions. Their cached balance/P&L is stale by definition since
  // the prop firm has reset/closed/removed the account.
  const liveForSummary = computed.filter((a) => a.status !== "unavailable");
  const summary: CommandCenterSummary = {
    totalActive: liveForSummary.length,
    counts: emptyCounts(),
    totalDailyPnl: 0,
    totalRiskRemaining: 0,
    openInterventions: 0,
    hasPnlData: false,
    hasRiskData: false,
  };

  for (const account of computed) {
    // Count unavailable in its own bucket so the dashboard can show it in
    // chips if needed, but do not include its stale numbers in totals.
    summary.counts[account.status] += 1;
    if (account.status === "unavailable") continue;
    if (account.dailyPnl != null) {
      summary.totalDailyPnl += account.dailyPnl;
      summary.hasPnlData = true;
    }
    if (account.remainingDailyLoss != null) {
      summary.totalRiskRemaining += account.remainingDailyLoss;
      summary.hasRiskData = true;
    }
    if (account.hasOpenIntervention) summary.openInterventions += 1;
  }

  const SINK_KEYS = new Set([PERSONAL_BROKER_FIRM_KEY, FALLBACK_FIRM_KEY]);
  const groups = buildCommandCenterGroups(computed, SINK_KEYS);

  // Deduplicate by firmKey: same firm across multiple broker connections shows once
  // in the filter dropdown (filtering by firm shows all connections for that firm).
  const firmsMap = new Map(groups.map((g) => [g.firmKey, g.firmLabel]));
  const firms = [...firmsMap.entries()].map(([key, label]) => ({ key, label }));

  const pendingAccounts: PendingDiscoveredAccount[] = pendingRows.map((p) => ({
    id: p.id,
    label: p.label,
    externalAccountId: p.externalAccountId,
    platform: p.platform,
    platformLabel: PLATFORM_LABEL[p.platform] ?? p.platform,
    accountType: p.accountType,
    accountTypeLabel: ACCOUNT_TYPE_LABEL[p.accountType] ?? p.accountType,
    brokerConnectionId: p.brokerConnectionId,
    lastSeenInBrokerAt: p.lastSeenInBrokerAt,
  }));

  return {
    accounts: computed,
    groups,
    summary,
    firms,
    pendingAccounts,
    protectionLock: {
      isLocked: protectionLock.isLocked,
      cutoffTime: protectionLock.cutoffTime ? protectionLock.cutoffTime.toISOString() : null,
      tradingDayKey: protectionLock.tradingDayKey,
      nextTradingDayKey: protectionLock.nextTradingDayKey,
      hasSessionHours: protectionLock.hasSessionHours,
    },
  };
}
