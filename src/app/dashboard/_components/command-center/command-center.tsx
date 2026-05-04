"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { SyncButton } from "@/app/accounts/_components/sync-button";
import { NewAccountsPanel } from "./new-accounts-panel";
import type { EnforcementTrigger } from "@/lib/brokers/enforcement";
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

const STATUS_FILTERS: { value: AccountStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "allowed", label: "Allowed" },
  { value: "warning", label: "Warning" },
  { value: "locked", label: "Locked" },
  { value: "setup_needed", label: "Setup needed" },
  { value: "not_connected", label: "Not connected" },
];

const STATUS_LABEL: Record<AccountStatus, string> = {
  allowed: "Allowed",
  warning: "Warning",
  locked: "Locked",
  setup_needed: "Setup needed",
  not_connected: "Not connected",
};

const SETUP_NEEDED_LABEL: Record<
  "no_rules" | "pending_connection" | "prop_firm_rules_missing",
  string
> = {
  no_rules: "Needs rules",
  pending_connection: "Pending connection",
  prop_firm_rules_missing: "Firm rules missing",
};

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
};

const STATUS_DOT_CLASS: Record<AccountStatus, string> = {
  allowed: "bg-emerald-500",
  warning: "bg-amber-400",
  locked: "bg-red-500",
  setup_needed: "bg-stone-400",
  not_connected: "bg-stone-300",
};

