import Link from "next/link";
import type { RuleScopeGroup, RuleScopeAccount } from "./rule-scope-utils";
import { deriveScopeGroupBadge, deriveScopeAccountBadge } from "./scope-selector-helpers";

const ENV_LABEL: Record<string, string> = {
  live: "Live",
  demo: "Demo / Sim",
};

/** Maps broker connection status to a colored dot for the group header. */
function connectionDotCls(status: string): string {
  if (status === "connected_live") return "bg-emerald-400";
  if (status.startsWith("connect")) return "bg-amber-400";
  return "bg-stone-300";
}

type Props = {
  groups: RuleScopeGroup[];
  /** "account" | "starter" | "default" */
  currentScope: string;
  currentAccountId: string | null;
};

function AccountItem({
  account,
  isSelected,
}: {
  account: RuleScopeAccount;
  isSelected: boolean;
}) {
  const badge = deriveScopeAccountBadge({
    isUnavailable: account.missingFromBrokerSince != null,
    requiresAutomatedActionsConsent: account.requiresAutomatedActionsConsent,
    hasAccountRules: account.hasAccountRules,
  });
  const isInactive = account.missingFromBrokerSince != null;
  const envLabel = account.brokerConnection
    ? (ENV_LABEL[account.brokerConnection.env] ?? account.brokerConnection.env)
    : null;

  return (
    <li className="min-w-0">
      <Link
        href={`/rules?scope=account&id=${account.id}`}
        aria-current={isSelected ? "page" : undefined}
        className={`block w-full max-w-full overflow-hidden rounded-xl border-l-2 py-2 pl-3 pr-2 transition ${
          isSelected
            ? "border-amber-600 bg-amber-50/60 text-stone-900"
            : isInactive
              ? "border-transparent text-stone-400 hover:bg-stone-50"
              : "border-transparent text-stone-700 hover:bg-amber-50/30"
        }`}
      >
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className={`truncate text-[13px] ${isSelected ? "font-semibold" : "font-medium"}`}>
              {account.label}
            </p>
            {envLabel && (
              <p className={`truncate text-[11px] ${isSelected ? "text-stone-500" : "text-stone-400"}`}>
                {envLabel}
              </p>
            )}
          </div>
          <span
            className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${badge.cls}`}
          >
            {badge.label}
          </span>
        </div>
      </Link>
    </li>
  );
}

export function ScopeSelector({ groups, currentScope, currentAccountId }: Props) {
  const isStarterSelected = currentScope === "starter" || (currentScope !== "account" && groups.length === 0);

  return (
    <nav aria-label="Rule scope" className="min-w-0">
      <ul className="grid grid-cols-1 gap-1">

        {/* Broker connection groups — shown first */}
        {groups.map((group) => {
          const requiresConsentInGroup = group.accounts.some(
            (a) => a.requiresAutomatedActionsConsent,
          );
          const badge = deriveScopeGroupBadge({
            connectionStatus: group.connectionStatus,
            permissionLevel: group.permissionLevel,
            requiresConsentInGroup,
          });
          const platformLabel =
            group.platform === "tradovate"
              ? "Tradovate"
              : group.platform === "tradingview"
                ? "TradingView"
                : group.platform;
          const userId = group.brokerUserId
            ? ` · ${group.brokerUserId.length > 10 ? `${group.brokerUserId.slice(0, 8)}…` : group.brokerUserId}`
            : "";

          return (
            <li key={group.groupKey} className="min-w-0">
              {/* Firm / connection header with status dot */}
              <div className="flex min-w-0 items-start justify-between gap-1.5 px-2 pb-1 pt-2">
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${connectionDotCls(group.connectionStatus)}`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-bold text-stone-800">
                      {group.firmLabel}
                    </p>
                    <p className="truncate text-[10px] text-stone-400">
                      {platformLabel} · {ENV_LABEL[group.env] ?? group.env}
                      {userId}
                    </p>
                  </div>
                </div>
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${badge.cls}`}
                >
                  {badge.label}
                </span>
              </div>
              <ul className="grid grid-cols-1 gap-px pl-2">
                {group.accounts.map((account) => (
                  <AccountItem
                    key={account.id}
                    account={account}
                    isSelected={currentScope === "account" && currentAccountId === account.id}
                  />
                ))}
              </ul>
            </li>
          );
        })}

        {groups.length === 0 && (
          <li className="min-w-0">
            <p className="px-3.5 py-2 text-xs text-stone-400">
              No broker accounts connected yet.{" "}
              <Link href="/accounts/connect/tradovate" className="underline-offset-2 hover:underline">
                Connect Tradovate
              </Link>{" "}
              to configure account-specific rules.
            </p>
          </li>
        )}

        {/* Starter settings — always at bottom */}
        <li className={`min-w-0 ${groups.length > 0 ? "mt-2 border-t border-stone-100 pt-2" : "mt-1"}`}>
          <p className="px-3.5 pb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-stone-400">
            Defaults
          </p>
          <Link
            href="/rules?scope=starter"
            aria-current={isStarterSelected ? "page" : undefined}
            className={`block w-full max-w-full overflow-hidden rounded-xl border-l-2 py-2 pl-3 pr-2 transition ${
              isStarterSelected
                ? "border-amber-600 bg-amber-50/60 text-stone-900"
                : "border-transparent text-stone-700 hover:bg-amber-50/30"
            }`}
          >
            <div className="flex min-w-0 items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className={`truncate text-[13px] ${isStarterSelected ? "font-semibold" : "font-medium"}`}>
                  Starter settings
                </p>
                <p className={`truncate text-[11px] ${isStarterSelected ? "text-stone-500" : "text-stone-400"}`}>
                  Session defaults
                </p>
              </div>
              <span
                className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${
                  isStarterSelected ? "bg-amber-600 text-white" : "bg-stone-100 text-stone-500"
                }`}
              >
                Starter
              </span>
            </div>
          </Link>
        </li>

      </ul>
    </nav>
  );
}
