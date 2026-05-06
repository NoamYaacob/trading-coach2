/**
 * Pure helpers for the SyncAllButton component.
 *
 * Extracted from sync-all-button.tsx so the response → state → message logic
 * can be unit-tested without a JSX/React loader.
 */

export type SyncAllResponse = {
  ok?: boolean;
  syncedConnections?: number;
  failedConnections?: number;
  syncedAccounts?: number;
  failedAccounts?: number;
  error?: string;
  retryAfterSeconds?: number;
};

export type SyncAllStatus =
  | { kind: "idle" }
  | { kind: "syncing" }
  | { kind: "success"; syncedAccounts: number; failedAccounts: number }
  | { kind: "error"; message: string };

/** Derive the user-facing status from a sync-all API response. */
export function deriveSyncAllStatus(input: {
  httpOk: boolean;
  status: number;
  body: SyncAllResponse;
}): SyncAllStatus {
  if (input.status === 429) {
    const wait = input.body.retryAfterSeconds;
    return {
      kind: "error",
      message: wait
        ? `Too many sync requests. Retry in ${wait}s.`
        : "Too many sync requests. Try again shortly.",
    };
  }
  if (!input.httpOk) {
    return { kind: "error", message: input.body.error ?? "Sync failed. Please try again." };
  }
  const synced = input.body.syncedAccounts ?? 0;
  const failed = input.body.failedAccounts ?? 0;
  return { kind: "success", syncedAccounts: synced, failedAccounts: failed };
}

/** Format a SyncAllStatus into the small text shown next to the button.
 *  Wording uses "Refreshed" / "Refreshing" to match the button label
 *  ("Refresh all accounts"). Internal types still say "sync" because the
 *  underlying broker API call is the same. */
export function formatSyncAllStatus(status: SyncAllStatus): string | null {
  if (status.kind === "idle") return null;
  if (status.kind === "syncing") return "Refreshing…";
  if (status.kind === "error") return status.message;
  if (status.failedAccounts === 0 && status.syncedAccounts === 0) {
    return "Nothing to refresh.";
  }
  if (status.failedAccounts === 0) {
    return `Refreshed ${status.syncedAccounts}.`;
  }
  return `Refreshed ${status.syncedAccounts} · ${status.failedAccounts} failed.`;
}
