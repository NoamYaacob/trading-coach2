/**
 * Helpers for partitioning accounts into "active" (selectable for trading
 * actions in the UI) and "inactive" (expired / unavailable, still kept for
 * historical data but hidden from primary selectors).
 *
 * Soft-hide semantics: archived accounts are filtered out at the data layer
 * (`loadCommandCenterData` only loads `protected` + `monitor_only`); this
 * helper handles the in-between case where the account is still loaded but
 * its broker connection has expired or the broker no longer returns it.
 */

import type { CommandCenterAccount } from "./types";

/**
 * True when the account is in a tradable / monitorable state and belongs in
 * the primary active selectors (top dashboard cards, sidebar, trades tabs,
 * default-selection fallback).
 *
 * False when the account is expired (broker token revoked / no longer valid)
 * or unavailable (broker no longer returns the account).
 *
 *  - "allowed"      — live and within limits
 *  - "warning"      — live and near a limit
 *  - "locked"       — live but session locked by rules
 *  - "setup_needed" — live but needs rules / prop-firm limits configured
 *  - "not_connected"— inactive (includes connectionStatus = expired)
 *  - "unavailable"  — broker /account/list no longer returns this account
 */
export function isAccountActive(
  acc: Pick<CommandCenterAccount, "status" | "connectionStatus">,
): boolean {
  if (acc.status === "unavailable") return false;
  if (acc.status === "not_connected") return false;
  // Defensive: connectionStatus "expired" should already roll up to status
  // "not_connected" via deriveStatus, but guard in case the source data
  // changes shape.
  if (acc.connectionStatus === "expired") return false;
  return true;
}

/**
 * Partition the account list into (active, expired) groups while preserving
 * input order within each group.
 */
export function partitionAccountsByActive<
  T extends Pick<CommandCenterAccount, "status" | "connectionStatus">,
>(accounts: readonly T[]): { active: T[]; expired: T[] } {
  const active: T[] = [];
  const expired: T[] = [];
  for (const acc of accounts) {
    if (isAccountActive(acc)) active.push(acc);
    else expired.push(acc);
  }
  return { active, expired };
}
