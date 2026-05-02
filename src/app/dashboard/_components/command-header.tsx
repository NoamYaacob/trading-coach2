import Link from "next/link";

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

const CONNECTION_MODE_LABEL: Record<string, string> = {
  connected_live: "Broker-connected read-only",
  connected_readonly: "Broker-connected read-only",
  pending_webhook: "Connected · Awaiting first trade event",
  not_connected: "Not connected",
  expired: "Connection expired — re-authorize",
  connection_error: "Connection error",
};

export type PrimaryAccount = {
  label: string;
  platform: string;
  propFirm: string | null;
  accountType: string;
  connectionStatus: string;
  lastSyncAt: Date | null;
  connectedAt: Date | null;
};

export type CommandHeaderProps = {
  primaryAccount: PrimaryAccount | null;
  hasBroker: boolean;
  setupNeeded: boolean;
  onboardingComplete: boolean;
  guardianEnabled: boolean;
  todaySessionKind: string;
  lockoutActive: boolean;
  liveRiskState: "NORMAL" | "WARNING" | "STOPPED" | null;
  sessionStarted: boolean;
  sessionEnded: boolean;
};

type PermissionInfo = {
  label: string;
  chipClass: string;
  reason: string;
  nextHref: string;
  nextLabel: string;
};

function derivePermission(props: CommandHeaderProps): PermissionInfo {
  const {
    setupNeeded,
    onboardingComplete,
    guardianEnabled,
    todaySessionKind,
    lockoutActive,
    liveRiskState,
    sessionStarted,
    sessionEnded,
  } = props;

  if (!onboardingComplete) {
    return {
      label: "Setup needed",
      chipClass: "bg-stone-500 text-white",
      reason: "Finish onboarding to enable Guardian.",
      nextHref: "/onboarding",
      nextLabel: "Continue setup →",
    };
  }
  if (setupNeeded) {
    return {
      label: "Setup needed",
      chipClass: "bg-stone-500 text-white",
      reason: "Set your trading rules to activate risk monitoring.",
      nextHref: "/rules",
      nextLabel: "Set rules →",
    };
  }
  if (!guardianEnabled || todaySessionKind === "GUARDIAN_DISABLED") {
    return {
      label: "Paused",
      chipClass: "bg-amber-500 text-white",
      reason: "Guardian is off. Enable it before trading.",
      nextHref: "/rules#guardian-toggle",
      nextLabel: "Enable Guardian →",
    };
  }
  if (lockoutActive || liveRiskState === "STOPPED") {
    return {
      label: "Locked",
      chipClass: "bg-red-600 text-white",
      reason: "A rule was breached. Trading is paused in this app.",
      nextHref: "/guardian",
      nextLabel: "View lockout details →",
    };
  }
  if (liveRiskState === "WARNING") {
    return {
      label: "Warning",
      chipClass: "bg-amber-500 text-white",
      reason: "A rule threshold is near. Review before your next trade.",
      nextHref: "/guardian",
      nextLabel: "Review status →",
    };
  }
  if (todaySessionKind === "RESET_PENDING") {
    return {
      label: "Reset pending",
      chipClass: "bg-orange-500 text-white",
      reason: "Locked — waiting for daily reset window.",
      nextHref: "/guardian",
      nextLabel: "View reset details →",
    };
  }
  if (sessionEnded) {
    return {
      label: "Allowed",
      chipClass: "bg-emerald-600 text-white",
      reason: "Session ended for today. Rules clear.",
      nextHref: "/guardian",
      nextLabel: "View today's recap →",
    };
  }
  if (sessionStarted) {
    return {
      label: "Allowed",
      chipClass: "bg-emerald-600 text-white",
      reason: "Session active. Guardian is monitoring your limits.",
      nextHref: "/guardian",
      nextLabel: "View Guardian status →",
    };
  }
  return {
    label: "Allowed",
    chipClass: "bg-emerald-600 text-white",
    reason: "All rules clear. Start a session when ready to trade.",
    nextHref: "/guardian",
    nextLabel: "Start session →",
  };
}

