/**
 * Tradovate token loader — server-only helper.
 *
 * The single supported path for reading a user's stored Tradovate
 * tokens. Enforces:
 *   - Account exists.
 *   - Account belongs to the requesting user.
 *   - Account is a Tradovate connection.
 *   - Tokens are present and decryptable.
 *
 * Tokens are returned ONLY from server-side code. The `prisma` import
 * below also prevents this module from being bundled into client code.
 * Never serialise the return value into a server component prop, an
 * API JSON response, or a client cookie.
 */

import { prisma } from "@/lib/db";
import {
  parseAndDecrypt,
  TokenCryptoError,
} from "@/lib/security/token-crypto";

export type TradovateTokens = {
  accountId: string;
  /** Set when tokens live on a BrokerConnection rather than the account row. */
  brokerConnectionId: string | null;
  externalAccountId: string | null;
  accountLabel: string;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
};

export type TradovateTokenErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "WRONG_PLATFORM"
  | "NO_ACCESS_TOKEN"
  | "DECRYPT_FAILED";

export class TradovateTokenError extends Error {
  readonly code: TradovateTokenErrorCode;
  constructor(code: TradovateTokenErrorCode, message: string) {
    super(message);
    this.name = "TradovateTokenError";
    this.code = code;
  }
}

/**
 * Load and decrypt the access (and optional refresh) tokens for a
 * Tradovate ConnectedAccount. Caller must pass the userId from the
 * authenticated session — this is the ownership boundary.
 */
export async function getTradovateTokensForAccount(
  accountId: string,
  userId: string,
): Promise<TradovateTokens> {
  const account = await prisma.connectedAccount.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      userId: true,
      platform: true,
      label: true,
      externalAccountId: true,
      brokerConnectionId: true,
      accessTokenEncrypted: true,
      refreshTokenEncrypted: true,
      tokenExpiresAt: true,
    },
  });

  if (!account) {
    throw new TradovateTokenError("NOT_FOUND", "Account not found.");
  }
  if (account.userId !== userId) {
    throw new TradovateTokenError(
      "FORBIDDEN",
      "Account does not belong to the current user.",
    );
  }
  if (account.platform !== "tradovate") {
    throw new TradovateTokenError(
      "WRONG_PLATFORM",
      "Account is not a Tradovate connection.",
    );
  }

  // Prefer BrokerConnection tokens whenever brokerConnectionId is set.
  //
  // IMPORTANT: do not guard this on !account.accessTokenEncrypted.
  // The legacy OAuth callback (no setupId) writes tokens to BOTH
  // BrokerConnection and ConnectedAccount. After a token renewal,
  // #storeRefreshedTokens updates only BrokerConnection, leaving
  // ConnectedAccount.accessTokenEncrypted stale. If we read the per-account
  // column here, every sync after the first renewal uses an expired token and
  // triggers an auth_invalid → connection marked expired loop.
  if (account.brokerConnectionId) {
    const bc = await prisma.brokerConnection.findFirst({
      where: { id: account.brokerConnectionId, userId },
      select: {
        accessTokenEncrypted: true,
        refreshTokenEncrypted: true,
        tokenExpiresAt: true,
      },
    });
    if (!bc || !bc.accessTokenEncrypted) {
      throw new TradovateTokenError(
        "NO_ACCESS_TOKEN",
        "Broker connection has no stored access token.",
      );
    }
    let accessToken: string;
    try {
      accessToken = parseAndDecrypt(bc.accessTokenEncrypted);
    } catch (err) {
      const code = err instanceof TokenCryptoError ? err.code : "unknown";
      throw new TradovateTokenError(
        "DECRYPT_FAILED",
        `Failed to decrypt broker-connection access token (${code}).`,
      );
    }
    let refreshToken: string | null = null;
    if (bc.refreshTokenEncrypted) {
      try {
        refreshToken = parseAndDecrypt(bc.refreshTokenEncrypted);
      } catch (err) {
        const code = err instanceof TokenCryptoError ? err.code : "unknown";
        console.error(
          `[tradovate] broker-connection refresh token decrypt failed for account ${account.id}: ${code}`,
        );
      }
    }
    return {
      accountId: account.id,
      brokerConnectionId: account.brokerConnectionId,
      externalAccountId: account.externalAccountId,
      accountLabel: account.label,
      accessToken,
      refreshToken,
      tokenExpiresAt: bc.tokenExpiresAt,
    };
  }

  // Legacy path: per-account token columns.
  if (!account.accessTokenEncrypted) {
    throw new TradovateTokenError(
      "NO_ACCESS_TOKEN",
      "Account has no stored access token.",
    );
  }

  let accessToken: string;
  try {
    accessToken = parseAndDecrypt(account.accessTokenEncrypted);
  } catch (err) {
    // Surface a generic message to the caller; never leak ciphertext.
    const code =
      err instanceof TokenCryptoError ? err.code : "unknown";
    throw new TradovateTokenError(
      "DECRYPT_FAILED",
      `Failed to decrypt access token (${code}).`,
    );
  }

  let refreshToken: string | null = null;
  if (account.refreshTokenEncrypted) {
    try {
      refreshToken = parseAndDecrypt(account.refreshTokenEncrypted);
    } catch (err) {
      // Refresh token is optional. If we can't decrypt it, log the
      // failure category (not the value) and continue with access token
      // only — caller can re-trigger OAuth.
      const code = err instanceof TokenCryptoError ? err.code : "unknown";
      console.error(
        `[tradovate] refresh token decrypt failed for account ${account.id}: ${code}`,
      );
    }
  }

  return {
    accountId: account.id,
    brokerConnectionId: null,
    externalAccountId: account.externalAccountId,
    accountLabel: account.label,
    accessToken,
    refreshToken,
    tokenExpiresAt: account.tokenExpiresAt,
  };
}

/**
 * True when the account has any encrypted tokens stored. Cheap check
 * for UI surfaces ("show 'Reauthorize' button when expired").
 */
export async function accountHasTradovateTokens(
  accountId: string,
  userId: string,
): Promise<boolean> {
  const account = await prisma.connectedAccount.findUnique({
    where: { id: accountId },
    select: {
      userId: true,
      platform: true,
      accessTokenEncrypted: true,
    },
  });
  if (!account) return false;
  if (account.userId !== userId) return false;
  if (account.platform !== "tradovate") return false;
  return Boolean(account.accessTokenEncrypted);
}
