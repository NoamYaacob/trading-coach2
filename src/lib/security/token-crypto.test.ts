import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import {
  decryptToken,
  encryptAndSerialize,
  encryptToken,
  isTokenEncryptionKeyValid,
  parseAndDecrypt,
  parseEncryptedPayload,
  serializeEncryptedPayload,
  TokenCryptoError,
} from "./token-crypto.ts";

const VALID_KEY = randomBytes(32).toString("base64");
const ANOTHER_KEY = randomBytes(32).toString("base64");

/**
 * Run a test body with a specific TRADOVATE_TOKEN_ENCRYPTION_KEY value
 * (or unset) and restore whatever was there before. We never log the
 * key value — only its presence.
 */
function withKey(key: string | undefined, fn: () => void) {
  const before = process.env.TRADOVATE_TOKEN_ENCRYPTION_KEY;
  if (key === undefined) delete process.env.TRADOVATE_TOKEN_ENCRYPTION_KEY;
  else process.env.TRADOVATE_TOKEN_ENCRYPTION_KEY = key;
  try {
    fn();
  } finally {
    if (before === undefined) delete process.env.TRADOVATE_TOKEN_ENCRYPTION_KEY;
    else process.env.TRADOVATE_TOKEN_ENCRYPTION_KEY = before;
  }
}

test("encrypt/decrypt round trip preserves plaintext", () => {
  withKey(VALID_KEY, () => {
    const plaintext = "tradovate-access-token-abc123";
    const payload = encryptToken(plaintext);
    assert.equal(payload.v, 1);
    assert.ok(payload.iv.length > 0, "iv should be populated");
    assert.ok(payload.ct.length > 0, "ct should be populated");
    assert.ok(payload.tag.length > 0, "tag should be populated");
    const recovered = decryptToken(payload);
    assert.equal(recovered, plaintext);
  });
});

test("ciphertext differs across encrypts (random IV)", () => {
  withKey(VALID_KEY, () => {
    const a = encryptToken("same-plaintext");
    const b = encryptToken("same-plaintext");
    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.ct, b.ct);
    assert.notEqual(a.tag, b.tag);
  });
});

test("decrypt with a different key throws DECRYPT_FAILED", () => {
  let payload: ReturnType<typeof encryptToken>;
  withKey(VALID_KEY, () => {
    payload = encryptToken("secret");
  });
  withKey(ANOTHER_KEY, () => {
    assert.throws(
      () => decryptToken(payload),
      (err: unknown) =>
        err instanceof TokenCryptoError && err.code === "DECRYPT_FAILED",
    );
  });
});

test("tampered ciphertext throws DECRYPT_FAILED", () => {
  withKey(VALID_KEY, () => {
    const payload = encryptToken("secret");
    // Flip a byte in the tag.
    const tag = Buffer.from(payload.tag, "base64");
    tag[0] = tag[0] ^ 0xff;
    payload.tag = tag.toString("base64");
    assert.throws(
      () => decryptToken(payload),
      (err: unknown) =>
        err instanceof TokenCryptoError && err.code === "DECRYPT_FAILED",
    );
  });
});

test("malformed payload (missing fields) throws PAYLOAD_FIELDS", () => {
  withKey(VALID_KEY, () => {
    assert.throws(
      () =>
        decryptToken({
          v: 1,
          iv: "x",
          // ct missing
          tag: "y",
        } as unknown as ReturnType<typeof encryptToken>),
      (err: unknown) =>
        err instanceof TokenCryptoError && err.code === "PAYLOAD_FIELDS",
    );
  });
});

test("malformed payload (wrong version) throws PAYLOAD_VERSION", () => {
  withKey(VALID_KEY, () => {
    const payload = encryptToken("secret");
    const bad = { ...payload, v: 99 };
    assert.throws(
      () => decryptToken(bad),
      (err: unknown) =>
        err instanceof TokenCryptoError && err.code === "PAYLOAD_VERSION",
    );
  });
});

test("malformed JSON in serialized payload throws PAYLOAD_PARSE", () => {
  withKey(VALID_KEY, () => {
    assert.throws(
      () => parseEncryptedPayload("not-json"),
      (err: unknown) =>
        err instanceof TokenCryptoError && err.code === "PAYLOAD_PARSE",
    );
  });
});

test("missing key throws KEY_MISSING on encrypt", () => {
  withKey(undefined, () => {
    assert.throws(
      () => encryptToken("secret"),
      (err: unknown) =>
        err instanceof TokenCryptoError && err.code === "KEY_MISSING",
    );
  });
});

test("missing key throws KEY_MISSING on decrypt", () => {
  let payload: ReturnType<typeof encryptToken>;
  withKey(VALID_KEY, () => {
    payload = encryptToken("secret");
  });
  withKey(undefined, () => {
    assert.throws(
      () => decryptToken(payload),
      (err: unknown) =>
        err instanceof TokenCryptoError && err.code === "KEY_MISSING",
    );
  });
});

test("short key (16 bytes base64) throws KEY_LENGTH", () => {
  const tooShort = randomBytes(16).toString("base64");
  withKey(tooShort, () => {
    assert.throws(
      () => encryptToken("secret"),
      (err: unknown) =>
        err instanceof TokenCryptoError && err.code === "KEY_LENGTH",
    );
  });
});

test("oversized key (64 bytes base64) throws KEY_LENGTH", () => {
  const tooLong = randomBytes(64).toString("base64");
  withKey(tooLong, () => {
    assert.throws(
      () => encryptToken("secret"),
      (err: unknown) =>
        err instanceof TokenCryptoError && err.code === "KEY_LENGTH",
    );
  });
});

test("empty plaintext throws PLAINTEXT_EMPTY", () => {
  withKey(VALID_KEY, () => {
    assert.throws(
      () => encryptToken(""),
      (err: unknown) =>
        err instanceof TokenCryptoError && err.code === "PLAINTEXT_EMPTY",
    );
  });
});

test("serialize/parse round trip via storage path", () => {
  withKey(VALID_KEY, () => {
    const plaintext = "refresh-token-xyz";
    const stored = encryptAndSerialize(plaintext);
    assert.equal(typeof stored, "string");
    // The serialized form must not contain the plaintext anywhere.
    assert.equal(
      stored.includes(plaintext),
      false,
      "serialized payload must not contain plaintext",
    );
    const recovered = parseAndDecrypt(stored);
    assert.equal(recovered, plaintext);
  });
});

test("serialize -> parse -> decrypt with same payload object", () => {
  withKey(VALID_KEY, () => {
    const payload = encryptToken("plain");
    const s = serializeEncryptedPayload(payload);
    const reparsed = parseEncryptedPayload(s);
    assert.equal(decryptToken(reparsed), "plain");
  });
});

test("isTokenEncryptionKeyValid reflects env state", () => {
  withKey(VALID_KEY, () => {
    assert.equal(isTokenEncryptionKeyValid(), true);
  });
  withKey(undefined, () => {
    assert.equal(isTokenEncryptionKeyValid(), false);
  });
  withKey(randomBytes(8).toString("base64"), () => {
    assert.equal(isTokenEncryptionKeyValid(), false);
  });
});