function syncLabel(account: PrimaryAccount): string {
  const ref = account.lastSyncAt ?? account.connectedAt;
  if (!ref) return "No sync yet";
  const diffMs = Date.now() - ref.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "Last sync just now";
  if (diffMin < 60) return `Last sync ${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `Last sync ${diffH}h ago`;
  return `Last sync ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(ref)}`;
}

export function CommandHeader(props: CommandHeaderProps) {
  const { primaryAccount, hasBroker } = props;
  const perm = derivePermission(props);

  const platformLabel = primaryAccount ? (PLATFORM_LABEL[primaryAccount.platform] ?? primaryAccount.platform) : null;
  const accountTypeLabel = primaryAccount ? (ACCOUNT_TYPE_LABEL[primaryAccount.accountType] ?? null) : null;
  const connectionModeLabel = primaryAccount
    ? (CONNECTION_MODE_LABEL[primaryAccount.connectionStatus] ?? primaryAccount.connectionStatus.replace(/_/g, " "))
    : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white/90 shadow-[0_4px_20px_-8px_rgba(28,25,23,0.1)]">
      {/* Account identity strip */}
      <div className="border-b border-stone-100 bg-stone-50/70 px-5 py-3">
        {hasBroker && primaryAccount ? (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-semibold text-stone-950">{primaryAccount.label}</span>
              {platformLabel && (
                <>
                  <span className="text-stone-300" aria-hidden>·</span>
                  <span className="text-stone-600">{platformLabel}</span>
                </>
              )}
              {primaryAccount.propFirm && (
                <>
                  <span className="text-stone-300" aria-hidden>·</span>
                  <span className="text-stone-600">{primaryAccount.propFirm}</span>
                </>
              )}
              {accountTypeLabel && (
                <>
                  <span className="text-stone-300" aria-hidden>·</span>
                  <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">
                    {accountTypeLabel}
                  </span>
                </>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-400">
              {connectionModeLabel && <span>{connectionModeLabel}</span>}
              <span>{syncLabel(primaryAccount)}</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium text-stone-600">
              No broker connected · Manual Mode active
            </p>
            <Link
              href="/accounts/connect/tradovate"
              className="inline-flex rounded-full bg-stone-950 px-3 py-1.5 text-xs font-medium text-stone-50 transition hover:bg-stone-800"
            >
              Connect Tradovate
            </Link>
          </div>
        )}
      </div>

      {/* Permission + enforcement scope */}
      <div className="px-5 py-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          {/* Left: permission */}
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${perm.chipClass}`}
              >
                {perm.label}
              </span>
              <p className="text-sm text-stone-600">{perm.reason}</p>
            </div>
            {!hasBroker && (
              <p className="mt-2 text-xs leading-5 text-stone-500">
                Manual Mode tracks trades you enter yourself. It cannot block broker orders.
              </p>
            )}
            <Link
              href={perm.nextHref}
              className="mt-3 inline-flex rounded-full border border-stone-300 px-4 py-2 text-xs font-medium text-stone-700 transition hover:border-stone-950 hover:text-stone-950"
            >
              {perm.nextLabel}
            </Link>
          </div>

          {/* Right: enforcement scope — always shown, always honest */}
          <div className="shrink-0 rounded-xl border border-stone-100 bg-stone-50 px-4 py-3 text-xs sm:min-w-[240px]">
            <p className="font-semibold uppercase tracking-[0.18em] text-stone-400">
              Enforcement scope
            </p>
            <div className="mt-2.5 grid gap-1.5 text-stone-600">
              <div className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                <span>
                  App-level lock:{" "}
                  <span className="font-medium text-stone-800">Active</span>
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-stone-300" />
                <span>
                  Broker-side order blocking:{" "}
                  <span className="font-medium text-stone-500">Not active</span>
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-stone-300" />
                <span>
                  Cancel orders / flatten positions:{" "}
                  <span className="font-medium text-stone-500">Not active</span>
                </span>
              </div>
            </div>
            {hasBroker && (
              <p className="mt-2.5 leading-5 text-stone-400">
                Current connection is read-only. Broker-side actions require additional permissions.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
