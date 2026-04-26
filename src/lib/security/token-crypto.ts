/**
 * Token encryption — AES-256-GCM keyed by TRADOVATE_TOKEN_ENCRYPTION_KEY.
 *
 * Used to encrypt OAuth access/refresh tokens at rest in the
 * ConnectedAccount table. Plaintext tokens MUST never be persisted or
 * logged; this module is the only path through which tokens are written
 * to the database.
 *
 * Key format:
 *   TRADOVATE_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.
 *   Generate with `openssl rand -base64 32`. Decoded length is enforced
 *   on every call — wrong length throws KEY_LENGTH.
 *
 * Storage format (TEXT column):
 *   JSON-serialized { v, iv, ct, tag } where:
 *     v   = format version (1)
 *     iv  = base64 12-byte GCM nonce
 *     ct  = base64 ciphertext
 *     tag = base64 16-byte GCM auth tag
 *
 * Errors are typed (TokenCryptoError) with a `code` field — callers
 * surface the code, never the message contents, to the user.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length
const KEY_BYTES = 32;
const VERSION = 1;

export type EncryptedPayload = {
  v: number;
  iv: string;
  ct: string;
  tag: string;
};

export type TokenCryptoErrorCode =
  | "KEY_MISSING"
  | "KEY_INVALID"
  | "KEY_LENGTH"
  | "PLAINTEXT_EMPTY"
  | "PAYLOAD_INVALID"
  | "PAYLOAD_VERSION"
  | "PAYLOAD_FIELDS"
  | "PAYLOAD_DECODE"
  | "PAYLOAD_IV_LENGTH"
  | "PAYLOAD_PARSE"
  | "DECRYPT_FAILED";

export class TokenCryptoError extends Error {
  readonly code: TokenCryptoErrorCode;
  constructor(code: TokenCryptoErrorCode, message: string) {
    super(message);
    this.name = "TokenCryptoError";
    this.code = code;
  }
}

/**
 * Loads and validates the master key from the environment. Never logs
 * the key. Throws a typed error on every failure mode.
 */
function loadKey(): Buffer {
  const raw = process.env.TRADOVATE_TOKEN_ENCRYPTION_KEY;
  if (!raw || raw.trim().length === 0) {
    throw new TokenCryptoError(
      "KEY_MISSING",
      "TRADOVATE_TOKEN_ENCRYPTION_KEY is not set.",
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw.trim(), "base64");
  } catch {
    throw new TokenCryptoError(
      "KEY_INVALID",
      "TRADOVATE_TOKEN_ENCRYPTION_KEY is not valid base64.",
    );
  }
  if (key.length !== KEY_BYTES) {
    throw new TokenCryptoError(
      "KEY_LENGTH",
      `TRADOVATE_TOKEN_ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (got ${key.length}).`,
    );
  }
  return key;
}

/**
 * Returns true when the configured key is valid. Used by health checks
 * and the connect-page readiness gate so the UI can fail fast without
 * encrypting probe data.
 */
export function isTokenEncryptionKeyValid(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

/**
 * Encrypt a plaintext token with a fresh random IV. Returns the
 * structured payload — call serializeEncryptedPayload() before writing
 * to a TEXT column.
 */
export function encryptToken(plaintext: string): EncryptedPayload {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new TokenCryptoError(
      "PLAINTEXT_EMPTY",
      "Cannot encrypt empty plaintext.",
    );
  }
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    v: VERSION,
    iv: iv.toString("base64"),
    ct: ct.toString("base64"),
    tag: tag.toString("base64"),
  };
}

/**
 * Decrypt a payload back into the original plaintext token. Throws on
 * any tampering or key mismatch — GCM's auth tag guarantees integrity.
 */
export function decryptToken(payload: EncryptedPayload): string {
  if (!payload || typeof payload !== "object") {
    throw new TokenCryptoError(
      "PAYLOAD_INVALID",
      "Encrypted payload is missing or not an object.",
    );
  }
  if (payload.v !== VERSION) {
    throw new TokenCryptoError(
      "PAYLOAD_VERSION",
      `Unsupported encrypted payload version ${payload.v}.`,
    );
  }
  if (
    typeof payload.iv !== "string" ||
    typeof payload.ct !== "string" ||
    typeof payload.tag !== "string"
  ) {
    throw new TokenCryptoError(
      "PAYLOAD_FIELDS",
      "Encrypted payload is missing iv/ct/tag.",
    );
  }

  const key = loadKey();

  let iv: Buffer;
  let ct: Buffer;
  let tag: Buffer;
  try {
    iv = Buffer.from(payload.iv, "base64");
    ct = Buffer.from(payload.ct, "base64");
    tag = Buffer.from(payload.tag, "base64");
  } catch {
    throw new TokenCryptoError(
      "PAYLOAD_DECODE",
      "Encrypted payload is not valid base64.",
    );
  }
  if (iv.length !== IV_BYTES) {
    throw new TokenCryptoError(
      "PAYLOAD_IV_LENGTH",
      `IV must be ${IV_BYTES} bytes (got ${iv.length}).`,
    );
  }

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    // Do NOT include any payload bytes in the error message.
    throw new TokenCryptoError(
      "DECRYPT_FAILED",
      "Failed to decrypt token (key mismatch, tampered ciphertext, or corrupted IV/tag).",
    );
  }
}

/** Serialize for TEXT-column storage. */
export function serializeEncryptedPayload(payload: EncryptedPayload): string {
  return JSON.stringify(payload);
}

/** Parse from TEXT-column storage. Throws on invalid JSON. */
export function parseEncryptedPayload(s: string): EncryptedPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    throw new TokenCryptoError(
      "PAYLOAD_PARSE",
      "Encrypted payload is not valid JSON.",
    );
  }
  return parsed as EncryptedPayload;
}

/** One-shot helper: encrypt + serialize. */
export function encryptAndSerialize(plaintext: string): string {
  return serializeEncryptedPayload(encryptToken(plaintext));
}

/** One-shot helper: parse + decrypt. */
export function parseAndDecrypt(serialized: string): string {
  return decryptToken(parseEncryptedPayload(serialized));
}
