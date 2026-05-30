import Link from "next/link";
import type { RuleScopeGroup, RuleScopeAccount } from "./rule-scope-utils";
import { deriveScopeAccountBadge } from "./scope-selector-helpers";

const ENV_LABEL: Record<string, string> = {
  live: "Live",
  demo: "Demo",
};

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  evaluation: "Evaluation",
  funded: "Funded",
  personal: "Personal",
  demo: "Sim",
};

type Props = {
  groups: RuleScopeGroup[];
  /** "account" | "starter" | "default" */
  currentScope: string;
  currentAccountId: string | null;
};

/**
 * Builds the single metadata line under an account name in the sidebar:
 *   "Live · MyFundedFutures · Evaluation"  /  "Demo · Sim"
 * Empty segments are dropped; the account name (label) is never repeated here.
 */
function accountMetaLine(account: RuleScopeAccount): string {
  const parts: string[] = [];
  const env = account.brokerConnection?.env;
  if (env) parts.push(ENV_LABEL[env] ?? env);
  if (account.propFirm) parts.push(account.propFirm);
  if (account.accountType) {
    const typeLabel = ACCOUNT_TYPE_LABEL[account.accountType] ?? account.accountType;
    // Avoid "MyFundedFutures · Personal" contradiction and "Demo · Sim" dupes.
    if (!(account.propFirm && account.accountType === "personal")) {
      if (!(env === "demo" && account.accountType === "demo")) {
        parts.push(typeLabel);
      }
    }
  }
  return parts.join(" · ");
}

/**
 * A single, self-contained clickable account row. This is the ONLY clickable
 * affordance per account — there is no separate parent "connection" row that
 * looks clickable but isn't, so the user never has to guess which row is the
 * real account.
 */
function AccountRow({
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
    connectionStatus: account.brokerConnection?.connectionStatus ?? account.connectionStatus,
  });
  const isInactive = account.missingFromBrokerSince != null;
  const meta = accountMetaLine(account);

  return (
    <li className="min-w-0">
      <Link
        href={`/rules?scope=account&id=${account.id}`}
        aria-current={isSelected ? "page" : undefined}
        title={account.label}
        className={`block w-full max-w-full overflow-hidden rounded-xl border px-3 py-2.5 transition ${
          isSelected
            ? "border-[color:var(--gr-copper-bd)] bg-[color:var(--gr-copper-bg)] text-[color:var(--gr-ink)]"
            : isInactive
              ? "border-transparent text-[color:var(--gr-text-mute)] hover:bg-[color:var(--gr-bg-elev)]"
              : "border-[color:var(--gr-border-sub)] text-[color:var(--gr-text-mid)] hover:border-[color:var(--gr-copper-bd)] hover:bg-[color:var(--gr-copper-bg)]/40"
        }`}
      >
        <div className="flex min-w-0 items-start justify-between gap-2">
          <p className={`truncate text-[13px] ${isSelected ? "font-semibold text-[color:var(--gr-ink)]" : "font-medium"}`}>
            {account.label}
          </p>
          <span
            className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] ${badge.cls}`}
          >
            {badge.label}
          </span>
        </div>
        {meta && (
          <p className={`mt-0.5 truncate text-[10.5px] ${isSelected ? "text-[color:var(--gr-text-mid)]" : "text-[color:var(--gr-text-mute)]"}`}>
            {meta}
          </p>
        )}
      </Link>
    </li>
  );
}

export function ScopeSelector({ groups, currentScope, currentAccountId }: Props) {
  const isStarterSelected = currentScope === "starter";
  // Flatten every connection's accounts into a single list. Each account is one
  // clickable row; we no longer render a non-clickable connection header that
  // duplicates a single account row and confuses which row is the real target.
  const allAccounts = groups.flatMap((g) => g.accounts);

  return (
    <nav aria-label="Rule scope" className="min-w-0">
      <p className="px-1 pb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--gr-text-mute)]">
        Trading accounts
      </p>
      <ul className="grid grid-cols-1 gap-1.5">
        {allAccounts.map((account) => (
          <AccountRow
            key={account.id}
            account={account}
            isSelected={currentScope === "account" && currentAccountId === account.id}
          />
        ))}

        {allAccounts.length === 0 && (
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
      </ul>

      {/* Defaults / starter settings — secondary, collapsed by default so it no
          longer competes with the real trading accounts as a primary target. */}
      <details className="mt-3 border-t border-[color:var(--gr-border-sub)] pt-2" open={isStarterSelected}>
        <summary className="flex cursor-pointer list-none items-center justify-between px-1 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--gr-text-mute)] hover:text-[color:var(--gr-ink)]">
          <span>Defaults</span>
          <span aria-hidden className="text-[10px] font-normal">▾</span>
        </summary>
        <Link
          href="/rules?scope=starter"
          aria-current={isStarterSelected ? "page" : undefined}
          className={`mt-1 block w-full max-w-full overflow-hidden rounded-xl border px-3 py-2 transition ${
            isStarterSelected
              ? "border-amber-300 bg-amber-50/60 text-stone-900"
              : "border-[color:var(--gr-border-sub)] text-[color:var(--gr-text-mid)] hover:bg-[color:var(--gr-bg-elev)]"
          }`}
        >
          <p className={`truncate text-[13px] ${isStarterSelected ? "font-semibold text-[color:var(--gr-ink)]" : "font-medium"}`}>
            Starter settings
          </p>
          <p className={`mt-0.5 truncate text-[10.5px] ${isStarterSelected ? "text-[color:var(--gr-text-mid)]" : "text-[color:var(--gr-text-mute)]"}`}>
            Session defaults applied to new accounts
          </p>
        </Link>
      </details>
    </nav>
  );
}
