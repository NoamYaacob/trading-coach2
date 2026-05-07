"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";

import { SyncButton } from "@/app/accounts/_components/sync-button";
import { formatPropFirmDescriptor } from "@/app/accounts/_components/account-rule-helpers";
import { ArchiveAccountButton } from "./archive-account-button";
import {
  COLLAPSED_GROUPS_STORAGE_KEY,
  parseCollapsedPayload,
  pruneStaleCollapsedIds,
  serializeCollapsedPayload,
  toggleCollapsedId,
} from "./collapsed-state";
import { filterAccountsByType, recomputeGroupAggregates } from "./group-utils";
import { NewAccountsPanel } from "./new-accounts-panel";
import { ReclassifyPanel } from "./reclassify-panel";
import { SyncAllButton } from "./sync-all-button";
import {
  PILL_ROW_PRIMARY,
  PILL_ROW_SECONDARY,
  PILL_CARD_PRIMARY,
  PILL_CARD_SECONDARY,
} from "@/components/ui/pill-classes";
import {
  getTradeCountDisplay,
  deriveBrokerEnforcementCopy,
  deriveStaleSyncWarning,
  formatFreshnessLabel,
  deriveFooterCopy,
  deriveGroupStateSuffix,
  deriveOpenHref,
  derivePerAccountStateLabel,
  deriveProtectionStatusPanel,
  deriveRowStatusLabel,
  deriveRulesHref,
  deriveTradingPermissionStatus,
  ESTIMATED_TRADE_COUNT_HINT,
  ESTIMATED_TRADE_COUNT_SHORT,
  type ProtectionStatusPanelData,
  type TradingPermissionStatus,
} from "./data-helpers";
import { CRON_SYNC_FRESHNESS_MS } from "@/lib/sync-freshness";
import { PERSONAL_BROKER_FIRM_KEY } from "./types";
import type {
  AccountStatus,
  CommandCenterAccount,
  CommandCenterData,
  CommandCenterFirmGroup,
  EnforcementMode,
  RuleSource,
} from "./types";

const CURRENCY_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const BALANCE_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const TYPE_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "evaluation", label: "Evaluation" },
  { value: "funded", label: "Funded" },
  { value: "personal", label: "Live / Personal" },
  { value: "demo", label: "Demo" },
];

const STATUS_FILTERS: { value: AccountStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  // Filter still maps to the underlying "allowed" status; the user-facing
  // chip says "Tradable" to match the row badges and SummaryStrip tile.
  { value: "allowed", label: "Tradable" },
  { value: "warning", label: "Warning" },
  { value: "locked", label: "Locked" },
  { value: "setup_needed", label: "Setup needed" },
  { value: "not_connected", label: "Not connected" },
  { value: "unavailable", label: "Unavailable" },
];

const SETUP_NEEDED_REASON_TEXT: Record<
  "no_rules" | "pending_connection" | "prop_firm_rules_missing",
  string
> = {
  no_rules: "No trading plan assigned",
  pending_connection: "Awaiting first broker event",
  prop_firm_rules_missing: "Enter prop firm limits",
};

const STATUS_BADGE_CLASS: Record<AccountStatus, string> = {
  allowed: "bg-emerald-100 text-emerald-800",
  warning: "bg-amber-100 text-amber-800",
  locked: "bg-red-100 text-red-800",
  setup_needed: "bg-stone-200 text-stone-700",
  not_connected: "bg-stone-100 text-stone-500",
  unavailable: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
};

const STATUS_DOT_CLASS: Record<AccountStatus, string> = {
  allowed: "bg-emerald-500",
  warning: "bg-amber-400",
  locked: "bg-red-500",
  setup_needed: "bg-stone-400",
  not_connected: "bg-stone-300",
  unavailable: "bg-amber-500",
};

const RULE_SOURCE_LABEL: Record<RuleSource, string> = {
  account: "Account rules",
  default: "Default trading plan",
  none: "No rules configured",
};

function formatSignedCurrency(amount: number): string {
  if (amount === 0) return CURRENCY_FORMATTER.format(0);
  const formatted = CURRENCY_FORMATTER.format(Math.abs(amount));
  return amount < 0 ? `−${formatted}` : `+${formatted}`;
}

function pnlClass(amount: number | null): string {
  if (amount == null) return "text-stone-400";
  if (amount > 0) return "text-emerald-700";
  if (amount < 0) return "text-red-700";
  return "text-stone-900";
}

function progressBarClass(pct: number | null): string {
  if (pct == null) return "bg-stone-200";
  if (pct >= 1) return "bg-red-500";
  if (pct >= 0.8) return "bg-amber-400";
  return "bg-emerald-500";
}

