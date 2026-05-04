import { prisma } from "@/lib/db";

import { getProtectionLockState } from "@/lib/account-protection";
import type {
  AccountStatus,
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
  manual: "Manual",
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
const MANUAL_FIRM_LABEL = "Personal / Manual";
const PERSONAL_BROKER_FIRM_KEY = "__personal_broker__";
const MANUAL_FIRM_KEY = "__personal_manual__";
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
  if (account.platform === "manual") {
    return { key: MANUAL_FIRM_KEY, label: MANUAL_FIRM_LABEL };
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
  if (input.platform === "manual") return "manual_app_level";
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

function deriveStatus(input: {
  isActive: boolean;
  platform: string;
  connectionStatus: string;
  hasAnyRules: boolean;
  propFirmSetupNeeded: boolean;
  riskState: "NORMAL" | "WARNING" | "STOPPED" | null;
  dailyLossUsedPct: number | null;
  tradesCount: number | null;
  maxTradesPerDay: number | null;
}): AccountStatus {
  if (!input.isActive) return "not_connected";

  // Broker accounts that have not finished setup or have a broken connection.
  if (input.platform !== "manual") {
    if (
      input.connectionStatus === "not_connected" ||
      input.connectionStatus === "connection_error" ||
      input.connectionStatus === "expired"
    ) {
      return "not_connected";
    }
    if (
      input.connectionStatus === "pending_webhook" ||
      input.connectionStatus === "oauth_pending_storage"
    ) {
      return "setup_needed";
    }
  }

  if (!input.hasAnyRules) return "setup_needed";
  if (input.propFirmSetupNeeded) return "setup_needed";

  if (input.riskState === "STOPPED") return "locked";
  if (input.riskState === "WARNING") return "warning";

  const lossPct = input.dailyLossUsedPct ?? 0;
  if (lossPct >= 1.0) return "locked";
  if (lossPct >= 0.8) return "warning";

  const { tradesCount, maxTradesPerDay } = input;
  if (tradesCount != null && maxTradesPerDay != null) {
    if (tradesCount >= maxTradesPerDay) return "locked";
    if (maxTradesPerDay > 1 && tradesCount === maxTradesPerDay - 1) return "warning";
  }

  return "allowed";
}

function emptyCounts(): Record<AccountStatus, number> {
  return { allowed: 0, warning: 0, locked: 0, setup_needed: 0, not_connected: 0 };
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
    const propFirmSetupNeeded =
      isPropFirm &&
      (accountRules == null ||
        (accountRules.propFirmMaxDrawdown == null &&
          accountRules.propFirmDailyLossLimit == null &&
          accountRules.propFirmDrawdownRemaining == null));
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

    let breachReason: { headline: string; detail?: string } | null = null;
    if (status === "warning" || status === "locked") {
      if (riskState === "STOPPED" && tradesCount != null && maxTradesPerDay != null && tradesCount > maxTradesPerDay) {
        breachReason = { headline: "Post-lock activity detected" };
      } else if (riskState === "STOPPED" || (dailyLossUsedPct != null && dailyLossUsedPct >= 1)) {
        breachReason = {
          headline: "Daily loss limit reached",
          detail: "This account is locked for the rest of the trading day.",
        };
      } else if (tradesCount != null && maxTradesPerDay != null && tradesCount >= maxTradesPerDay) {
        breachReason = {
          headline: `Trade limit reached: ${tradesCount}/${maxTradesPerDay}`,
          detail: "This account is locked for the rest of the trading day.",
        };
      } else if (
        consecutiveLosses != null &&
        stopAfterLosses != null &&
        consecutiveLosses >= stopAfterLosses
      ) {
        breachReason = { headline: `Loss streak: ${consecutiveLosses}/${stopAfterLosses}` };
      } else if (dailyLossUsedPct != null && dailyLossUsedPct >= 0.8) {
        breachReason = { headline: "Approaching daily loss limit" };
      } else if (
        tradesCount != null &&
        maxTradesPerDay != null &&
        maxTradesPerDay > 1 &&
        tradesCount === maxTradesPerDay - 1
      ) {
        breachReason = {
          headline: `Trade limit warning: ${tradesCount}/${maxTradesPerDay}`,
          detail: "One trade left today.",
        };
      }
    }

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
      balance,
      openPnl: account.openPnl != null ? Number(account.openPnl) : null,
      dailyPnl,
      maxDailyLoss,
      remainingDailyLoss,
      dailyLossUsedPct,
      tradesCount,
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
        | "broker_locked"
        | "monitoring_only"
        | "broker_lock_failed"
        | null,
      lastInterventionTrigger: lastIntervention?.triggerType ?? null,
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

  const summary: CommandCenterSummary = {
    totalActive: computed.length,
    counts: emptyCounts(),
    totalDailyPnl: 0,
    totalRiskRemaining: 0,
    openInterventions: 0,
    hasPnlData: false,
    hasRiskData: false,
  };

  for (const account of computed) {
    summary.counts[account.status] += 1;
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

  const groupMap = new Map<string, CommandCenterFirmGroup>();
  for (const account of computed) {
    let group = groupMap.get(account.firmKey);
    if (!group) {
      group = {
        firmKey: account.firmKey,
        firmLabel: account.firmLabel,
        accounts: [],
        counts: emptyCounts(),
        totalDailyPnl: 0,
        totalRiskRemaining: 0,
        hasPnlData: false,
        hasRiskData: false,
      };
      groupMap.set(account.firmKey, group);
    }
    group.accounts.push(account);
    group.counts[account.status] += 1;
    if (account.dailyPnl != null) {
      group.totalDailyPnl += account.dailyPnl;
      group.hasPnlData = true;
    }
    if (account.remainingDailyLoss != null) {
      group.totalRiskRemaining += account.remainingDailyLoss;
      group.hasRiskData = true;
    }
  }

  const SINK_KEYS = new Set([MANUAL_FIRM_KEY, PERSONAL_BROKER_FIRM_KEY, FALLBACK_FIRM_KEY]);
  const groups = [...groupMap.values()].sort((a, b) => {
    // Personal / Manual / Unassigned groups sink to the bottom; otherwise alphabetical.
    const aSink = SINK_KEYS.has(a.firmKey);
    const bSink = SINK_KEYS.has(b.firmKey);
    if (aSink !== bSink) return aSink ? 1 : -1;
    return a.firmLabel.localeCompare(b.firmLabel);
  });

  const firms = groups.map((g) => ({ key: g.firmKey, label: g.firmLabel }));

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
