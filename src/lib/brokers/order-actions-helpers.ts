/**
 * Pure helpers for Tradovate order action eligibility checks.
 * No DB or network imports — safe to import in Node test runner.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type OrderActionsAccountState = {
  platform: string;
  isActive: boolean;
  protectionStatus: string;
  missingFromBrokerSince: Date | null;
  connectionStatus: string;
  externalAccountId: string | null;
  /** From BrokerConnection.permissionLevel — "full_access" | "read_only" | null. */
  permissionLevel: string | null;
};

export type AccountValidationResult =
  | { ok: true }
  | { ok: false; reason: string; code: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Pure: validate that an account is eligible for order actions.
 * Returns ok:true only when the account is active, connected, and not archived/unavailable.
 */
export function validateAccountForOrderActions(
  account: OrderActionsAccountState,
): AccountValidationResult {
  if (account.platform !== "tradovate") {
    return {
      ok: false,
      reason: "Order actions are only supported for Tradovate accounts.",
      code: "UNSUPPORTED_PLATFORM",
    };
  }
  if (!account.isActive) {
    return { ok: false, reason: "Account is not active.", code: "ACCOUNT_INACTIVE" };
  }
  if (account.protectionStatus === "archived") {
    return { ok: false, reason: "Account is archived.", code: "ACCOUNT_ARCHIVED" };
  }
  if (account.missingFromBrokerSince != null) {
    return {
      ok: false,
      reason: "Account is no longer active in the broker.",
      code: "ACCOUNT_UNAVAILABLE",
    };
  }
  if (
    account.connectionStatus === "not_connected" ||
    account.connectionStatus === "expired" ||
    account.connectionStatus === "connection_error"
  ) {
    return {
      ok: false,
      reason: "Broker connection is not active.",
      code: "CONNECTION_INACTIVE",
    };
  }
  if (
    account.connectionStatus === "pending_webhook" ||
    account.connectionStatus === "oauth_pending_storage"
  ) {
    return {
      ok: false,
      reason: "Broker connection setup is still in progress.",
      code: "CONNECTION_PENDING",
    };
  }
  if (!account.externalAccountId) {
    return {
      ok: false,
      reason: "External account ID not set — account may not have synced yet.",
      code: "NO_EXTERNAL_ACCOUNT_ID",
    };
  }
  return { ok: true };
}

/**
 * Pure: returns true when live order actions are permitted based on the
 * probed permission level. "read_only" connections cannot send any order
 * actions. null (not yet probed) is treated optimistically — a 403 from
 * the broker will surface the gap.
 */
export function canSendLiveOrderActions(account: {
  permissionLevel: string | null;
}): boolean {
  return account.permissionLevel !== "read_only";
}
