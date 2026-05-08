/**
 * Pure badge-derivation helpers for the Trading Plan scope selector sidebar.
 * Kept in a .ts file so they can be unit-tested without a DOM environment.
 *
 * Design intent: the sidebar must use product-facing protection states, not
 * raw OAuth/connection strings like "connected_readonly" or "read_only".
 * The language mirrors what the Dashboard already shows in the command center.
 */

export type ScopeBadge = {
  label: string;
  /** Tailwind classes for the unselected (default) badge state. */
  cls: string;
};

const DISCONNECTED_STATUSES = new Set([
  "not_connected",
  "expired",
  "connection_error",
]);

const PENDING_STATUSES = new Set([
  "pending_webhook",
  "oauth_pending_storage",
]);

/**
 * Derives the connection-group badge for the sidebar header row.
 * Capability-driven; the server-side ENFORCEMENT_DRY_RUN flag is intentionally
 * not reflected here — the Trading Plan UI describes what the account is wired
 * to do, not the runtime simulation flag.
 *
 * Priority (highest → lowest):
 *   1. Disconnected       → "Reconnect"    (connection broken, action needed)
 *   2. Pending setup      → "Setting up"   (OAuth completing)
 *   3. full_access + no consent → "Action required"
 *   4. full_access        → "Risk settings" (broker risk settings capability + consent)
 *   5. read_only          → "Monitoring"   (alerts only, no broker actions)
 *   6. null/unknown       → "Verifying"    (permission probe hasn't run yet)
 */
export function deriveScopeGroupBadge(input: {
  connectionStatus: string;
  permissionLevel: string | null | undefined;
  /** true when at least one account in the group is missing consent. */
  requiresConsentInGroup: boolean;
}): ScopeBadge {
  if (DISCONNECTED_STATUSES.has(input.connectionStatus)) {
    return { label: "Reconnect", cls: "bg-orange-100 text-orange-700" };
  }
  if (PENDING_STATUSES.has(input.connectionStatus)) {
    return { label: "Setting up", cls: "bg-amber-100 text-amber-700" };
  }
  const pl = input.permissionLevel;
  if (pl === "full_access") {
    if (input.requiresConsentInGroup) {
      return { label: "Action required", cls: "bg-amber-100 text-amber-800" };
    }
    return { label: "Risk settings", cls: "bg-emerald-100 text-emerald-700" };
  }
  if (pl === "read_only") {
    return { label: "Monitoring", cls: "bg-sky-100 text-sky-700" };
  }
  // null / unknown — permission probe hasn't completed yet.
  return { label: "Verifying", cls: "bg-stone-100 text-stone-500" };
}

/**
 * Derives the per-account badge shown inside a group's account list.
 * Returns null when the account needs no annotation.
 *
 * Priority: inactive > action required > custom rules.
 */
export function deriveScopeAccountBadge(input: {
  isUnavailable: boolean;
  requiresAutomatedActionsConsent: boolean;
  hasAccountRules: boolean;
}): ScopeBadge | null {
  if (input.isUnavailable) {
    return { label: "Inactive", cls: "bg-amber-100 text-amber-700" };
  }
  if (input.requiresAutomatedActionsConsent) {
    return { label: "Action required", cls: "bg-amber-100 text-amber-800" };
  }
  if (input.hasAccountRules) {
    return { label: "Custom", cls: "bg-amber-100 text-amber-700" };
  }
  return null;
}
