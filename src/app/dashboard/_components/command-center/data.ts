import { prisma } from "@/lib/db";

import { getProtectionLockState } from "@/lib/account-protection";
import {
  hasValidConsent,
  resolveConsentForAccount,
} from "@/lib/brokers/automated-actions-consent";
import type { EnforcementTrigger, FlattenStatus } from "@/lib/brokers/enforcement";
import { deriveRulesLabel } from "@/app/accounts/_components/account-rule-helpers";
import { inferAccountClassification } from "@/lib/brokers/account-classification";
import { inferConnectionClassification } from "@/lib/brokers/connection-classification";
import { buildCommandCenterGroups, emptyBreakdown, emptyCounts } from "./group-utils";
import {
  deriveAccountKind,
  deriveBreachReason,
  deriveConnectionStatusLabel,
  deriveEnforcementMode,
  derivePropFirmSetupNeeded,
  deriveStatus,
  resolveEffectiveConnectionStatus,
  resolveSessionDisplayMetrics,
} from "./data-helpers";
import { deriveCmeTradingDayKey } from "@/lib/trading-day";
import { isCmeMaintenanceWindow, isCmeWeekendClose } from "@/lib/time/cme-session";
import { isPreviewEnabled, buildPreviewPendingAccount } from "./discovery-preview";
import { PERSONAL_BROKER_FIRM_KEY } from "./types";
import type {
  CommandCenterAccount,
  CommandCenterData,
  CommandCenterFirmGroup,
  CommandCenterSummary,
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

const FALLBACK_FIRM_LABEL = "Unassigned firm";
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
  // Personal brokerage and personal demo accounts (no prop firm) share a key
  // so they land in the same group. The label prefixes the platform name so
  // "Tradovate · Personal" appears as the group header on the dashboard.
  // buildCommandCenterGroups further separates groups by platform, so a
  // TradingView personal group stays distinct from a Tradovate personal group.
  if (account.accountType === "personal" || account.accountType === "demo") {
    const platformLabel = PLATFORM_LABEL[account.platform] ?? account.platform;
    return { key: PERSONAL_BROKER_FIRM_KEY, label: `${platformLabel} · Personal` };
  }
  return { key: FALLBACK_FIRM_KEY, label: FALLBACK_FIRM_LABEL };
}