const ENFORCEMENT_LABEL: Record<EnforcementMode, string> = {
  manual_app_level: "Manual / App-level",
  broker_readonly: "Monitoring only",
  not_connected: "Not connected",
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

  const filteredGroups = useMemo<CommandCenterFirmGroup[]>(() => {
    return data.groups
      .filter((group) => firmFilter === "all" || group.firmKey === firmFilter)
      .map((group) => ({
        ...group,
        accounts:
          statusFilter === "all"
            ? group.accounts
            : group.accounts.filter((a) => a.status === statusFilter),
      }))
      .filter((group) => group.accounts.length > 0);
  }, [data.groups, statusFilter, firmFilter]);

  if (data.accounts.length === 0 && data.pendingAccounts.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-4">
      {data.pendingAccounts.length > 0 && (
        <NewAccountsPanel
          accounts={data.pendingAccounts}
          isLocked={data.protectionLock.isLocked}
        />
      )}
      {data.accounts.length > 0 && (
        <section
          aria-label="Risk command center"
          className="overflow-x-hidden rounded-2xl border border-stone-200 bg-white/95 p-4 shadow-[0_4px_20px_-8px_rgba(28,25,23,0.08)] sm:p-5"
        >
          {data.protectionLock.isLocked && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200/70 bg-amber-50/60 px-3 py-1.5 text-[11px] text-amber-700">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
              <span>Protection locked for today · Rule changes apply from {data.protectionLock.nextTradingDayKey}.</span>
            </div>
          )}
          <FilterBar
            statusFilter={statusFilter}
            firmFilter={firmFilter}
            firms={data.firms}
            counts={data.summary.counts}
            onStatusChange={setStatusFilter}
            onFirmChange={setFirmFilter}
          />

          <div className="mt-5 grid gap-5">
            {filteredGroups.length === 0 ? (
              <EmptyFilterMatch />
            ) : (
              filteredGroups.map((group) => <FirmSection key={group.firmKey} group={group} />)
            )}
          </div>

          <div className="mt-5 border-t border-stone-100 pt-3 text-[11px] text-stone-400">
            Monitoring only · Alerts and rule checks active · Broker blocking not active.
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Filter bar ────────────────────────────────────────────────────────────────

type FilterBarProps = {
  statusFilter: AccountStatus | "all";
  firmFilter: string;
  firms: { key: string; label: string }[];
  counts: Record<AccountStatus, number>;
  onStatusChange: (s: AccountStatus | "all") => void;
  onFirmChange: (f: string) => void;
};

function FilterBar({
  statusFilter,
  firmFilter,
  firms,
  counts,
  onStatusChange,
  onFirmChange,
}: FilterBarProps) {
  const totalActive = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      {/* Scrollable chip row — no wrapping, hidden scrollbar, full bleed on mobile */}
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

      {firms.length > 1 ? (
        <label className="flex items-center gap-2 text-xs text-stone-500">
          <span className="font-medium uppercase tracking-[0.14em]">Firm</span>
          <select
            value={firmFilter}
            onChange={(e) => onFirmChange(e.target.value)}
            className="rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-300"
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

function FirmSection({ group }: { group: CommandCenterFirmGroup }) {
  const connClass = CONN_STATUS_CLASS[group.connectionStatus] ?? "text-stone-500";
  const showBrokerMeta = group.platform !== "manual";

  return (
    <article className="rounded-xl border border-stone-200 bg-stone-50/30">
      <header className="border-b border-stone-100 px-3 py-2.5 sm:px-4 sm:py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          {/* Left: firm identity + broker meta */}
          <div>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-sm font-semibold text-stone-950">{group.firmLabel}</h3>
              <span className="text-[11px] text-stone-500">
                {group.accounts.length} account{group.accounts.length === 1 ? "" : "s"}
              </span>
              <FirmStatusInline counts={group.counts} />
            </div>
            {showBrokerMeta && (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] text-stone-400">
                <span>{group.platformLabel}</span>
                <span aria-hidden>·</span>
                <span className={connClass}>{group.connectionStatusLabel}</span>
                {group.lastSyncAt && (
                  <>
                    <span aria-hidden>·</span>
                    <span>Synced {SYNC_DATE_FORMAT.format(group.lastSyncAt)}</span>
                  </>
                )}
              </p>
            )}
          </div>

          {/* Right: financials + enforcement mode */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-stone-500 sm:shrink-0 sm:gap-x-4">
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
            <EnforcementChip mode={group.enforcementMode} />
          </div>
        </div>
      </header>

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
    </article>
  );
}

function FirmStatusInline({ counts }: { counts: Record<AccountStatus, number> }) {
  const items: { status: AccountStatus; count: number }[] = (
    Object.entries(counts) as [AccountStatus, number][]
  )
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({ status, count }));

  if (items.length === 0) return null;
  return (
    <div className="flex items-center gap-2 text-[10px] text-stone-500">
      {items.map(({ status, count }) => (
        <span key={status} className="inline-flex items-center gap-1">
          <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASS[status]}`} aria-hidden />
          <span>{count}</span>
        </span>
      ))}
    </div>
  );
}

// ─── Broker enforcement note ───────────────────────────────────────────────────

const RULE_NOTE_BY_TRIGGER: Record<EnforcementTrigger, string> = {
  daily_loss_limit: "Broker blocking is not active for this rule yet.",
  trade_limit: "Broker blocking is not active for trade-limit rules yet.",
  consecutive_losses: "Broker blocking is not active for loss-streak rules yet.",
  manual: "Broker blocking is not active for this rule yet.",
};

function BrokerEnforcementNote({ account }: { account: CommandCenterAccount }) {
  if (account.status !== "locked") return null;

  if (account.brokerLockStatus === "broker_locked") {
    return (
      <p className="mt-0.5 text-[10px] text-emerald-700">
        Broker-enforced lock · Tradovate risk settings active.
      </p>
    );
  }

  if (account.brokerLockStatus === "broker_lock_failed") {
    return (
      <p className="mt-0.5 text-[10px] text-amber-700">
        Broker blocking failed · Guardrail is monitoring only.
      </p>
    );
  }

  const trigger = account.lastInterventionTrigger;
  const ruleNote = trigger
    ? RULE_NOTE_BY_TRIGGER[trigger]
    : "Broker blocking is not active for this rule yet.";

  return (
    <p className="mt-0.5 text-[10px] text-stone-400">
      Guardrail locked this account internally. {ruleNote}
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

function AccountRow({ account }: { account: CommandCenterAccount }) {
  return (
    <tr className="border-b border-stone-100 last:border-b-0 hover:bg-white/60">
      {/* Account — status badge + name + platform + sync time */}
      <td className="px-4 py-3 align-top">
        <div className="flex min-w-0 items-start gap-2">
          <StatusBadge status={account.status} setupNeededReason={account.setupNeededReason} />
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
        <p className="text-xs text-stone-600">{RULE_SOURCE_LABEL[account.ruleSource]}</p>
        <div className="mt-1">
          <EnforcementChip mode={account.enforcementMode} />
        </div>
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
  const reconnectNeeded =
    account.platform !== "manual" &&
    (account.status === "not_connected" ||
      account.connectionStatus === "expired" ||
      account.connectionStatus === "connection_error");

  return (
    <div className="rounded-xl border border-stone-200 bg-white px-3 py-3 shadow-[0_2px_8px_-4px_rgba(28,25,23,0.06)]">
      {/* Header: status + name + platform/type */}
      <div className="flex min-w-0 items-center gap-2">
        <StatusBadge status={account.status} setupNeededReason={account.setupNeededReason} />
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
          <span>{RULE_SOURCE_LABEL[account.ruleSource]}</span>
          <span aria-hidden>·</span>
          <EnforcementChip mode={account.enforcementMode} />
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

        {/* Primary nav buttons — fixed height + min-width so Open and Rules are identical */}
        <div className="mt-2.5 flex items-center gap-2">
          <Link
            href={`/accounts/${account.id}/edit`}
            className="inline-flex h-10 min-w-[96px] items-center justify-center rounded-xl border border-stone-200 px-4 text-xs font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 hover:text-stone-950"
          >
            Open
          </Link>
          <Link
            href={account.ruleSource === "account" ? `/accounts/${account.id}/edit` : "/rules"}
            className="inline-flex h-10 min-w-[96px] items-center justify-center rounded-xl border border-stone-200 px-4 text-xs font-medium text-stone-700 transition hover:border-stone-300 hover:bg-stone-50 hover:text-stone-950"
          >
            Rules
          </Link>
          {reconnectNeeded && (
            <Link
              href="/accounts/connect/tradovate"
              className="ml-auto inline-flex h-10 items-center justify-center rounded-xl bg-stone-900 px-4 text-xs font-medium text-stone-50 transition hover:bg-stone-700"
            >
              Reconnect
            </Link>
          )}
        </div>

        {/* Refresh icon-button + sync time on same row */}
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
  // Broker account synced but fills never successfully fetched — count is unknown.
  if (
    account.platform !== "manual" &&
    account.fillsSyncedAt == null &&
    account.lastSyncAt != null
  ) {
    return <p className="text-xs text-stone-400">Unavailable</p>;
  }
  const used = account.tradesCount ?? 0;
  if (account.maxTradesPerDay == null && account.tradesCount == null) {
    return (
      <p className={`font-mono ${compact ? "text-sm" : "text-sm"} text-stone-400`}>—</p>
    );
  }
  const max = account.maxTradesPerDay;
  const pct = account.tradesUsedPct ?? 0;
  return (
    <div className={compact ? "" : "flex flex-col items-end gap-1"}>
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
    </div>
  );
}

function StatusBadge({
  status,
  setupNeededReason,
}: {
  status: AccountStatus;
  setupNeededReason?: "no_rules" | "pending_connection" | "prop_firm_rules_missing" | null;
}) {
  const label =
    status === "setup_needed" && setupNeededReason
      ? SETUP_NEEDED_LABEL[setupNeededReason]
      : STATUS_LABEL[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${STATUS_BADGE_CLASS[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASS[status]}`} aria-hidden />
      {label}
    </span>
  );
}

function EnforcementChip({ mode }: { mode: EnforcementMode }) {
  const tone =
    mode === "manual_app_level"
      ? "bg-emerald-50 text-emerald-700"
      : mode === "broker_readonly"
        ? "bg-sky-50 text-sky-700"
        : "bg-stone-100 text-stone-500";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${tone}`}
    >
      {ENFORCEMENT_LABEL[mode]}
    </span>
  );
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
      <Link
        href={`/accounts/${account.id}/edit`}
        className="rounded-full border border-stone-200 px-2.5 py-1 text-[11px] font-medium text-stone-700 transition hover:border-stone-400 hover:text-stone-950"
      >
        Open
      </Link>
      <Link
        href={account.ruleSource === "account" ? `/accounts/${account.id}/edit` : "/rules"}
        className="rounded-full border border-stone-200 px-2.5 py-1 text-[11px] font-medium text-stone-700 transition hover:border-stone-400 hover:text-stone-950"
      >
        Rules
      </Link>
      {reconnectNeeded ? (
        <Link
          href="/accounts/connect/tradovate"
          className="rounded-full bg-stone-950 px-2.5 py-1 text-[11px] font-medium text-stone-50 transition hover:bg-stone-800"
        >
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
        Add a manual account to journal trades or connect Tradovate to track a live broker account.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/accounts/new"
          className="rounded-full bg-stone-950 px-4 py-2 text-xs font-medium text-stone-50 transition hover:bg-stone-800"
        >
          Add account
        </Link>
        <Link
          href="/accounts/connect/tradovate"
          className="rounded-full border border-stone-300 px-4 py-2 text-xs font-medium text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
        >
          Connect Tradovate
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
