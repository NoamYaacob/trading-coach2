import Link from "next/link";
import type { RuleScopeGroup, RuleScopeAccount } from "./rule-scope-utils";

const ENV_LABEL: Record<string, string> = {
  live: "Live",
  demo: "Demo / Sim",
};

const CONN_STATUS: Record<string, { label: string; cls: string }> = {
  connected_live:        { label: "Connected", cls: "bg-emerald-100 text-emerald-700" },
  connected_readonly:    { label: "Read-only", cls: "bg-sky-100 text-sky-700" },
  pending_webhook:       { label: "Pending", cls: "bg-amber-100 text-amber-700" },
  oauth_pending_storage: { label: "Setting up", cls: "bg-amber-100 text-amber-700" },
  not_connected:         { label: "Not connected", cls: "bg-stone-100 text-stone-500" },
  expired:               { label: "Expired", cls: "bg-orange-100 text-orange-700" },
  connection_error:      { label: "Error", cls: "bg-red-100 text-red-700" },
};

type Props = {
  groups: RuleScopeGroup[];
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
  return (
    <Link
      href={`/rules?scope=account&id=${account.id}`}
      className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm transition ${
        isSelected
          ? "bg-stone-950 text-stone-50"
          : "text-stone-700 hover:bg-stone-100"
      }`}
    >
      <span className="min-w-0 flex-1 truncate">{account.label}</span>
      {account.hasAccountRules && (
        <span
          className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${
            isSelected ? "bg-stone-700 text-stone-200" : "bg-amber-100 text-amber-700"
          }`}
        >
          custom
        </span>
      )}
    </Link>
  );
}

export function ScopeSelector({ groups, currentScope, currentAccountId }: Props) {
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
        <p className="text-sm font-semibold">Default template</p>
        <p className={`text-xs leading-5 ${isDefault ? "text-stone-300" : "text-stone-500"}`}>
          Applies to all accounts without account-specific rules
        </p>
      </Link>

      {/* Broker connection groups */}
      {groups.map((group) => {
        const status = CONN_STATUS[group.connectionStatus] ?? {
          label: group.connectionStatus.replace(/_/g, " "),
          cls: "bg-stone-100 text-stone-500",
        };
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
                <p className="text-xs font-semibold text-stone-700">{group.firmLabel}</p>
                <p className="text-[10px] text-stone-400">
                  {platformLabel} · {ENV_LABEL[group.env] ?? group.env}{userId}
                </p>
              </div>
              <span
                className={`mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] ${status.cls}`}
              >
                {status.label}
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