export async function loadCommandCenterData(userId: string, userEmail?: string | null): Promise<CommandCenterData> {
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
        brokerConnection: {
          select: {
            createdAt: true,
            permissionLevel: true,
            env: true,
            connectionStatus: true,
            listenerStatus: true,
            listenerLastEventAt: true,
            listenerLastHeartbeatAt: true,
            listenerLastCloseCode: true,
            listenerLastCloseReason: true,
          },
        },
      },
      orderBy: [{ propFirm: "asc" }, { label: "asc" }],
    }),
    prisma.riskRules.findUnique({ where: { userId } }),
  ]);

  // Pending-decision rows: rendered in a separate "New accounts found" panel.
  // We pull `propFirm` and the parent `brokerConnection.env` so the panel can
  // disambiguate live vs demo and show prop-firm context for each discovered row.
  const pendingRows = await prisma.connectedAccount.findMany({
    where: { userId, isActive: true, protectionStatus: "pending_decision" },
    select: {
      id: true,
      label: true,
      externalAccountId: true,
      platform: true,
      accountType: true,
      propFirm: true,
      brokerConnectionId: true,
      lastSeenInBrokerAt: true,
      brokerConnection: { select: { env: true } },
    },
    orderBy: { lastSeenInBrokerAt: "desc" },
  });

  // Find all BrokerConnections for this user that currently have an active
  // listener. Used below to fill in listener freshness when an account's direct
  // brokerConnectionId points to an older connection (common after an OAuth
  // reconnect creates a new BrokerConnection while existing ConnectedAccount rows
  // still reference the previous one).
  const activeListenerConnections = await prisma.brokerConnection.findMany({
    where: {
      userId,
      platform: "tradovate",
      connectionStatus: { in: ["connected_live", "connected_readonly"] },
      listenerStatus: { in: ["connected", "connecting", "reconnecting"] },
    },
    select: {
      id: true,
      env: true,
      listenerStatus: true,
      listenerLastEventAt: true,
      listenerLastHeartbeatAt: true,
      listenerLastCloseCode: true,
      listenerLastCloseReason: true,
    },
    orderBy: { listenerConnectedAt: "desc" },
  });

  // env → most-recently-connected active listener (first row wins after desc sort)
  const activeListenerByEnv = new Map<
    string,
    (typeof activeListenerConnections)[number]
  >();
  for (const conn of activeListenerConnections) {
    if (!activeListenerByEnv.has(conn.env)) {
      activeListenerByEnv.set(conn.env, conn);
    }
  }

  const isDryRun = process.env.ENFORCEMENT_DRY_RUN === "true";

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

  // CME trading day key used to detect stale LiveSessionState rows — a row
  // whose sessionDate differs from this key is from a prior session and must
  // not be shown as today's count/P&L (would display yesterday's "2 trades").
  const todayKey = deriveCmeTradingDayKey();
  // True during the CME daily maintenance break (4:00–5:00 PM CT, Mon–Thu).
  // Drives "Maintenance" badge and "CME break" banner.
  const isMaintenanceWindow = isCmeMaintenanceWindow();
  // True during the weekend close (Fri 4:00 PM CT → Sun 5:00 PM CT).
  // Drives "Closed" badge and "Market closed" banner.
  const isWeekendClose = isCmeWeekendClose();

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

    const { tradesCount, dailyPnl, tradeCountSource } = resolveSessionDisplayMetrics(
      sessionState,
      todayKey,
    );
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

    // BC.connectionStatus is the ground truth — it is updated immediately on
    // reconnect/expiry. The linked ConnectedAccount.connectionStatus can lag
    // behind: the expiry cascade is instant, but the reverse heal (after
    // reconnect) may not have run yet. Use the BC status when available.
    const effectiveConnectionStatus = resolveEffectiveConnectionStatus(
      account.connectionStatus,
      account.brokerConnection?.connectionStatus,
    );

    if (
      account.brokerConnection?.connectionStatus != null &&
      account.brokerConnection.connectionStatus !== account.connectionStatus
    ) {
      console.info("[dashboard] connectionStatus mismatch — using BrokerConnection as authority", {
        accountId: account.id,
        accountLabel: account.label,
        accountConnectionStatus: account.connectionStatus,
        bcConnectionStatus: account.brokerConnection.connectionStatus,
        bcPermissionLevel: account.brokerConnection.permissionLevel,
      });
    }

    const status = deriveStatus({
      isActive: account.isActive,
      platform: account.platform,
      connectionStatus: effectiveConnectionStatus,
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
        effectiveConnectionStatus === "pending_webhook" ||
        effectiveConnectionStatus === "oauth_pending_storage"
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
      connectionStatus: effectiveConnectionStatus,
      isActive: account.isActive,
      permissionLevel: account.brokerConnection?.permissionLevel ?? null,
      isDryRun,
    });

    const { key: firmKey, label: firmLabel } = deriveFirmKeyAndLabel({
      platform: account.platform,
      propFirm: account.propFirm,
      accountType: account.accountType,
    });

    const platformLabel = PLATFORM_LABEL[account.platform] ?? account.platform;
    const accountTypeLabel = ACCOUNT_TYPE_LABEL[account.accountType] ?? account.accountType;
    const connectionStatusLabel = deriveConnectionStatusLabel(effectiveConnectionStatus);

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
      connectionStatus: effectiveConnectionStatus,
      connectionStatusLabel,
      status,
      enforcementMode,
      permissionLevel: account.brokerConnection?.permissionLevel ?? null,
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
      // Resolve effective listener data: the account's direct brokerConnection may
      // point to an older OAuth grant whose listener is closed, while a newer
      // connection for the same env has the active listener. Prefer the active
      // connection's listener fields so the dashboard shows Live when applicable.
      ...(() => {
        const direct = account.brokerConnection;
        const directStatus = direct?.listenerStatus ?? null;
        const isDirectActive =
          directStatus === "connected" ||
          directStatus === "connecting" ||
          directStatus === "reconnecting";
        const effective =
          isDirectActive || !direct?.env
            ? direct
            : (activeListenerByEnv.get(direct.env) ?? direct);
        return {
          listenerStatus: effective?.listenerStatus ?? null,
          listenerLastEventAt: effective?.listenerLastEventAt ?? null,
          listenerLastHeartbeatAt: effective?.listenerLastHeartbeatAt ?? null,
          listenerLastCloseCode: effective?.listenerLastCloseCode ?? null,
          listenerLastCloseReason: effective?.listenerLastCloseReason ?? null,
        };
      })(),
      hasMaxPositionSize: (accountRules?.maxContracts ?? defaultRules?.maxContracts) != null,
      rawBrokerHardLimitEnabled: accountRules?.rawBrokerHardLimitEnabled ?? false,
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
      flattenStatus: (lastIntervention?.flattenStatus ?? null) as FlattenStatus | null,
      brokerConnectionId: account.brokerConnectionId ?? null,
      brokerEnv: account.brokerConnection?.env ?? null,
      lastInterventionTrigger: (lastIntervention?.triggerType ?? null) as EnforcementTrigger | null,
      lastInterventionAt: lastIntervention?.createdAt ?? null,
      hasOpenIntervention,
      protectionStatus: account.protectionStatus as ProtectionStatus,
      pendingProtectionStatus:
        (account.pendingProtectionStatus as ProtectionStatus | null) ?? null,
      pendingProtectionEffectiveDate: account.pendingProtectionEffectiveDate ?? null,
      missingFromBrokerSince: account.missingFromBrokerSince,
      isLockedForToday: protectionLock.isLocked,
      requiresAutomatedActionsConsent:
        account.brokerConnection?.permissionLevel === "full_access" &&
        !hasValidConsent(
          resolveConsentForAccount({
            accountRiskRules: accountRules
              ? {
                  consentAt: accountRules.automatedActionsConsentAt,
                  consentVersion: accountRules.automatedActionsConsentVersion,
                }
              : null,
            defaultRiskRules: defaultRules
              ? {
                  consentAt: defaultRules.automatedActionsConsentAt,
                  consentVersion: defaultRules.automatedActionsConsentVersion,
                }
              : null,
          }).state,
        ),
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
    breakdown: emptyBreakdown(),
    totalDailyPnl: 0,
    totalRiskRemaining: 0,
    openInterventions: 0,
    hasPnlData: false,
    hasRiskData: false,
    oldestSyncAt: null,
  };

  for (const account of computed) {
    summary.counts[account.status] += 1;
    const kind = deriveAccountKind(account.accountType);
    summary.breakdown[account.status].total += 1;
    summary.breakdown[account.status][kind] += 1;
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
    if (
      account.platform !== "manual" &&
      account.lastSyncAt != null &&
      (summary.oldestSyncAt == null || account.lastSyncAt < summary.oldestSyncAt)
    ) {
      summary.oldestSyncAt = account.lastSyncAt;
    }
  }

  const SINK_KEYS = new Set([PERSONAL_BROKER_FIRM_KEY, FALLBACK_FIRM_KEY]);
  const groups = buildCommandCenterGroups(computed, SINK_KEYS);

  // Deduplicate by firmKey: same firm across multiple broker connections shows once
  // in the filter dropdown (filtering by firm shows all connections for that firm).
  const firmsMap = new Map(groups.map((g) => [g.firmKey, g.firmLabel]));
  const firms = [...firmsMap.entries()].map(([key, label]) => ({ key, label }));

  // Build a lightweight sibling list from active accounts so the pending
  // rows can inherit propFirm/accountType from existing connection context.
  const activeSiblings = computed.map((a) => ({
    brokerConnectionId: a.brokerConnectionId,
    propFirm: a.propFirm,
    accountType: a.accountType,
  }));

  // Cache connection classification results so we don't recompute per-account.
  const connectionClassCache = new Map<string, ReturnType<typeof inferConnectionClassification>>();
  function getConnectionClass(connectionId: string | null) {
    if (!connectionId) return { inheritedPropFirm: null, inheritedAccountType: null };
    let cached = connectionClassCache.get(connectionId);
    if (!cached) {
      cached = inferConnectionClassification(connectionId, activeSiblings);
      connectionClassCache.set(connectionId, cached);
    }
    return cached;
  }

  const pendingAccounts: PendingDiscoveredAccount[] = pendingRows.map((p) => {
    const env = p.brokerConnection?.env ?? null;
    const namePattern = inferAccountClassification(p.label);
    const connectionCtx = getConnectionClass(p.brokerConnectionId);
    return {
      id: p.id,
      label: p.label,
      externalAccountId: p.externalAccountId,
      platform: p.platform,
      platformLabel: PLATFORM_LABEL[p.platform] ?? p.platform,
      accountType: p.accountType,
      accountTypeLabel: ACCOUNT_TYPE_LABEL[p.accountType] ?? p.accountType,
      brokerConnectionId: p.brokerConnectionId,
      lastSeenInBrokerAt: p.lastSeenInBrokerAt,
      env,
      envLabel: env === "live" ? "Live account" : env === "demo" ? "Demo / Sim" : null,
      propFirm: p.propFirm ?? null,
      inheritedPropFirm: connectionCtx.inheritedPropFirm,
      inheritedAccountType: connectionCtx.inheritedAccountType,
      suggestedPropFirm: namePattern.propFirm,
      suggestedAccountType: namePattern.accountType,
    };
  });

  // Inject a fake preview account for the feature owner only.
  if (isPreviewEnabled(process.env.ENABLE_DISCOVERY_PREVIEW_FOR_NOAM, userEmail)) {
    const mffConnectionId =
      activeSiblings.find((s) => s.propFirm === "MyFundedFutures")?.brokerConnectionId ?? null;
    pendingAccounts.unshift(buildPreviewPendingAccount(mffConnectionId));
  }

  // Detect active accounts that were imported without classification but whose
  // broker connection has exactly one unambiguous propFirm from siblings.
  // These are surfaced in the dashboard as a one-click repair suggestion.
  const reclassifiableAccounts: import("./types").ReclassifiableAccount[] = [];
  for (const a of computed) {
    if (a.propFirm !== null && a.propFirm.trim() !== "") continue;
    if (!a.brokerConnectionId) continue;
    const ctx = getConnectionClass(a.brokerConnectionId);
    if (ctx.inheritedPropFirm) {
      reclassifiableAccounts.push({
        id: a.id,
        label: a.label,
        inheritedPropFirm: ctx.inheritedPropFirm,
        inheritedAccountType: ctx.inheritedAccountType,
      });
    }
  }

  return {
    accounts: computed,
    groups,
    summary,
    firms,
    pendingAccounts,
    reclassifiableAccounts,
    protectionLock: {
      isLocked: protectionLock.isLocked,
      cutoffTime: protectionLock.cutoffTime ? protectionLock.cutoffTime.toISOString() : null,
      tradingDayKey: protectionLock.tradingDayKey,
      nextTradingDayKey: protectionLock.nextTradingDayKey,
      hasSessionHours: protectionLock.hasSessionHours,
    },
    isMaintenanceWindow,
    isWeekendClose,
  };
}
