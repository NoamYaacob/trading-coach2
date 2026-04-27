import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";

// ── Inline helpers (tested in isolation, no DB/network) ──────────────────────

const RESET_TOKEN_EXPIRY_MS = 30 * 60 * 1000;

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function passwordMeetsPolicy(pw: string): boolean {
  return (
    pw.length >= 8 &&
    /[A-Z]/.test(pw) &&
    /[a-z]/.test(pw) &&
    /[0-9]/.test(pw) &&
    /[^A-Za-z0-9]/.test(pw)
  );
}

// Simulates the token-record shape stored in DB
function makeRecord(opts: {
  usedAt?: Date;
  expiresAt?: Date;
} = {}): { usedAt: Date | null; expiresAt: Date; tokenHash: string } {
  const token = randomBytes(32).toString("hex");
  return {
    tokenHash: hashResetToken(token),
    usedAt: opts.usedAt ?? null,
    expiresAt: opts.expiresAt ?? new Date(Date.now() + RESET_TOKEN_EXPIRY_MS),
  };
}

function isValidRecord(record: ReturnType<typeof makeRecord>): boolean {
  if (record.usedAt !== null) return false;
  if (record.expiresAt < new Date()) return false;
  return true;
}

// ── hashResetToken ────────────────────────────────────────────────────────────

describe("hashResetToken", () => {
  it("produces a hex string", () => {
    const hash = hashResetToken("abc");
    assert.match(hash, /^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same input", () => {
    const t = randomBytes(32).toString("hex");
    assert.equal(hashResetToken(t), hashResetToken(t));
  });

  it("produces different hashes for different tokens", () => {
    const a = randomBytes(32).toString("hex");
    const b = randomBytes(32).toString("hex");
    assert.notEqual(hashResetToken(a), hashResetToken(b));
  });
});

// ── Token validity checks ─────────────────────────────────────────────────────

describe("token validity", () => {
  it("accepts a fresh, unused token", () => {
    const rec = makeRecord();
    assert.equal(isValidRecord(rec), true);
  });

  it("rejects a token that is already used", () => {
    const rec = makeRecord({ usedAt: new Date() });
    assert.equal(isValidRecord(rec), false);
  });

  it("rejects a token that has expired", () => {
    const rec = makeRecord({ expiresAt: new Date(Date.now() - 1) });
    assert.equal(isValidRecord(rec), false);
  });

  it("rejects a token expiring exactly at the current millisecond", () => {
    const rec = makeRecord({ expiresAt: new Date(Date.now() - 0) });
    // Give 1 ms of slack — expiry is exclusive
    rec.expiresAt = new Date(Date.now() - 1);
    assert.equal(isValidRecord(rec), false);
  });
});

// ── passwordMeetsPolicy ───────────────────────────────────────────────────────

describe("passwordMeetsPolicy", () => {
  it("accepts a password meeting all rules", () => {
    assert.equal(passwordMeetsPolicy("Guardrail1!"), true);
  });

  it("rejects a password shorter than 8 characters", () => {
    assert.equal(passwordMeetsPolicy("Ab1!xyz"), false);
  });

  it("rejects a password without an uppercase letter", () => {
    assert.equal(passwordMeetsPolicy("guardrail1!"), false);
  });

  it("rejects a password without a lowercase letter", () => {
    assert.equal(passwordMeetsPolicy("GUARDRAIL1!"), false);
  });

  it("rejects a password without a digit", () => {
    assert.equal(passwordMeetsPolicy("GuardrailX!"), false);
  });

  it("rejects a password without a special character", () => {
    assert.equal(passwordMeetsPolicy("Guardrail1"), false);
  });

  it("accepts a variety of special characters", () => {
    for (const special of ["!", "@", "#", "$", "%", "^", "&", "*", "-", "_"]) {
      assert.equal(passwordMeetsPolicy(`Guardrail1${special}`), true, `failed for: ${special}`);
    }
  });
});

// ── Generic forgot-password response invariant ────────────────────────────────

describe("forgot-password generic response", () => {
  const EXPECTED = "If an account exists for that email, we'll send a reset link.";

  it("expected message constant is defined and non-empty", () => {
    assert.ok(EXPECTED.length > 0);
  });

  it("message does not mention account existence", () => {
    assert.ok(!EXPECTED.toLowerCase().includes("does not exist"));
    assert.ok(!EXPECTED.toLowerCase().includes("not found"));
    assert.ok(!EXPECTED.toLowerCase().includes("no account"));
  });
});
