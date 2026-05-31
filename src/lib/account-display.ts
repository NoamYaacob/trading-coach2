/**
 * User-facing account naming.
 *
 * These pure helpers derive a friendly, human-readable label for a connected
 * account and a friendly identity for a broker connection. They are the single
 * source of truth for "what name do we show a human?" across the sidebar,
 * dashboard cards, settings broker connections, and the rules/trades selectors.
 *
 * Rules (in priority order) for an account label:
 *   1. user-set `displayName` (always wins when non-blank)
 *   2. prop firm + account type, e.g. "MyFundedFutures Evaluation"
 *   3. "Personal account" for personal accounts with no firm
 *   4. the broker `label` (e.g. "DEMO7433035") — a broker account number, fine
 *   5. `externalAccountId` — the broker account id, fine
 *   6. a generic "Account" fallback
 *
 * It NEVER returns a raw internal DB id (a cuid like "clx…"). Callers must not
 * pass the DB `id` as `label`/`externalAccountId`.
 */

const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  evaluation: "Evaluation",
  funded: "Funded",
  personal: "Personal",
  demo: "Demo",
};

export type DisplayableAccount = {
  displayName?: string | null;
  propFirm?: string | null;
  accountType?: string | null;
  label?: string | null;
  externalAccountId?: string | null;
};

function clean(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** Heuristic: a value that looks like an internal cuid/uuid DB id. We never
 *  surface these to users. cuid: starts with "c", 25 chars, [a-z0-9]. */
function looksLikeInternalId(v: string): boolean {
  if (/^c[a-z0-9]{20,}$/.test(v)) return true; // cuid
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return true; // uuid
  return false;
}

/**
 * The friendly account name shown to humans. See module docs for priority.
 */
export function deriveAccountDisplayLabel(account: DisplayableAccount): string {
  const displayName = clean(account.displayName);
  if (displayName) return displayName;

  const propFirm = clean(account.propFirm);
  const accountType = clean(account.accountType);

  if (propFirm) {
    const typeLabel = accountType ? ACCOUNT_TYPE_LABEL[accountType] : null;
    // Don't append "Personal" to a prop-firm account — it's contradictory.
    return typeLabel && accountType !== "personal" ? `${propFirm} ${typeLabel}` : propFirm;
  }

  if (accountType === "personal") return "Personal account";

  const label = clean(account.label);
  if (label && !looksLikeInternalId(label)) return label;

  const external = clean(account.externalAccountId);
  if (external && !looksLikeInternalId(external)) return external;

  return "Account";
}

/**
 * The PRIMARY user-facing account identity for selectors where the user must
 * tell apart many accounts at the same firm (e.g. several MyFundedFutures
 * evaluations). Unlike deriveAccountDisplayLabel, the exact broker account
 * label wins over generic firm/type metadata — "MyFundedFutures Evaluation" is
 * identical across many accounts and hides which one this actually is.
 *
 * Priority:
 *   1. user-set `displayName` (always wins)
 *   2. broker `label` (the exact Tradovate account name/number, e.g. "DEMO7433035")
 *   3. `externalAccountId` (broker account id)
 *   4. prop firm + type (e.g. "MyFundedFutures Evaluation") — last resort only
 *   5. "Account"
 *
 * Never returns a raw internal cuid/uuid DB id.
 */
export function deriveAccountPrimaryLabel(account: DisplayableAccount): string {
  const displayName = clean(account.displayName);
  if (displayName) return displayName;

  const label = clean(account.label);
  if (label && !looksLikeInternalId(label)) return label;

  const external = clean(account.externalAccountId);
  if (external && !looksLikeInternalId(external)) return external;

  // Last resort: generic firm/type metadata, which does not distinguish
  // multiple accounts at the same firm.
  const propFirm = clean(account.propFirm);
  const accountType = clean(account.accountType);
  if (propFirm) {
    const typeLabel = accountType ? ACCOUNT_TYPE_LABEL[accountType] : null;
    return typeLabel && accountType !== "personal" ? `${propFirm} ${typeLabel}` : propFirm;
  }
  if (accountType === "personal") return "Personal account";

  return "Account";
}

/**
 * Secondary metadata line for an account selector — "firm · type", e.g.
 * "MyFundedFutures · Evaluation". Shown beneath the primary label so two
 * accounts at the same firm stay legible. Returns null when neither is known.
 */
export function deriveAccountSecondaryMeta(account: DisplayableAccount): string | null {
  const propFirm = clean(account.propFirm);
  const accountType = clean(account.accountType);
  const typeLabel = accountType ? (ACCOUNT_TYPE_LABEL[accountType] ?? accountType) : null;
  if (propFirm && typeLabel && accountType !== "personal") return `${propFirm} · ${typeLabel}`;
  if (propFirm) return propFirm;
  if (accountType === "personal") return "Personal";
  if (typeLabel) return typeLabel;
  return null;
}

/**
 * A short tag for the firm / type of a single account, used in the broker
 * connection identity line. e.g. "MyFundedFutures", "Personal", "Demo".
 */
export function deriveAccountFirmTag(account: DisplayableAccount): string {
  const propFirm = clean(account.propFirm);
  if (propFirm) return propFirm;
  const accountType = clean(account.accountType);
  if (accountType === "personal") return "Personal";
  if (accountType) return ACCOUNT_TYPE_LABEL[accountType] ?? accountType;
  return "Account";
}

/**
 * A friendly identity for a broker connection card, e.g.
 *   - "Tradovate Demo · MyFundedFutures"   (one firm)
 *   - "Tradovate Live · Personal"
 *   - "Tradovate Demo · 3 accounts"         (mixed firms/types)
 *   - "Tradovate Demo"                       (no active accounts)
 *
 * `providerLabel` is the broker name ("Tradovate"), `envLabel` is "Live"/"Demo"
 * (or ""), `accounts` are the connection's *active* (non-archived) accounts.
 */
export function deriveConnectionIdentity(
  providerLabel: string,
  envLabel: string,
  accounts: DisplayableAccount[],
): string {
  const base = envLabel ? `${providerLabel} ${envLabel}` : providerLabel;
  if (accounts.length === 0) return base;

  const tags = accounts.map(deriveAccountFirmTag);
  const distinct = Array.from(new Set(tags));

  if (accounts.length === 1 || distinct.length === 1) {
    return `${base} · ${distinct[0]}`;
  }
  return `${base} · ${accounts.length} accounts`;
}

/**
 * Suggested display name for a freshly discovered account — same logic as the
 * friendly label but ignoring any existing displayName, so the onboarding step
 * can pre-fill an editable suggestion.
 */
export function suggestAccountDisplayName(account: Omit<DisplayableAccount, "displayName">): string {
  return deriveAccountDisplayLabel({ ...account, displayName: null });
}