export function CommandCenter({ data }: { data: CommandCenterData }) {
  const [statusFilter, setStatusFilter] = useState<AccountStatus | "all">("all");
  const [firmFilter, setFirmFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  // Collapsed-groups preference: groupIds the user has explicitly collapsed.
  // Lives in localStorage so it survives refresh, navigation, and filter
  // changes (lifted out of FirmSection so unmount-on-filter doesn't reset it).
  // Initial state is empty so the SSR HTML matches the first client render —
  // localStorage is read in a post-hydration effect.
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(COLLAPSED_GROUPS_STORAGE_KEY);
    } catch {
      return;
    }
    const parsed = parseCollapsedPayload(raw);
    if (parsed.size > 0) setCollapsedGroups(parsed);
  }, []);

  const validGroupIds = useMemo(
    () => new Set(data.groups.map((g) => g.groupId)),
    [data.groups],
  );

  const handleToggleCollapsed = useCallback(
    (groupId: string) => {
      setCollapsedGroups((prev) => {
        const toggled = toggleCollapsedId(prev, groupId);
        const next = pruneStaleCollapsedIds(toggled, validGroupIds);
        try {
          if (typeof window !== "undefined") {
            window.localStorage.setItem(
              COLLAPSED_GROUPS_STORAGE_KEY,
              serializeCollapsedPayload(next),
            );
          }
        } catch {
          // Private mode / storage disabled — fall back to in-memory only.
        }
        return next;
      });
    },
    [validGroupIds],
  );

  const filteredGroups = useMemo<CommandCenterFirmGroup[]>(() => {
    return data.groups
      .filter((group) => firmFilter === "all" || group.firmKey === firmFilter)
      .map((group) => {
        let visibleAccounts = group.accounts;
        if (statusFilter !== "all") {
          visibleAccounts = visibleAccounts.filter((a) => a.status === statusFilter);
        }
        if (typeFilter !== "all") {
          visibleAccounts = filterAccountsByType(visibleAccounts, typeFilter);
        }
        // When any filter narrows the visible set, recompute group header totals
        // so P&L / budget only reflects the accounts currently shown.
        if (statusFilter === "all" && typeFilter === "all") {
          return { ...group, accounts: visibleAccounts };
        }
        return recomputeGroupAggregates(group, visibleAccounts);
      })
      .filter((group) => group.accounts.length > 0);
  }, [data.groups, statusFilter, firmFilter, typeFilter]);

  // Status-chip counts reflect every group — collapsing a group is local UI
  // state only and never affects monitoring or filter math.
  const visibleCounts = useMemo(() => {
    const counts: Record<AccountStatus, number> = {
      allowed: 0,
      warning: 0,
      locked: 0,
      setup_needed: 0,
      not_connected: 0,
      unavailable: 0,
    };
    for (const group of data.groups) {
      for (const status of Object.keys(counts) as AccountStatus[]) {
        counts[status] += group.counts[status] ?? 0;
      }
    }
    return counts;
  }, [data.groups]);

  const expiredGroups = data.groups.filter(
    (g) => g.connectionStatus === "expired" || g.connectionStatus === "connection_error",
  );

  if (
    data.accounts.length === 0 &&
    data.pendingAccounts.length === 0 &&
    expiredGroups.length === 0
  ) {
    return null;
  }

  const isDryRunActive = data.accounts.some((a) => a.enforcementMode === "dry_run");
  const requiresConsentAccountsCount = data.accounts.filter(
    (a) => a.requiresAutomatedActionsConsent,
  ).length;
  const protectionPanel = deriveProtectionStatusPanel({
    isDryRunActive,
    requiresConsentCount: requiresConsentAccountsCount,
    isProtectionLocked: data.protectionLock.isLocked,
  });
  const footerCopy = deriveFooterCopy({
    modes: data.accounts.map((a) => a.enforcementMode),
    hasDryRunBanner: isDryRunActive,
  });

  const tradingPermissionStatus = deriveTradingPermissionStatus({ accounts: data.accounts });

  return (
    <div className="grid gap-4">
      {tradingPermissionStatus && (
        <TradingPermissionBlock status={tradingPermissionStatus} />
      )}
      {data.pendingAccounts.length > 0 && (
        <NewAccountsPanel accounts={data.pendingAccounts} />
      )}
      {data.reclassifiableAccounts.length > 0 && (
        <ReclassifyPanel accounts={data.reclassifiableAccounts} />
      )}
      {expiredGroups.map((g) => (
        <ExpiredConnectionBanner key={g.groupId} group={g} />
      ))}
      {data.accounts.length > 0 && (
        <section
          aria-label="Risk command center"
          className="overflow-x-hidden rounded-2xl border border-stone-200 bg-white/95 p-4 shadow-[0_4px_20px_-8px_rgba(28,25,23,0.08)] sm:p-5"
        >
          {protectionPanel && (
            <ProtectionStatusPanel
              panel={protectionPanel}
              nextTradingDayKey={data.protectionLock.nextTradingDayKey}
            />
          )}
          <SectionHeader
            summary={data.summary}
            accounts={data.accounts}
            firms={data.firms}
            firmFilter={firmFilter}
            onFirmChange={setFirmFilter}
            typeFilter={typeFilter}
            onTypeChange={setTypeFilter}
          />
          <FilterBar
            statusFilter={statusFilter}
            counts={visibleCounts}
            onStatusChange={setStatusFilter}
          />

          <div className="mt-5 grid gap-5">
            {filteredGroups.length === 0 ? (
              <EmptyFilterMatch />
            ) : (
              filteredGroups.map((group) => (
                <FirmSection
                  key={group.groupId}
                  group={group}
                  isCollapsed={collapsedGroups.has(group.groupId)}
                  onToggleCollapsed={() => handleToggleCollapsed(group.groupId)}
                />
              ))
            )}
          </div>

          {footerCopy ? (
            <div className="mt-5 border-t border-stone-100 pt-3 text-[11px] text-stone-400">
              {footerCopy}
            </div>
          ) : null}
        </section>
      )}
    </div>
  );
}

// ─── Expired connection banner ─────────────────────────────────────────────────

function ExpiredConnectionBanner({ group }: { group: CommandCenterFirmGroup }) {
  const envLabel = group.brokerEnv === "demo" ? " Demo" : group.brokerEnv === "live" ? " Live" : "";
  const reconnectHref = group.brokerConnectionId
    ? `/accounts/connect/tradovate?env=${group.brokerEnv ?? "live"}&reconnect=${group.brokerConnectionId}`
    : "/accounts/connect/tradovate";
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-orange-200 bg-orange-50/80 px-4 py-3"
    >
      <div className="flex items-center gap-2.5">
        <span className="h-2 w-2 shrink-0 rounded-full bg-orange-500" aria-hidden />
        <p className="text-sm text-orange-900">
          <span className="font-semibold">Tradovate{envLabel} connection expired.</span>
          {" "}Sync and rule evaluation are paused for this connection.
        </p>
      </div>
      <Link
        href={reconnectHref}
        className="inline-flex items-center rounded-full bg-orange-900 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-orange-800"
      >
        Reconnect
      </Link>
    </div>
  );
}

