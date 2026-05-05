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

export const ARCHIVE_CONFIRM_MSG =
  "Archive this unavailable account? It will be hidden from active monitoring views.";
