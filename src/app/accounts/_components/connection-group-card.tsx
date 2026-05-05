import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { SyncButton } from "./sync-button";
import { ProtectionControls } from "./protection-controls";
import {
  deriveEnforcementLabelValues,
  deriveRulesLabel,
  deriveStopContext,
} from "./account-rule-helpers";

// ── Types ──────────────────────────────────────────────────────────────────────

type AccountRules = {
  maxDailyLoss: Prisma.Decimal | null;
  maxTradesPerDay: number | null;
  stopAfterLosses: number | null;
  propFirmDailyLossLimit: Prisma.Decimal | null;
};

type AccountSessionState = {
  riskState: string;
  sessionDate: string;
  dailyPnl: Prisma.Decimal | null;
};

type AccountIntervention = {
  brokerLockStatus: string | null;
};

export type AccountForConnectionCard = {
  id: string;
  label: string;
  balance: Prisma.Decimal | null;
  propFirm: string | null;
  accountType: string;
  protectionStatus: string;
  pendingProtectionStatus: string | null;
  pendingProtectionEffectiveDate: string | null;
  missingFromBrokerSince: Date | null;
  lastSyncAt: Date | null;
  riskRules: AccountRules | null;
  sessionState: AccountSessionState | null;
  interventions: AccountIntervention[];
};

export type ConnectionForCard = {
  id: string;
  platform: string;
  env: string;
  brokerUserId: string | null;
  connectionStatus: string;
  accounts: AccountForConnectionCard[];
};

// ── Constants ──────────────────────────────────────────────────────────────────

const PLATFORM_LABEL: Record<string, string> = {
  tradovate: "Tradovate",
  tradingview: "TradingView",
  manual: "Manual",
};

const ENV_LABEL: Record<string, string> = {
  live: "Live",
  demo: "Demo / Sim",
};

