import Link from "next/link";
import type { RuleScopeGroup, RuleScopeAccount } from "./rule-scope-utils";
import { deriveScopeGroupBadge, deriveScopeAccountBadge } from "./scope-selector-helpers";

const ENV_LABEL: Record<string, string> = {
  live: "Live account",
  demo: "Demo / Sim",
};

type Props = {
  groups: RuleScopeGroup[];
  currentScope: string;
  currentAccountId: string | null;
  isDryRun: boolean;
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

  return (
    <Link
      href={`/rules?scope=account&id=${account.id}`}
      className={`flex min-w-0 items-center gap-2 overflow-hidden rounded-lg px-3.5 py-2 text-sm transition ${
        isSelected
          ? "bg-stone-950 text-stone-50"
          : account.missingFromBrokerSince != null
            ? "text-stone-400 hover:bg-stone-100"
            : "text-stone-700 hover:bg-stone-100"
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{account.label}</span>
      {badge && (
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${
            isSelected ? "bg-stone-700 text-stone-200" : badge.cls
          }`}
        >
          {badge.label}
        </span>
      )}
    </Link>
  );
}

export function ScopeSelector({ groups, currentScope, currentAccountId, isDryRun }: Props) {
  const isDefault = currentScope !== "account";

  return (
    <nav className="grid gap-0.5" aria-label="Rule scope">
      {/* Default template */}
      <Link
        href="/rules"
        className={`rounded-xl px-3.5 py-2.5 transition ${
          isDefault
            ? "bg-stone-950 text-stone-50"
            : "text-stone-700 hover:bg-stone-100"
        }`}
      >
        <p className="truncate text-sm font-semibold">Default template</p>
        <p className={`text-xs leading-5 ${isDefault ? "text-stone-300" : "text-stone-500"}`}>
          Applies to all accounts without account-specific rules
        </p>
      </Link>

      {/* Broker connection groups */}
      {groups.map((group) => {
        const requiresConsentInGroup = group.accounts.some(
          (a) => a.requiresAutomatedActionsConsent,
        );
        const badge = deriveScopeGroupBadge({
          isDryRun,
          connectionStatus: group.connectionStatus,
          permissionLevel: group.permissionLevel,
          requiresConsentInGroup,
        });
        const platformLabel = group.platform === "tradovate" ? "Tradovate"
          : group.platform === "tradingview" ? "TradingView"
          : group.platform;
        const userId = group.brokerUserId
          ? ` · ID ${group.brokerUserId.length > 10 ? `${group.brokerUserId.slice(0, 8)}…` : group.brokerUserId}`
          : "";

        return (
          <div key={group.groupKey} className="mt-2">
            <div className="flex items-start justify-between gap-1.5 px-2 pb-0.5 pt-1">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-stone-700">{group.firmLabel}</p>
                <p className="truncate text-[10px] text-stone-400">
                  {platformLabel} · {ENV_LABEL[group.env] ?? group.env}
                  {userId}
                </p>
              </div>
              <span
                className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${badge.cls}`}
              >
                {badge.label}
              </span>
            </div>
            <div className="mt-0.5 grid gap-0.5 pl-1">
              {group.accounts.map((account) => (
                <AccountItem
                  key={account.id}
                  account={account}
                  isSelected={currentScope === "account" && currentAccountId === account.id}
                />
              ))}
            </div>
          </div>
        );
      })}

      {groups.length === 0 && (
        <p className="mt-3 px-3.5 text-xs text-stone-400">
          No broker accounts connected yet.{" "}
          <Link href="/accounts/connect/tradovate" className="underline-offset-2 hover:underline">
            Connect Tradovate
          </Link>{" "}
          to configure account-specific rules.
        </p>
      )}
    </nav>
  );
}
