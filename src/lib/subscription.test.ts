/**
 * Unit tests for the subscription / bot-access gate (src/lib/subscription.ts).
 *
 * Pure-function tests — no DB, no network. The gate reads BILLING_ENABLED and
 * ADMIN_EMAILS from process.env, so each test brackets its own env via withEnv.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SubscriptionStatus } from "@prisma/client";

import { hasBotAccess, isBillingEnabled, isAdminEmail } from "./subscription.ts";

const DAY_MS = 86_400_000;
const FUTURE = new Date(Date.now() + DAY_MS);
const PAST = new Date(Date.now() - DAY_MS);

/** Run `fn` with the given env vars set, then restore the prior values. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

// ── isBillingEnabled ──────────────────────────────────────────────────────────

describe("isBillingEnabled", () => {
  it("is true only when BILLING_ENABLED is exactly 'true'", () => {
    withEnv({ BILLING_ENABLED: "true" }, () => assert.equal(isBillingEnabled(), true));
    withEnv({ BILLING_ENABLED: "false" }, () => assert.equal(isBillingEnabled(), false));
    withEnv({ BILLING_ENABLED: "1" }, () => assert.equal(isBillingEnabled(), false));
    withEnv({ BILLING_ENABLED: undefined }, () => assert.equal(isBillingEnabled(), false));
  });
});

// ── isAdminEmail ──────────────────────────────────────────────────────────────

describe("isAdminEmail", () => {
  it("matches comma-separated ADMIN_EMAILS case-insensitively", () => {
    withEnv({ ADMIN_EMAILS: "a@x.com, B@x.com" }, () => {
      assert.equal(isAdminEmail("a@x.com"), true);
      assert.equal(isAdminEmail("A@X.COM"), true);
      assert.equal(isAdminEmail("b@x.com"), true);
      assert.equal(isAdminEmail("c@x.com"), false);
    });
  });

  it("is false when ADMIN_EMAILS is empty or unset", () => {
    withEnv({ ADMIN_EMAILS: "" }, () => assert.equal(isAdminEmail("a@x.com"), false));
    withEnv({ ADMIN_EMAILS: undefined }, () => assert.equal(isAdminEmail("a@x.com"), false));
  });
});

// ── hasBotAccess — billing disabled (default beta posture) ───────────────────

describe("hasBotAccess — billing disabled", () => {
  it("grants access to everyone regardless of subscription status", () => {
    withEnv({ BILLING_ENABLED: "false", ADMIN_EMAILS: "" }, () => {
      assert.equal(hasBotAccess(SubscriptionStatus.INACTIVE, null), true);
      assert.equal(hasBotAccess(SubscriptionStatus.CANCELED, null), true);
      assert.equal(hasBotAccess(SubscriptionStatus.TRIALING, PAST), true);
      assert.equal(hasBotAccess(SubscriptionStatus.ACTIVE, null), true);
    });
  });
});

// ── hasBotAccess — billing enabled ───────────────────────────────────────────

describe("hasBotAccess — billing enabled", () => {
  it("grants an ACTIVE subscription", () => {
    withEnv({ BILLING_ENABLED: "true", ADMIN_EMAILS: "" }, () => {
      assert.equal(hasBotAccess(SubscriptionStatus.ACTIVE, null), true);
    });
  });

  it("grants TRIALING with a future trialEndsAt", () => {
    withEnv({ BILLING_ENABLED: "true", ADMIN_EMAILS: "" }, () => {
      assert.equal(hasBotAccess(SubscriptionStatus.TRIALING, FUTURE), true);
    });
  });

  it("blocks TRIALING with a past or null trialEndsAt", () => {
    withEnv({ BILLING_ENABLED: "true", ADMIN_EMAILS: "" }, () => {
      assert.equal(hasBotAccess(SubscriptionStatus.TRIALING, PAST), false);
      assert.equal(hasBotAccess(SubscriptionStatus.TRIALING, null), false);
    });
  });

  it("blocks INACTIVE and CANCELED even with a future date", () => {
    withEnv({ BILLING_ENABLED: "true", ADMIN_EMAILS: "" }, () => {
      assert.equal(hasBotAccess(SubscriptionStatus.INACTIVE, FUTURE), false);
      assert.equal(hasBotAccess(SubscriptionStatus.CANCELED, FUTURE), false);
    });
  });

  it("an admin email bypasses the gate even when the status is blocked", () => {
    withEnv({ BILLING_ENABLED: "true", ADMIN_EMAILS: "admin@x.com" }, () => {
      assert.equal(hasBotAccess(SubscriptionStatus.CANCELED, null, "admin@x.com"), true);
      assert.equal(hasBotAccess(SubscriptionStatus.INACTIVE, null, "ADMIN@X.COM"), true);
    });
  });

  it("a non-admin email does not bypass the gate", () => {
    withEnv({ BILLING_ENABLED: "true", ADMIN_EMAILS: "admin@x.com" }, () => {
      assert.equal(hasBotAccess(SubscriptionStatus.CANCELED, null, "user@x.com"), false);
    });
  });
});