const CONN_STATUS: Record<string, { label: string; cls: string }> = {
  connected_live:         { label: "Connected live", cls: "bg-emerald-100 text-emerald-700" },
  connected_readonly:     { label: "Read-only", cls: "bg-sky-100 text-sky-700" },
  pending_webhook:        { label: "Pending sync", cls: "bg-amber-100 text-amber-700" },
  oauth_pending_storage:  { label: "Setting up", cls: "bg-amber-100 text-amber-700" },
  not_connected:          { label: "Not connected", cls: "bg-stone-100 text-stone-600" },
  expired:                { label: "Expired", cls: "bg-orange-100 text-orange-700" },
  connection_error:       { label: "Connection error", cls: "bg-red-100 text-red-700" },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function shortDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function isExpiredStatus(status: string): boolean {
  return status === "expired" || status === "connection_error";
}

function deriveCapability(
  platform: string,
  connectionStatus: string,
): { label: string; detail: string; cls: string } {
  if (platform !== "tradovate") {
    return {
      label: "Monitoring only",
      detail: "Broker-side enforcement is only available on Tradovate connections.",
      cls: "border-stone-200 bg-stone-50 text-stone-600",
    };
  }
  if (isExpiredStatus(connectionStatus)) {
    return {
      label: "Reconnect required",
      detail: "Reconnect to restore account data sync and rule evaluation for this connection.",
      cls: "border-amber-200 bg-amber-50 text-amber-800",
    };
  }
  return {
    label: "Read-only monitoring",
    detail: "Account data is synced and rules are evaluated. In-app and Telegram alerts are active. Broker-side blocking is not active on this connection.",
    cls: "border-sky-200 bg-sky-50 text-sky-800",
  };
}

function deriveGuardianLabel(
  sessionState: AccountSessionState | null,
  today: string,
): { label: string; cls: string } {
  if (!sessionState || sessionState.sessionDate !== today) {
    return { label: "Awaiting", cls: "bg-stone-100 text-stone-500" };
  }
  if (sessionState.riskState === "STOPPED") return { label: "Stopped", cls: "bg-red-100 text-red-700" };
  if (sessionState.riskState === "WARNING") return { label: "Warning", cls: "bg-amber-100 text-amber-700" };
  return { label: "Normal", cls: "bg-emerald-100 text-emerald-700" };
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function StatusChip({ label, cls }: { label: string; cls: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${cls}`}
    >
      {label}
    </span>
  );
}

function AccountCompactRow({
  account,
  today,
  isLocked,
  hasDefaultRules,
  defaultMaxDailyLoss,
  connectionStatus,
}: {
  account: AccountForConnectionCard;
  today: string;
  isLocked: boolean;
  hasDefaultRules: boolean;
  defaultMaxDailyLoss: number | null;
  connectionStatus: string;
}) {
  const hasAccountRules = Boolean(
    account.riskRules &&
      (account.riskRules.maxDailyLoss != null ||
        account.riskRules.maxTradesPerDay != null ||
        account.riskRules.stopAfterLosses != null),
  );

  const guardian = deriveGuardianLabel(account.sessionState, today);
  const enforcement = deriveEnforcementLabelValues(
    account.interventions[0]?.brokerLockStatus ?? null,
    account.sessionState?.riskState ?? null,
    account.sessionState?.sessionDate ?? null,
    today,
  );
  const rulesLabel = deriveRulesLabel(
    hasAccountRules,
    hasDefaultRules,
    account.propFirm,
    account.accountType,
  );

  const balance = account.balance != null ? Number(account.balance) : null;

  const isStoppedToday =
    account.sessionState?.riskState === "STOPPED" &&
    account.sessionState.sessionDate === today;

  // Effective daily loss limit for stop-detail display.
  // Prefer account-specific rule, then propFirmDailyLossLimit, then default plan limit.
  const effectiveDailyLossLimit =
    account.riskRules?.maxDailyLoss != null
      ? Number(account.riskRules.maxDailyLoss)
      : account.riskRules?.propFirmDailyLossLimit != null
        ? Number(account.riskRules.propFirmDailyLossLimit)
        : defaultMaxDailyLoss;

  const stopCtx = isStoppedToday
    ? deriveStopContext({
        propFirm: account.propFirm,
        accountType: account.accountType,
        dailyLossLimit: effectiveDailyLossLimit,
        connectionStatus,
      })
    : null;

  return (
    <div className="rounded-xl border border-stone-100 bg-stone-50 px-3.5 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-stone-900">{account.label}</p>
          {account.missingFromBrokerSince && (
            <p className="mt-0.5 text-[11px] text-amber-700">
              Not found in latest broker sync — may be closed or removed by the prop firm.
            </p>
          )}
        </div>
        <Link
          href={`/accounts/${account.id}/edit`}
          className="shrink-0 text-xs text-stone-500 transition hover:text-stone-950"
        >
          Edit
        </Link>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <StatusChip label={guardian.label} cls={guardian.cls} />
        <StatusChip label={enforcement.label} cls={enforcement.cls} />
        <span className="text-[10px] text-stone-400">{rulesLabel}</span>
        {balance != null && (
          <span className="text-[10px] tabular-nums text-stone-500">
            ${balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        )}
        {account.lastSyncAt && (
          <span className="ml-auto text-[10px] text-stone-400">
            Synced {shortDate(account.lastSyncAt)}
          </span>
        )}
      </div>

      {/* Stop detail — only shown when this account is STOPPED today */}
      {stopCtx && (
        <div className="mt-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[11px] leading-5 text-red-800">
          <p className="font-medium">Daily loss limit reached</p>
          <p className="mt-0.5">{stopCtx.lockNote}</p>
          {stopCtx.readOnlyNote && (
            <p className="mt-1 text-red-700">{stopCtx.readOnlyNote}</p>
          )}
          {stopCtx.softPauseNote && (
            <p className="mt-1 text-red-700">{stopCtx.softPauseNote}</p>
          )}
        </div>
      )}

      <div className="mt-3 border-t border-stone-100 pt-3">
        <ProtectionControls
          accountId={account.id}
          currentStatus={account.protectionStatus as "protected" | "monitor_only" | "ignored" | "archived" | "pending_decision"}
          pendingStatus={account.pendingProtectionStatus as "protected" | "monitor_only" | "ignored" | "archived" | "pending_decision" | null}
          pendingEffectiveDate={account.pendingProtectionEffectiveDate}
          isLocked={isLocked}
        />
      </div>
    </div>
  );
}

// ── Main export ────────────────────────────────────────────────────────────────

export function ConnectionGroupCard({
  connection,
  isLocked,
  hasDefaultRules,
  defaultMaxDailyLoss,
}: {
  connection: ConnectionForCard;
  isLocked: boolean;
  hasDefaultRules: boolean;
  defaultMaxDailyLoss: number | null;
}) {
  const today = todayKey();
  const { id, platform, env, brokerUserId, connectionStatus, accounts } = connection;
  const isExpired = isExpiredStatus(connectionStatus);
  const connStatus = CONN_STATUS[connectionStatus] ?? {
    label: connectionStatus.replace(/_/g, " "),
    cls: "bg-stone-100 text-stone-600",
  };

  const lastSyncAt = accounts.reduce<Date | null>((latest, a) => {
    if (!a.lastSyncAt) return latest;
    return !latest || a.lastSyncAt > latest ? a.lastSyncAt : latest;
  }, null);

  const capability = deriveCapability(platform, connectionStatus);

  return (
    <div className="rounded-2xl border border-stone-200 bg-white px-5 py-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-stone-950">
              {PLATFORM_LABEL[platform] ?? platform} · {ENV_LABEL[env] ?? env}
            </h3>
            <StatusChip label={connStatus.label} cls={connStatus.cls} />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-stone-500">
            {brokerUserId && (
              <span>
                User ID {brokerUserId.length > 14 ? `${brokerUserId.slice(0, 12)}…` : brokerUserId}
              </span>
            )}
            <span>
              {accounts.length} account{accounts.length === 1 ? "" : "s"}
            </span>
            {lastSyncAt && <span>Last sync {shortDate(lastSyncAt)}</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isExpired ? (
            <Link
              href={`/accounts/connect/tradovate?env=${env}&reconnect=${id}`}
              className="inline-flex items-center rounded-full border border-red-300 px-3.5 py-1.5 text-xs font-medium text-red-700 transition hover:border-red-500"
            >
              Reconnect
            </Link>
          ) : (
            <>
              <SyncButton connectionId={id} lastSyncAt={lastSyncAt} />
              <Link
                href={`/accounts/connect/tradovate?env=${env}&reconnect=${id}`}
                className="inline-flex items-center rounded-full border border-stone-300 px-3.5 py-1.5 text-xs font-medium text-stone-900 transition hover:border-stone-950"
              >
                Add accounts
              </Link>
            </>
          )}
          <Link
            href="/dashboard"
            className="inline-flex items-center rounded-full border border-stone-200 px-3.5 py-1.5 text-xs font-medium text-stone-600 transition hover:border-stone-400 hover:text-stone-950"
          >
            Dashboard
          </Link>
        </div>
      </div>

      {/* Enforcement capability banner */}
      <div className={`mt-3 rounded-xl border px-3.5 py-2.5 text-xs ${capability.cls}`}>
        <span className="font-semibold">{capability.label}. </span>
        {capability.detail}
      </div>

      {/* Account rows */}
      {accounts.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {accounts.map((account) => (
            <AccountCompactRow
              key={account.id}
              account={account}
              today={today}
              isLocked={isLocked}
              hasDefaultRules={hasDefaultRules}
              defaultMaxDailyLoss={defaultMaxDailyLoss}
              connectionStatus={connectionStatus}
            />
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-stone-100 bg-stone-50 px-3.5 py-3 text-sm text-stone-500">
          No accounts added yet.{" "}
          {!isExpired && (
            <Link
              href={`/accounts/connect/tradovate?env=${env}&reconnect=${id}`}
              className="font-medium text-stone-950 underline-offset-2 hover:underline"
            >
              Add accounts
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