// ─── Trading permission status block ──────────────────────────────────────────

const PERMISSION_COLORS: Record<
  TradingPermissionStatus["level"],
  { bg: string; dot: string; headlineCls: string; sublineCls: string }
> = {
  locked: {
    bg: "border-red-200 bg-red-50/80",
    dot: "bg-red-500",
    headlineCls: "text-red-900",
    sublineCls: "text-red-700",
  },
  warning: {
    bg: "border-amber-200 bg-amber-50/70",
    dot: "bg-amber-400",
    headlineCls: "text-amber-900",
    sublineCls: "text-amber-700",
  },
  test_mode: {
    bg: "border-sky-200 bg-sky-50/70",
    dot: "bg-sky-400",
    headlineCls: "text-sky-900",
    sublineCls: "text-sky-700",
  },
  allowed: {
    bg: "border-emerald-200 bg-emerald-50/60",
    dot: "bg-emerald-500",
    headlineCls: "text-emerald-900",
    sublineCls: "text-emerald-700",
  },
};

function TradingPermissionBlock({ status }: { status: TradingPermissionStatus }) {
  const colors = PERMISSION_COLORS[status.level];
  return (
    <div
      role={status.level === "locked" || status.level === "warning" ? "alert" : "status"}
      aria-label="Trading permission status"
      className={`flex items-start gap-3 rounded-2xl border px-4 py-3 ${colors.bg}`}
    >
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${colors.dot}`} aria-hidden />
      <div>
        <p className={`text-sm font-semibold ${colors.headlineCls}`}>{status.headline}</p>
        <p className={`mt-0.5 text-xs leading-5 ${colors.sublineCls}`}>{status.subline}</p>
      </div>
    </div>
  );
}

// ─── Protection status panel (replaces dry-run / consent / lock banners) ──────

const PANEL_BODY: Record<ProtectionStatusPanelData["kind"], string> = {
  dry_run:
    "Test mode active: Guardrail is monitoring only. It will not block, cancel, or close trades.",
  consent_required:
    "Action required · Confirm that Guardrail may lock this account or close positions when rules are breached.",
  protection_locked:
    "Protection locked for today · Rule changes apply at the next session.",
};

function ProtectionStatusPanel({
  panel,
  nextTradingDayKey: _nextTradingDayKey,
}: {
  panel: ProtectionStatusPanelData;
  nextTradingDayKey: string;
}) {
  const isAlert = panel.kind !== "dry_run";
  const colorClass =
    panel.kind === "dry_run"
      ? "border-sky-200/70 bg-sky-50/70 text-sky-800"
      : "border-amber-200/70 bg-amber-50/70 text-amber-900";
  const dotClass = panel.kind === "dry_run" ? "bg-sky-400" : "bg-amber-500";
  return (
    <div
      role={isAlert ? "alert" : "status"}
      aria-label="Protection status"
      className={`mb-3 flex flex-wrap items-start gap-2 rounded-lg border px-3 py-1.5 text-[11px] ${colorClass}`}
    >
      <span className={`mt-px h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} aria-hidden />
      <span className="flex-1">{PANEL_BODY[panel.kind]}</span>
      {panel.showConsentCta && (
        <Link
          href="/rules"
          className="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-amber-900 px-3 py-1 text-[10px] font-medium text-amber-50 transition hover:bg-amber-800"
        >
          Review Trading Plan
        </Link>
      )}
    </div>
  );
}

// ─── Section header (title + stale chip + Sync all + Firm filter) ─────────────

