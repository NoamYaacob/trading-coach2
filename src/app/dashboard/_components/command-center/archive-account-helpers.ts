/**
 * Pure helpers for archiving broker accounts.
 * Kept in a plain .ts file so they can be unit-tested without a JSX loader.
 */

/** Constructs the archive request without side effects. */
export function buildArchiveRequest(accountId: string): {
  url: string;
  method: "POST";
  body: { protectionStatus: "archived" };
} {
  return {
    url: `/api/accounts/${accountId}/protection`,
    method: "POST",
    body: { protectionStatus: "archived" },
  };
}

/** Copy used by the in-app confirmation dialog. */
export const ARCHIVE_DIALOG = {
  title: "Archive this account?",
  body: "This account will be hidden from active monitoring. Historical data will stay saved.",
  note: "You can still review past activity later.",
  confirmLabel: "Archive account",
  cancelLabel: "Cancel",
} as const;

/**
 * Interprets the raw HTTP response from the archive API.
 *
 * Returns { success: true } only when the account was archived immediately
 * (ok=true AND applied=true). The caller should call router.refresh() to
 * remove the row from the active dashboard.
 *
 * Returns { success: false, errorMessage } for every other outcome:
 *   - non-2xx response (network / auth error)
 *   - ok=false (API-level error)
 *   - applied=false (protection lock deferred the change — row stays visible)
 */
export function parseArchiveResponse(
  res: { ok: boolean },
  data: { ok?: boolean; applied?: boolean; error?: string; message?: string },
): { success: true } | { success: false; errorMessage: string } {
  if (!res.ok || !data.ok) {
    return {
      success: false,
      errorMessage: data.message ?? data.error ?? "Could not archive account.",
    };
  }
  if (!data.applied) {
    return {
      success: false,
      errorMessage:
        data.message ??
        "Archive could not be applied immediately. Try again outside trading hours.",
    };
  }
  return { success: true };
}
