"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { SyncButton } from "@/app/accounts/_components/sync-button";
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
  broker_readonly: "Read-only connected",
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

  if (data.accounts.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Risk command center"
      className="rounded-2xl border border-stone-200 bg-white/95 p-4 shadow-[0_4px_20px_-8px_rgba(28,25,23,0.08)] sm:p-5"
    >
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

      <p className="mt-5 border-t border-stone-100 pt-3 text-[11px] leading-5 text-stone-500">
        Tradovate connections are read-only for account data. Broker-side enforcement (cancel,
        flatten, lockout) is not active and requires separate verification before it can be enabled.
      </p>
    </section>
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
      <div
        role="tablist"
        aria-label="Status filter"
        className="-mx-1 flex flex-wrap gap-1 overflow-x-auto px-1 pb-1"
      >
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
              className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition ${
                active
                  ? "bg-stone-950 text-stone-50"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200 hover:text-stone-900"
              }`}
            >
              <span>{filter.label}</span>
              <span
                className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] ${
                  active ? "bg-stone-800 text-stone-100" : "bg-white/80 text-stone-500"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {firms.length > 1 ? (
        <label className="flex items-center gap-2 text-xs text-stone-500">
          <span className="font-medium uppercase tracking-[0.14em]">Firm</span>
          <select
            value={firmFilter}
            onChange={(e) => onFirmChange(e.target.value)}
            className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-800 focus:outline-none focus:ring-2 focus:ring-stone-300"
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

// ─── Firm section ──────────────────────────────────────────────────────────────

function FirmSection({ group }: { group: CommandCenterFirmGroup }) {
  return (
    <article className="rounded-xl border border-stone-200 bg-stone-50/30">
      <header className="flex flex-col gap-2 border-b border-stone-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-sm font-semibold text-stone-950">{group.firmLabel}</h3>
          <span className="text-[11px] text-stone-500">
            {group.accounts.length} account{group.accounts.length === 1 ? "" : "s"}
          </span>
          <FirmStatusInline counts={group.counts} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-stone-500">
          <span>
            Daily P&L:{" "}
            {group.hasPnlData ? (
              <span className={`font-mono font-semibold ${pnlClass(group.totalDailyPnl)}`}>
                {formatSignedCurrency(group.totalDailyPnl)}
              </span>
            ) : (
              <span className="font-medium text-stone-400">Awaiting first sync</span>
            )}
          </span>
          <span>
            Risk left:{" "}
            {group.hasRiskData ? (
              <span className="font-mono font-semibold text-stone-800">
                {CURRENCY_FORMATTER.format(group.totalRiskRemaining)}
              </span>
            ) : (
              <span className="font-medium text-stone-400">Set rules to track</span>
            )}
          </span>
        </div>
      </header>

      {/* Desktop table */}
      <div className="hidden lg:block">
        <table className="w-full text-left text-sm">
          <thead className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">
            <tr className="border-b border-stone-100">
              <th className="px-4 py-2 font-semibold">Status</th>
              <th className="px-4 py-2 font-semibold">Account</th>
              <th className="px-4 py-2 text-right font-semibold">Balance</th>
              <th className="px-4 py-2 text-right font-semibold">Daily P&L</th>
              <th className="px-4 py-2 text-right font-semibold">Stop left</th>
              <th className="px-4 py-2 text-right font-semibold">Trades</th>
              <th className="px-4 py-2 font-semibold">Rules</th>
              <th className="px-4 py-2 font-semibold">Mode</th>
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
      <div className="grid gap-2 p-3 lg:hidden">
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

// ─── Desktop row ───────────────────────────────────────────────────────────────

function AccountRow({ account }: { account: CommandCenterAccount }) {
  return (
    <tr className="border-b border-stone-100 last:border-b-0 hover:bg-white/80">
      <td className="px-4 py-3 align-top">
        <StatusBadge status={account.status} />
      </td>
      <td className="px-4 py-3 align-top">
        <p className="text-sm font-semibold text-stone-950">{account.label}</p>
        <p className="mt-0.5 text-[11px] text-stone-500">
          {account.platformLabel}
          <span aria-hidden> · </span>
          {account.accountTypeLabel}
        </p>
        {account.lastSyncAt && (
          <p className="mt-0.5 text-[10px] text-stone-400">
            Synced {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(account.lastSyncAt)}
          </p>
        )}
      </td>
      <td className="px-4 py-3 text-right align-top">
        {account.balance != null ? (
          <div>
            <p className="font-mono text-sm font-semibold text-stone-950">
              {CURRENCY_FORMATTER.format(account.balance)}
            </p>
            {account.openPnl != null && account.openPnl !== 0 && (
              <p className={`text-[11px] font-mono ${account.openPnl > 0 ? "text-emerald-700" : "text-red-700"}`}>
                {account.openPnl > 0 ? "+" : ""}{account.openPnl.toFixed(2)} open
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-stone-400">—</p>
        )}
      </td>
      <td className="px-4 py-3 text-right align-top">
        <p className={`font-mono text-sm font-semibold ${pnlClass(account.dailyPnl)}`}>
          {account.dailyPnl != null ? formatSignedCurrency(account.dailyPnl) : "—"}
        </p>
      </td>
      <td className="px-4 py-3 text-right align-top">
        <StopLeftCell account={account} />
      </td>
      <td className="px-4 py-3 text-right align-top">
        <TradesCell account={account} />
      </td>
      <td className="px-4 py-3 align-top text-xs text-stone-600">
        {RULE_SOURCE_LABEL[account.ruleSource]}
        {account.consecutiveLosses != null && account.consecutiveLosses > 0 ? (
          <p className="mt-0.5 text-[10px] text-amber-700">
            Loss streak {account.consecutiveLosses}
            {account.stopAfterLosses != null ? ` / ${account.stopAfterLosses}` : ""}
          </p>
        ) : null}
      </td>
      <td className="px-4 py-3 align-top">
        <EnforcementChip mode={account.enforcementMode} />
      </td>
      <td className="px-4 py-3 text-right align-top">
        <AccountActions account={account} />
      </td>
    </tr>
  );
}

// ─── Mobile card ───────────────────────────────────────────────────────────────

function AccountCard({ account }: { account: CommandCenterAccount }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white px-3 py-3 shadow-[0_2px_8px_-4px_rgba(28,25,23,0.06)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusBadge status={account.status} />
            <p className="truncate text-sm font-semibold text-stone-950">{account.label}</p>
          </div>
          <p className="mt-1 text-[11px] text-stone-500">
            {account.platformLabel}
            <span aria-hidden> · </span>
            {account.accountTypeLabel}
          </p>
        </div>
        <p className={`shrink-0 font-mono text-sm font-semibold ${pnlClass(account.dailyPnl)}`}>
          {account.dailyPnl != null ? formatSignedCurrency(account.dailyPnl) : "—"}
        </p>
      </div>

      {account.balance != null && (
        <p className="mt-1 font-mono text-sm font-semibold text-stone-950">
          {CURRENCY_FORMATTER.format(account.balance)}
          {account.openPnl != null && account.openPnl !== 0 && (
            <span className={`ml-1.5 text-[11px] font-normal ${account.openPnl > 0 ? "text-emerald-700" : "text-red-700"}`}>
              {account.openPnl > 0 ? "+" : ""}{account.openPnl.toFixed(2)} open
            </span>
          )}
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">
            Stop left
          </p>
          <StopLeftCell account={account} compact />
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400">
            Trades
          </p>
          <TradesCell account={account} compact />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 pt-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-stone-500">
          <span>{RULE_SOURCE_LABEL[account.ruleSource]}</span>
          <span aria-hidden>·</span>
          <EnforcementChip mode={account.enforcementMode} />
          {account.consecutiveLosses != null && account.consecutiveLosses > 0 ? (
            <>
              <span aria-hidden>·</span>
              <span className="text-amber-700">
                Streak {account.consecutiveLosses}
                {account.stopAfterLosses != null ? ` / ${account.stopAfterLosses}` : ""}
              </span>
            </>
          ) : null}
        </div>
        <AccountActions account={account} />
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
  if (account.maxDailyLoss == null) {
    return (
      <p className={`font-mono ${compact ? "text-sm" : "text-sm"} text-stone-400`}>—</p>
    );
  }
  const remaining = account.remainingDailyLoss ?? account.maxDailyLoss;
  const pct = account.dailyLossUsedPct ?? 0;
  return (
    <div className={compact ? "" : "flex flex-col items-end gap-1"}>
      <p className="font-mono text-sm font-semibold text-stone-900">
        {CURRENCY_FORMATTER.format(remaining)}
      </p>
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

function StatusBadge({ status }: { status: AccountStatus }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${STATUS_BADGE_CLASS[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_CLASS[status]}`} aria-hidden />
      {STATUS_LABEL[status]}
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