function SectionHeader({
  summary,
  accounts,
  firms,
  firmFilter,
  onFirmChange,
  typeFilter,
  onTypeChange,
}: {
  summary: CommandCenterData["summary"];
  accounts: CommandCenterAccount[];
  firms: { key: string; label: string }[];
  firmFilter: string;
  onFirmChange: (f: string) => void;
  typeFilter: string;
  onTypeChange: (t: string) => void;
}) {
  const hasBrokerAccounts = accounts.some((a) => a.platform !== "manual");
  const stale = deriveStaleSyncWarning({
    oldestSyncAt: summary.oldestSyncAt,
    hasBrokerAccounts,
    freshnessMs: CRON_SYNC_FRESHNESS_MS,
  });
  const freshnessLabel = hasBrokerAccounts ? formatFreshnessLabel(stale) : null;

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-stone-950">Accounts</h2>
        <span className="text-[11px] text-stone-500">
          {summary.totalActive} {summary.totalActive === 1 ? "account" : "accounts"}
        </span>
      </div>
      {freshnessLabel != null ? (
        stale.isStale ? (
          <span
            role="status"
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-200/70 bg-amber-50/60 px-2.5 py-1 text-[11px] text-amber-700"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
            {freshnessLabel}
          </span>
        ) : (
          <span role="status" className="text-[11px] text-stone-400">
            {freshnessLabel}
          </span>
        )
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/accounts/connect/tradovate"
          className="inline-flex h-8 items-center rounded-full bg-stone-950 px-4 text-xs font-medium text-stone-50 transition hover:bg-stone-800"
        >
          Add account
        </Link>
        {hasBrokerAccounts ? <SyncAllButton /> : null}
        {firms.length > 1 ? (
          <label className="flex items-center gap-1.5 text-xs text-stone-500">
            <span className="font-medium uppercase tracking-[0.14em]">Firm</span>
            <select
              value={firmFilter}
              onChange={(e) => onFirmChange(e.target.value)}
              className="max-w-full rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-300"
            >
              <option value="all">All firms</option>
              {firms.map((firm) => (
                <option key={firm.key} value={firm.key}>
                  {firm.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex items-center gap-1.5 text-xs text-stone-500">
          <span className="font-medium uppercase tracking-[0.14em]">Type</span>
          <select
            value={typeFilter}
            onChange={(e) => onTypeChange(e.target.value)}
            className="max-w-full rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-300"
          >
            {TYPE_FILTERS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

// ─── Filter bar (status chips only) ────────────────────────────────────────────

type FilterBarProps = {
  statusFilter: AccountStatus | "all";
  counts: Record<AccountStatus, number>;
  onStatusChange: (s: AccountStatus | "all") => void;
};

function FilterBar({ statusFilter, counts, onStatusChange }: FilterBarProps) {
  const totalActive = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div
      className="-mx-4 overflow-x-auto px-4 pb-0.5 sm:-mx-5 sm:px-5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      role="tablist"
      aria-label="Status filter"
    >
      <div className="flex min-w-max items-center gap-1.5">
        {STATUS_FILTERS.map((filter) => {
          const active = statusFilter === filter.value;
          const count =
            filter.value === "all" ? totalActive : counts[filter.value as AccountStatus];
          return (
            <button
              key={filter.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onStatusChange(filter.value)}
              className={`inline-flex h-9 flex-shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-4 text-xs font-medium transition md:h-8 md:px-3.5 ${
                active
                  ? "bg-stone-950 text-stone-50"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200 hover:text-stone-900"
              }`}
            >
              <span>{filter.label}</span>
              <span
                className={`min-w-[18px] rounded-md px-1 py-px text-center font-mono text-[10px] leading-4 ${
                  active ? "bg-stone-800 text-stone-300" : "bg-white/70 text-stone-400"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Connection status color ───────────────────────────────────────────────────

const CONN_STATUS_CLASS: Record<string, string> = {
  connected_live: "text-emerald-600",
  connected_readonly: "text-emerald-600",
  pending_webhook: "text-amber-600",
  oauth_pending_storage: "text-amber-600",
  expired: "text-red-600",
  not_connected: "text-red-500",
  connection_error: "text-red-600",
};

// ─── Firm section ──────────────────────────────────────────────────────────────

function FirmSection({
  group,
  isCollapsed,
  onToggleCollapsed,
}: {
  group: CommandCenterFirmGroup;
  isCollapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  // Default expanded (when not in the collapsed set) so risk-relevant detail
  // is visible without an extra click. State is lifted to CommandCenter and
  // persisted to localStorage; collapsing is purely UI preference and never
  // affects monitoring, sync, enforcement, or any totals.
  const expanded = !isCollapsed;
  const panelId = useId();
  const connClass = CONN_STATUS_CLASS[group.connectionStatus] ?? "text-stone-500";
  const showBrokerMeta = group.platform !== "manual";
  const isPersonalGroup = group.firmKey === PERSONAL_BROKER_FIRM_KEY;
  const groupStateSuffix = deriveGroupStateSuffix({
    accounts: group.accounts.map((a) => ({
      enforcementMode: a.enforcementMode,
      requiresAutomatedActionsConsent: a.requiresAutomatedActionsConsent,
    })),
  });
  const liveCount = isPersonalGroup
    ? group.accounts.filter((a) => a.accountType === "personal").length
    : undefined;
  const demoCount = isPersonalGroup
    ? group.accounts.filter((a) => a.accountType === "demo").length
    : undefined;

  const hasLocked = group.counts.locked > 0;
  const hasWarning = !hasLocked && group.counts.warning > 0;
  const articleBorder = hasLocked
    ? "border-red-200/70"
    : hasWarning
      ? "border-amber-200/70"
      : "border-stone-200";
  const buttonHover = hasLocked
    ? "hover:bg-red-50/30"
    : hasWarning
      ? "hover:bg-amber-50/30"
      : "hover:bg-stone-50";

  return (
    <article className={`rounded-xl border bg-stone-50/30 ${articleBorder}`}>
      <h3 className="m-0">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={expanded}
          aria-controls={panelId}
          className={`flex w-full flex-col gap-2 px-3 py-2.5 text-left transition sm:flex-row sm:items-start sm:justify-between sm:px-4 sm:py-3 ${buttonHover} ${expanded ? "border-b border-stone-100" : ""}`}
        >
          {/* Left: firm identity + broker meta */}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
              <span className="text-sm font-semibold text-stone-950">{group.firmLabel}</span>
              <FirmStatusInline
                accountCount={group.accounts.length}
                counts={group.counts}
                liveCount={liveCount}
                demoCount={demoCount}
              />
            </span>
            {showBrokerMeta && (
              <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] text-stone-400">
                {/* For personal groups the platform is already in the header label. */}
                {!isPersonalGroup && (
                  <>
                    <span>{group.platformLabel}</span>
                    <span aria-hidden>·</span>
                  </>
                )}
                <span className={connClass}>{group.connectionStatusLabel}</span>
                {groupStateSuffix && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="text-stone-500">{groupStateSuffix}</span>
                  </>
                )}
                {group.lastSyncAt && (
                  <>
                    <span aria-hidden>·</span>
                    <span>Synced {SYNC_DATE_FORMAT.format(group.lastSyncAt)}</span>
                  </>
                )}
              </span>
            )}
          </span>

          {/* Right: financials + +/− affordance */}
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-500 sm:shrink-0 sm:gap-x-4">
            <span>
              P&L:{" "}
              {group.hasPnlData ? (
                <span className={`font-mono font-semibold ${pnlClass(group.totalDailyPnl)}`}>
                  {formatSignedCurrency(group.totalDailyPnl)}
                </span>
              ) : (
                <span className="font-medium text-stone-400">—</span>
              )}
            </span>
            <span>
              Budget:{" "}
              {group.hasRiskData ? (
                <span className="font-mono font-semibold text-stone-800">
                  {CURRENCY_FORMATTER.format(group.totalRiskRemaining)}
                </span>
              ) : (
                <span className="font-medium text-stone-400">—</span>
              )}
            </span>
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-white text-[12px] leading-none text-stone-500"
              aria-hidden
            >
              {expanded ? "−" : "+"}
            </span>
          </span>
        </button>
      </h3>

      {expanded && (
        <div id={panelId}>
          {/* Desktop table */}
          <div className="hidden lg:block">
            <table className="w-full text-left text-sm">
              <thead className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">
                <tr className="border-b border-stone-100">
                  <th className="px-4 py-2 font-semibold">Account</th>
                  <th className="px-4 py-2 text-right font-semibold">Balance</th>
                  <th className="px-4 py-2 text-right font-semibold">Daily P&L</th>
                  <th className="px-4 py-2 text-right font-semibold">Loss budget left</th>
                  <th className="px-4 py-2 text-right font-semibold">Trades</th>
                  <th className="px-4 py-2 font-semibold">Rules / Mode</th>
                  <th className="px-4 py-2 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {group.accounts.map((account) => (
                  <AccountRow key={account.id} account={account} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile/tablet cards */}
          <div className="grid gap-2 p-2.5 lg:hidden sm:p-3">
            {group.accounts.map((account) => (
              <AccountCard key={account.id} account={account} />
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

function FirmStatusInline({
  accountCount,
  counts,
  liveCount,
  demoCount,
}: {
  accountCount: number;
  counts: Record<AccountStatus, number>;
  liveCount?: number;
  demoCount?: number;
}) {
  const tradable = counts.allowed ?? 0;
  const accountLabel = `${accountCount} account${accountCount === 1 ? "" : "s"}`;
  const showBreakdown =
    liveCount != null && demoCount != null && liveCount + demoCount > 1;
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 text-[11px] font-normal text-stone-500">
      <span aria-hidden>·</span>
      <span>{accountLabel}</span>
      {tradable > 0 && (
        <>
          <span aria-hidden>·</span>
          <span className="font-medium text-emerald-700">{tradable} tradable</span>
        </>
      )}
      {showBreakdown && liveCount! > 0 && (
        <>
          <span aria-hidden>·</span>
          <span>{liveCount} live</span>
        </>
      )}
      {showBreakdown && demoCount! > 0 && (
        <>
          <span aria-hidden>·</span>
          <span>{demoCount} demo</span>
        </>
      )}
    </span>
  );
}

// ─── Broker enforcement note ───────────────────────────────────────────────────

const BROKER_NOTE_COLOR: Record<string, string> = {
  broker_active: "text-emerald-700",
  unavailable_permission: "text-amber-700",
  failed: "text-amber-700",
  unavailable_readonly: "text-stone-400",
  internal_only: "text-stone-400",
};

function BrokerEnforcementNote({ account }: { account: CommandCenterAccount }) {
  if (account.status !== "locked") return null;
  const { text, kind } = deriveBrokerEnforcementCopy(account.brokerLockStatus);
  return (
    <p className={`mt-0.5 text-[10px] ${BROKER_NOTE_COLOR[kind] ?? "text-stone-400"}`}>
      {text}
    </p>
  );
}

// ─── Desktop row ───────────────────────────────────────────────────────────────

const SYNC_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function UnavailableRow({ account }: { account: CommandCenterAccount }) {
  return (
    <tr className="border-b border-stone-100 last:border-b-0 bg-amber-50/40 hover:bg-amber-50/60">
      <td colSpan={6} className="px-4 py-3 align-top">
        <div className="flex min-w-0 items-start gap-2">
          <StatusBadge status="unavailable" setupNeededReason={null} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-stone-950">{account.label}</p>
            <p className="mt-0.5 text-[11px] text-stone-500">
              {account.platformLabel}
              <span aria-hidden> · </span>
              {account.accountTypeLabel}
            </p>
            <p className="mt-1 text-xs font-medium text-amber-900">
              Account no longer active in {account.platformLabel}
            </p>
            <p className="mt-0.5 text-[11px] text-amber-800">
              This account may have been reset, closed, or removed by the prop firm.
              Stale balance, P&amp;L, and trade counts are excluded from totals.
            </p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-right align-top">
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <Link href="/settings" className={PILL_ROW_PRIMARY}>
            Manage connections
          </Link>
          <ArchiveAccountButton
            accountId={account.id}
            accountLabel={account.label}
            className={PILL_ROW_SECONDARY}
          />
        </div>
      </td>
    </tr>
  );
}

function AccountRow({ account }: { account: CommandCenterAccount }) {
  if (account.status === "unavailable") return <UnavailableRow account={account} />;
  const propFirmDescriptor = formatPropFirmDescriptor(account.propFirm, account.accountType);
  return (
    <tr className="border-b border-stone-100 last:border-b-0 hover:bg-white/60">
      {/* Account — status badge + name + platform + sync time */}
      <td className="px-4 py-3 align-top">
        <div className="flex min-w-0 items-start gap-2">
          <StatusBadge
            status={account.status}
            setupNeededReason={account.setupNeededReason}
            enforcementMode={account.enforcementMode}
            requiresAutomatedActionsConsent={account.requiresAutomatedActionsConsent}
          />
          <div className="min-w-0">
            <p className="min-w-[140px] text-sm font-semibold text-stone-950">{account.label}</p>
            <p className="mt-0.5 text-[11px] text-stone-500">
              {account.platformLabel}
              <span aria-hidden> · </span>
              {account.accountTypeLabel}
            </p>
            {account.breachReason && (
              <p className="mt-0.5 text-[10px] text-red-600">
                {account.breachReason.headline}
                {account.breachReason.detail && (
                  <span className="ml-1 text-stone-500">{account.breachReason.detail}</span>
                )}
              </p>
            )}
            <BrokerEnforcementNote account={account} />
            {account.setupNeededReason && (
              <p className="mt-0.5 text-[10px] text-stone-400">
                {SETUP_NEEDED_REASON_TEXT[account.setupNeededReason]}
              </p>
            )}
            {account.lastSyncAt && !account.breachReason && !account.setupNeededReason && (
              <p className="mt-0.5 text-[10px] text-stone-400">
                Synced {SYNC_DATE_FORMAT.format(account.lastSyncAt)}
              </p>
            )}
          </div>
        </div>
      </td>

      {/* Balance */}
      <td className="px-4 py-3 text-right align-top">
        {account.balance != null ? (
          <div>
            <p className="font-mono text-sm font-semibold text-stone-950">
              {BALANCE_FORMATTER.format(account.balance)}
            </p>
            {account.openPnl != null && account.openPnl !== 0 && (
              <p className={`font-mono text-[11px] ${account.openPnl > 0 ? "text-emerald-700" : "text-red-700"}`}>
                {account.openPnl > 0 ? "+" : ""}{account.openPnl.toFixed(2)} open
              </p>
            )}
          </div>
        ) : account.lastSyncAt != null ? (
          <p className="text-xs text-stone-400">Unavailable</p>
        ) : (
          <p className="text-xs text-stone-400">Awaiting sync</p>
        )}
      </td>

      {/* Daily P&L */}
      <td className="px-4 py-3 text-right align-top">
        {account.dailyPnl != null ? (
          <p className={`font-mono text-sm font-semibold ${pnlClass(account.dailyPnl)}`}>
            {formatSignedCurrency(account.dailyPnl)}
          </p>
        ) : account.lastSyncAt != null ? (
          <p className="text-xs text-stone-400">No trades today</p>
        ) : (
          <p className="font-mono text-sm text-stone-300">—</p>
        )}
      </td>

      {/* Loss budget left */}
      <td className="px-4 py-3 text-right align-top">
        <StopLeftCell account={account} />
      </td>

      {/* Trades */}
      <td className="px-4 py-3 text-right align-top">
        <TradesCell account={account} />
      </td>

      {/* Rules + Mode combined */}
      <td className="px-4 py-3 align-top">
        <p className="text-xs text-stone-600">{account.rulesLabel}</p>
        {propFirmDescriptor && (
          <p className="mt-0.5 text-[10px] text-stone-400">{propFirmDescriptor}</p>
        )}
        {account.enforcementMode !== "dry_run" && <PerAccountStateLine account={account} />}
        {account.consecutiveLosses != null && account.consecutiveLosses > 0 && (
          <p className="mt-1 text-[10px] text-amber-700">
            Loss streak {account.consecutiveLosses}
            {account.stopAfterLosses != null ? ` / ${account.stopAfterLosses}` : ""}
          </p>
        )}
      </td>

      {/* Actions */}
      <td className="px-4 py-3 text-right align-top">
        <AccountActions account={account} />
      </td>
    </tr>
  );
}

// ─── Mobile card ───────────────────────────────────────────────────────────────

function AccountCard({ account }: { account: CommandCenterAccount }) {
  const propFirmDescriptor = formatPropFirmDescriptor(account.propFirm, account.accountType);
  const reconnectNeeded =
    account.platform !== "manual" &&
    (account.status === "not_connected" ||
      account.connectionStatus === "expired" ||
      account.connectionStatus === "connection_error");

  if (account.status === "unavailable") {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-3 shadow-[0_2px_8px_-4px_rgba(28,25,23,0.06)]">
        <div className="flex min-w-0 items-center gap-2">
          <StatusBadge status="unavailable" setupNeededReason={null} />
          <p className="min-w-0 truncate text-sm font-semibold text-stone-950">{account.label}</p>
        </div>
        <p className="mt-0.5 text-[11px] text-stone-500">
          {account.platformLabel}
          <span aria-hidden> · </span>
          {account.accountTypeLabel}
        </p>
        <p className="mt-2 text-xs font-medium text-amber-900">
          Account no longer active in {account.platformLabel}
        </p>
        <p className="mt-0.5 text-[11px] text-amber-800">
          May have been reset, closed, or removed by the prop firm. Excluded from totals.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/settings" className={PILL_CARD_PRIMARY}>
            Manage connections
          </Link>
          <ArchiveAccountButton
            accountId={account.id}
            accountLabel={account.label}
            className={PILL_CARD_SECONDARY}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-stone-200 bg-white px-3 py-3 shadow-[0_2px_8px_-4px_rgba(28,25,23,0.06)]">
      {/* Header: status + name + platform/type */}
      <div className="flex min-w-0 items-center gap-2">
        <StatusBadge
            status={account.status}
            setupNeededReason={account.setupNeededReason}
            enforcementMode={account.enforcementMode}
            requiresAutomatedActionsConsent={account.requiresAutomatedActionsConsent}
          />
        <p className="min-w-0 truncate text-sm font-semibold text-stone-950">{account.label}</p>
      </div>
      <p className="mt-0.5 text-[11px] text-stone-500">
        {account.platformLabel}
        <span aria-hidden> · </span>
        {account.accountTypeLabel}
      </p>
      {account.breachReason && (
        <p className="mt-0.5 text-[10px] text-red-600">
          {account.breachReason.headline}
          {account.breachReason.detail && (
            <span className="ml-1 text-stone-500">{account.breachReason.detail}</span>
          )}
        </p>
      )}
      <BrokerEnforcementNote account={account} />

      {/* 2×2 labeled metrics grid */}
      <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-stone-100 pt-2.5">
        {/* Balance */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">
            Balance
          </p>
          {account.balance != null ? (
            <p className="font-mono text-sm font-semibold text-stone-950">
              {BALANCE_FORMATTER.format(account.balance)}
            </p>
          ) : account.lastSyncAt != null ? (
            <p className="text-[11px] text-stone-400">Unavailable</p>
          ) : (
            <p className="text-[11px] text-stone-400">Awaiting sync</p>
          )}
          {account.balance != null && account.openPnl != null && account.openPnl !== 0 && (
            <p className={`font-mono text-[11px] ${account.openPnl > 0 ? "text-emerald-700" : "text-red-700"}`}>
              {account.openPnl > 0 ? "+" : ""}
              {account.openPnl.toFixed(2)} open
            </p>
          )}
        </div>

        {/* Daily P&L */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">
            Daily P&L
          </p>
          {account.dailyPnl != null ? (
            <p className={`font-mono text-sm font-semibold ${pnlClass(account.dailyPnl)}`}>
              {formatSignedCurrency(account.dailyPnl)}
            </p>
          ) : account.lastSyncAt != null ? (
            <p className="text-[11px] text-stone-400">No trades today</p>
          ) : (
            <p className="font-mono text-sm text-stone-300">—</p>
          )}
        </div>

        {/* Loss budget left */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">
            Loss budget left
          </p>
          <StopLeftCell account={account} compact />
        </div>

        {/* Trades */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">
            Trades
          </p>
          <TradesCell account={account} compact />
        </div>
      </div>

      {/* Footer: meta + actions */}
      <div className="mt-2.5 border-t border-stone-100 pt-2.5">
        {/* Muted metadata row */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-stone-400">
          <span>{account.rulesLabel}</span>
          {propFirmDescriptor && (
            <>
              <span aria-hidden>·</span>
              <span>{propFirmDescriptor}</span>
            </>
          )}
          {account.enforcementMode !== "dry_run" && (
            <>
              <span aria-hidden>·</span>
              <span>
                {derivePerAccountStateLabel({
                  enforcementMode: account.enforcementMode,
                  requiresAutomatedActionsConsent: account.requiresAutomatedActionsConsent,
                })}
              </span>
            </>
          )}
          {account.consecutiveLosses != null && account.consecutiveLosses > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="text-amber-600">
                Streak {account.consecutiveLosses}
                {account.stopAfterLosses != null ? `/${account.stopAfterLosses}` : ""}
              </span>
            </>
          )}
        </div>

        {/* Action buttons row: Open, Rules, and optionally Reconnect */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Link
            href={deriveOpenHref(account.id)}
            className="inline-flex h-9 min-w-[80px] items-center justify-center whitespace-nowrap rounded-full border border-stone-200 px-4 text-xs font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 hover:text-stone-950"
          >
            Details
          </Link>
          <Link
            href={deriveRulesHref(account.id)}
            className="inline-flex h-9 min-w-[80px] items-center justify-center whitespace-nowrap rounded-full border border-stone-200 px-4 text-xs font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 hover:text-stone-950"
          >
            Rules
          </Link>
          {reconnectNeeded && (
            <Link
              href="/accounts/connect/tradovate"
              className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-full bg-stone-900 px-4 text-xs font-medium text-stone-50 transition hover:bg-stone-700"
            >
              Reconnect
            </Link>
          )}
        </div>

        {/* Sync status row */}
        {account.platform === "tradovate" && !reconnectNeeded && (
          <div className="mt-2">
            <SyncButton accountId={account.id} lastSyncAt={account.lastSyncAt} variant="compact" />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Cell helpers ──────────────────────────────────────────────────────────────

function StopLeftCell({
  account,
  compact = false,
}: {
  account: CommandCenterAccount;
  compact?: boolean;
}) {
  if (account.propFirmSetupNeeded) {
    return (
      <div>
        <p className="text-xs font-medium text-amber-700">Firm rules missing</p>
        <p className="text-[10px] text-stone-400">Enter prop firm limits</p>
      </div>
    );
  }
  if (account.balanceUnavailableForBudget) {
    return <p className="text-xs text-stone-400">Awaiting balance sync</p>;
  }
  if (account.maxDailyLoss == null && !account.propFirmLimited) {
    return <p className="font-mono text-sm text-stone-400">—</p>;
  }
  const remaining = account.remainingDailyLoss ?? account.maxDailyLoss ?? 0;
  const pct = account.dailyLossUsedPct ?? 0;
  return (
    <div className={compact ? "" : "flex flex-col items-end gap-1"}>
      <p className="font-mono text-sm font-semibold text-stone-900">
        {CURRENCY_FORMATTER.format(remaining)}
      </p>
      {account.balanceLimitedWarning && (
        <p className="text-[10px] text-amber-700">Capped by balance</p>
      )}
      {account.propFirmLimited && !account.balanceLimitedWarning && (
        <p className="text-[10px] text-amber-700">Prop firm limit</p>
      )}
      <div
        className={`mt-1 h-1 w-full overflow-hidden rounded-full bg-stone-100 ${compact ? "" : "max-w-[110px]"}`}
        aria-hidden
      >
        <div
          className={`h-full ${progressBarClass(pct)}`}
          style={{ width: `${Math.round(pct * 100)}%` }}
        />
      </div>
    </div>
  );
}

function TradesCell({
  account,
  compact = false,
}: {
  account: CommandCenterAccount;
  compact?: boolean;
}) {
  const display = getTradeCountDisplay(account);
  const wrapperClass = compact ? "" : "flex flex-col items-end gap-1";
  const hintClass = `text-[10px] text-stone-400 ${compact ? "mt-0.5" : "mt-1 text-right"}`;

  if (display.kind === "no_data") {
    return <p className={`font-mono text-sm text-stone-400`}>—</p>;
  }

  if (display.kind === "unavailable") {
    return (
      <div className={wrapperClass}>
        <p className="text-xs text-stone-400">Unavailable</p>
        {display.showHint && (
          <p className={hintClass}>Trade count unavailable from broker report.</p>
        )}
      </div>
    );
  }

  if (display.kind === "estimated") {
    // Deliberately no numeric "X / max" and no progress bar — the count cannot
    // be attributed to this specific account, so showing it as a ratio is
    // misleading and would imply a breach when the source is unreliable.
    // Visible row copy stays short; the full explanation is in the tooltip
    // (title attr) so screen-readers and hover users can still reach it.
    return (
      <div className={wrapperClass} title={ESTIMATED_TRADE_COUNT_HINT}>
        <p className="font-mono text-sm font-semibold text-stone-500">Estimated</p>
        <p className={hintClass}>{ESTIMATED_TRADE_COUNT_SHORT}</p>
      </div>
    );
  }

  // Verified path: show "X / max" with the usual progress bar.
  const { used, max, pct } = display;
  return (
    <div className={wrapperClass}>
      <p className="font-mono text-sm font-semibold text-stone-900">
        {used}
        {max != null ? <span className="text-stone-400"> / {max}</span> : null}
      </p>
      {max != null ? (
        <div
          className={`mt-1 h-1 w-full overflow-hidden rounded-full bg-stone-100 ${compact ? "" : "max-w-[80px]"}`}
          aria-hidden
        >
          <div
            className={`h-full ${progressBarClass(pct)}`}
            style={{ width: `${Math.round(pct * 100)}%` }}
          />
        </div>
      ) : null}
      {account.tradesMayIncludePreConnection && (
        <p
          className={hintClass}
          title="Trade count includes broker activity from today before Guardrail was connected to this account."
        >
          Includes pre-connection activity
        </p>
      )}
    </div>
  );
}

function StatusBadge({
  status,
  setupNeededReason,
  enforcementMode,
  requiresAutomatedActionsConsent,
}: {
  status: AccountStatus;
  setupNeededReason?: "no_rules" | "pending_connection" | "prop_firm_rules_missing" | null;
  /** Optional — only the AccountRow / AccountCard pass these. The "unavailable"
   *  fallback usages omit them because the label is already deterministic. */
  enforcementMode?: EnforcementMode;
  requiresAutomatedActionsConsent?: boolean;
}) {
  const label = deriveRowStatusLabel({
    status,
    setupNeededReason: setupNeededReason ?? null,
    enforcementMode: enforcementMode ?? "not_connected",
    requiresAutomatedActionsConsent: requiresAutomatedActionsConsent ?? false,
  });
  // "Action required" is a refinement of "allowed" status — paint it amber
  // to draw attention away from the default emerald "tradable" treatment.
  const isActionRequired = label === "Action required";
  const badgeClass = isActionRequired
    ? "bg-amber-50 text-amber-800 ring-1 ring-amber-200"
    : STATUS_BADGE_CLASS[status];
  const dotClass = isActionRequired ? "bg-amber-500" : STATUS_DOT_CLASS[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${badgeClass}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden />
      {label}
    </span>
  );
}

function PerAccountStateLine({ account }: { account: CommandCenterAccount }) {
  const label = derivePerAccountStateLabel({
    enforcementMode: account.enforcementMode,
    requiresAutomatedActionsConsent: account.requiresAutomatedActionsConsent,
  });
  // Tone tracks the actionability of the state. The label itself carries the
  // detail; the colour just lets the user spot capability gaps at a glance.
  const tone =
    label === "Consent required"
      ? "text-amber-700"
      : label === "Limited permissions"
        ? "text-amber-700"
        : label === "Broker risk settings enabled"
          ? "text-emerald-700"
          : "text-stone-500";
  return <p className={`mt-0.5 text-[10px] ${tone}`}>{label}</p>;
}

// ─── Actions ───────────────────────────────────────────────────────────────────

function AccountActions({ account }: { account: CommandCenterAccount }) {
  const reconnectNeeded =
    account.platform !== "manual" &&
    (account.status === "not_connected" ||
      account.connectionStatus === "expired" ||
      account.connectionStatus === "connection_error");

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Link href={deriveOpenHref(account.id)} className={PILL_ROW_SECONDARY}>
        Details
      </Link>
      <Link href={deriveRulesHref(account.id)} className={PILL_ROW_SECONDARY}>
        Rules
      </Link>
      {reconnectNeeded ? (
        <Link href="/accounts/connect/tradovate" className={PILL_ROW_PRIMARY}>
          Reconnect
        </Link>
      ) : account.platform === "tradovate" ? (
        <SyncButton accountId={account.id} lastSyncAt={account.lastSyncAt} />
      ) : null}
    </div>
  );
}

// ─── Empty states ──────────────────────────────────────────────────────────────

function EmptyAccounts() {
  return (
    <section className="rounded-2xl border border-dashed border-stone-300 bg-white/80 p-6 text-center">
      <p className="text-sm font-semibold text-stone-950">No accounts yet</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-stone-500">
        Connect Tradovate to monitor live broker activity and activate rule enforcement.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/accounts/connect/tradovate"
          className="inline-flex items-center justify-center whitespace-nowrap rounded-full bg-stone-950 px-4 py-2 text-xs font-medium text-stone-50 transition hover:bg-stone-800"
        >
          Connect Tradovate
        </Link>
        <Link
          href="/settings"
          className="inline-flex items-center justify-center whitespace-nowrap rounded-full border border-stone-300 px-4 py-2 text-xs font-medium text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
        >
          Manage connections
        </Link>
      </div>
    </section>
  );
}

function EmptyFilterMatch() {
  return (
    <div className="rounded-xl border border-dashed border-stone-200 bg-white/60 px-4 py-6 text-center">
      <p className="text-sm text-stone-600">No accounts match the current filters.</p>
    </div>
  );
}
