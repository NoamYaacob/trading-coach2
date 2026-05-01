/**
 * Pure helpers for broker account disconnection.
 *
 * No DB calls here — only payload builders and status helpers.
 * This separation makes the logic unit-testable without a database.
 */

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
