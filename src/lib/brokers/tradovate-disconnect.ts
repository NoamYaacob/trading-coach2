/**
 * Pure helpers for broker account disconnection.
 *
 * No DB calls here — only payload builders and status helpers.
 * This separation makes the logic unit-testable without a database.
 */

import {
  TradovateClientError,
} from "./tradovate-client-helpers.ts";

// ── Disconnect payload ────────────────────────────────────────────────────────

export type DisconnectUpdate = {
  isActive: boolean;
  connectionStatus: string;
  accessTokenEncrypted: null;
  refreshTokenEncrypted: null;
  tokenExpiresAt: null;
  errorMessage: string;
};

/**
 * Build the Prisma update payload for a broker disconnect.
 *
 * - Marks the account inactive.
 * - Sets connectionStatus to "not_connected".
 * - Nulls out all encrypted token fields and the expiry timestamp.
 * - Sets a human-readable errorMessage for diagnostic display.
 *
 * Does NOT touch journal entries, risk rules, session events, or manual
 * trades — those belong to the user and are never removed on disconnect.
 */
export function buildDisconnectUpdate(): DisconnectUpdate {
  return {
    isActive: false,
    connectionStatus: "not_connected",
    accessTokenEncrypted: null,
    refreshTokenEncrypted: null,
    tokenExpiresAt: null,
    errorMessage: "Disconnected by user.",
  };
}

// ── Broker-side cleanup decision ──────────────────────────────────────────────

/**
 * Whether to attempt broker-side Guardrail rule cleanup before disconnecting.
 *
 * Cleanup is only meaningful for Tradovate accounts that have an externalAccountId
 * (required to scope the Tradovate API call) and are currently active (there are
 * live broker rules to clean up). Inactive accounts have no ongoing broker
 * enforcement to remove.
 */
export function shouldAttemptBrokerCleanup(account: {
  platform: string;
  externalAccountId: string | null;
  isActive: boolean;
}): boolean {
  return (
    account.platform === "tradovate" &&
    account.externalAccountId != null &&
    account.externalAccountId.trim() !== "" &&
    account.isActive
  );
}

// ── Broker cleanup error classification ───────────────────────────────────────

/**
 * Error class for broker cleanup failures.
 *
 *   token_invalid — the stored OAuth token is expired or missing; the broker
 *     call can never succeed with the current credentials.
 *   scope_gap — the token exists but lacks the Account Risk Settings permission
 *     needed to modify position limits. Not a connection error.
 *   other — transient network or API error; may succeed on retry.
 */
export type BrokerCleanupErrorClass = "token_invalid" | "scope_gap" | "other";

export function classifyBrokerCleanupError(err: unknown): BrokerCleanupErrorClass {
  if (err instanceof TradovateClientError) {
    switch (err.code) {
      case "NO_TOKENS":
      case "TOKEN_LOAD_FAILED":
      case "TOKEN_EXPIRED_NO_REFRESH":
      case "REFRESH_FAILED":
        return "token_invalid";
      case "API_ERROR":
        if (err.statusCode === 401 || err.statusCode === 403) return "scope_gap";
        return "other";
      default:
        return "other";
    }
  }
  return "other";
}

// ── Broker cleanup result ─────────────────────────────────────────────────────

export type BrokerCleanupResult = {
  attempted: boolean;
  succeeded: boolean;
  /** Non-null when cleanup was attempted but failed. Shown to the user so they
   *  know to check Tradovate Risk Settings manually. */
  warning: string | null;
};

export const BROKER_CLEANUP_WARNING =
  "Disconnected locally, but broker-side cleanup could not be verified. Check Tradovate Risk Settings.";

export function buildSkippedCleanupResult(): BrokerCleanupResult {
  return { attempted: false, succeeded: false, warning: null };
}

export function buildSucceededCleanupResult(): BrokerCleanupResult {
  return { attempted: true, succeeded: true, warning: null };
}

export function buildFailedCleanupResult(err: unknown): BrokerCleanupResult {
  const errorClass = classifyBrokerCleanupError(err);
  void errorClass; // class is logged by the caller; same warning regardless of class
  return { attempted: true, succeeded: false, warning: BROKER_CLEANUP_WARNING };
}

// ── Provider revocation ───────────────────────────────────────────────────────

/**
 * Whether a given platform has a known token revocation endpoint.
 *
 * Tradovate does not publish an RFC 7009 token revocation endpoint.
 * Extend this function when a platform documents a safe revocation path.
 */
export function platformHasRevocationEndpoint(platform: string): boolean {
  // Currently no supported platform provides revocation.
  void platform;
  return false;
}

/**
 * Describe the revocation outcome for safe logging.
 * Values are stable strings — not tokens or credentials.
 */
export type RevocationResult =
  | { attempted: false; succeeded: false; reason: "no_endpoint" }
  | { attempted: true; succeeded: true; reason: "ok" }
  | { attempted: true; succeeded: false; reason: "failed"; errorName: string };

export function buildNoRevocationResult(): RevocationResult {
  return { attempted: false, succeeded: false, reason: "no_endpoint" };
}
