import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  AUTOMATED_ACTIONS_CONSENT_TEXT,
  AUTOMATED_ACTIONS_CONSENT_VERSION,
  CONSENT_ACTION_REQUIRED_BANNER,
  CONSENT_MISSING_MESSAGE,
  decideConsentGate,
  hasValidConsent,
  resolveConsentForAccount,
} from "./automated-actions-consent.ts";

// ── hasValidConsent ───────────────────────────────────────────────────────────

describe("hasValidConsent", () => {
  it("null consentAt → false (never recorded)", () => {
    assert.equal(
      hasValidConsent({ consentAt: null, consentVersion: null }),
      false,
    );
  });

  it("consentAt set + null version → false (legacy/corrupt row, must re-confirm)", () => {
    assert.equal(
      hasValidConsent({ consentAt: new Date(), consentVersion: null }),
      false,
    );
  });

  it("consentAt set + outdated version → false (consent superseded)", () => {
    assert.equal(
      hasValidConsent({
        consentAt: new Date("2026-01-01T00:00:00Z"),
        consentVersion: "2025-old-version",
      }),
      false,
    );
  });

  it("consentAt set + current version → true", () => {
    assert.equal(
      hasValidConsent({
        consentAt: new Date(),
        consentVersion: AUTOMATED_ACTIONS_CONSENT_VERSION,
      }),
      true,
    );
  });

  it("very old timestamp + current version → true (no recency requirement)", () => {
    // The version bump is the supersedure mechanism; we don't expire by time.
    // If a future requirement adds expiry, the version bump captures it.
    assert.equal(
      hasValidConsent({
        consentAt: new Date("2020-01-01T00:00:00Z"),
        consentVersion: AUTOMATED_ACTIONS_CONSENT_VERSION,
      }),
      true,
    );
  });
});

// ── resolveConsentForAccount ──────────────────────────────────────────────────

describe("resolveConsentForAccount", () => {
  const valid = {
    consentAt: new Date(),
    consentVersion: AUTOMATED_ACTIONS_CONSENT_VERSION,
  };
  const empty = { consentAt: null, consentVersion: null };

  it("account-specific consent overrides default (account is the source of truth when set)", () => {
    const r = resolveConsentForAccount({
      accountRiskRules: valid,
      defaultRiskRules: empty,
    });
    assert.equal(r.source, "account");
    assert.equal(r.state.consentAt, valid.consentAt);
  });

  it("falls back to default when account row missing", () => {
    const r = resolveConsentForAccount({
      accountRiskRules: null,
      defaultRiskRules: valid,
    });
    assert.equal(r.source, "default");
    assert.equal(r.state.consentAt, valid.consentAt);
  });

  it("returns 'none' when both are missing", () => {
    const r = resolveConsentForAccount({
      accountRiskRules: null,
      defaultRiskRules: null,
    });
    assert.equal(r.source, "none");
    assert.equal(r.state.consentAt, null);
    assert.equal(r.state.consentVersion, null);
  });

  it("account row with empty consent does NOT fall through to default (account record exists, just hasn't consented)", () => {
    // This is the critical case: an account-specific rule row exists but the
    // user never checked the consent box for it. We must NOT silently use
    // the default template's consent — the user is explicitly opting this
    // account out by not checking the box on the account-specific form.
    const r = resolveConsentForAccount({
      accountRiskRules: empty,
      defaultRiskRules: valid,
    });
    assert.equal(r.source, "account");
    assert.equal(r.state.consentAt, null);
  });
});

// ── consent text + copy constants ─────────────────────────────────────────────

describe("consent text constants", () => {
  it("AUTOMATED_ACTIONS_CONSENT_VERSION is non-empty", () => {
    assert.ok(AUTOMATED_ACTIONS_CONSENT_VERSION.length > 0);
  });

  it("AUTOMATED_ACTIONS_CONSENT_TEXT mentions automatic locking", () => {
    assert.ok(
      AUTOMATED_ACTIONS_CONSENT_TEXT.toLowerCase().includes("automatically lock"),
      `expected 'automatically lock' in consent text, got: ${AUTOMATED_ACTIONS_CONSENT_TEXT}`,
    );
  });

  it("AUTOMATED_ACTIONS_CONSENT_TEXT mentions closing positions", () => {
    assert.ok(
      AUTOMATED_ACTIONS_CONSENT_TEXT.toLowerCase().includes("close open positions"),
    );
  });

  it("CONSENT_MISSING_MESSAGE matches the required user-facing copy ('Broker action unavailable')", () => {
    assert.ok(
      CONSENT_MISSING_MESSAGE.includes("Broker action unavailable"),
      `expected 'Broker action unavailable' in message, got: ${CONSENT_MISSING_MESSAGE}`,
    );
    assert.ok(
      CONSENT_MISSING_MESSAGE.toLowerCase().includes("consent required"),
    );
  });

  it("CONSENT_ACTION_REQUIRED_BANNER starts with 'Action required'", () => {
    assert.ok(
      CONSENT_ACTION_REQUIRED_BANNER.startsWith("Action required"),
      `expected banner to start with 'Action required', got: ${CONSENT_ACTION_REQUIRED_BANNER}`,
    );
  });

  it("banner mentions the user must confirm consent", () => {
    assert.ok(
      CONSENT_ACTION_REQUIRED_BANNER.toLowerCase().includes("confirm"),
    );
  });
});

// ── decideConsentGate (live-readiness contract) ───────────────────────────────
//
// These tests document the safety contract that applyBrokerDayLockout enforces
// via this helper: no real Tradovate write proceeds unless persisted consent
// exists at the current version. The helper deliberately does NOT consider
// dry-run, permissionLevel, or connectionStatus — those gates are checked
// elsewhere. The composition is the safety guarantee:
//
//   Tradovate write attempted IFF
//     shouldSkipBrokerEnforcement.skip === false
//     AND decideConsentGate.allowed === true
//     AND isEnforcementDryRun() === false

describe("decideConsentGate (broker-write consent gate)", () => {
  const valid = {
    consentAt: new Date(),
    consentVersion: AUTOMATED_ACTIONS_CONSENT_VERSION,
  };
  const empty = { consentAt: null, consentVersion: null };
  const oldVersion = {
    consentAt: new Date(),
    consentVersion: "2025-old-version-v0",
  };

  it("no persisted consent at all → blocked with reason='missing'", () => {
    // The "existing account without consent" case the user listed: pre-feature
    // accounts have null/null and must not silently send broker writes.
    const decision = decideConsentGate({
      accountRiskRules: null,
      defaultRiskRules: null,
    });
    assert.equal(decision.allowed, false);
    if (!decision.allowed) {
      assert.equal(decision.lockStatus, "unavailable_consent_missing");
      assert.equal(decision.flattenStatus, "unavailable_consent_missing");
      assert.equal(decision.reason, "missing");
    }
  });

  it("account-specific consent valid → allowed (source='account')", () => {
    const decision = decideConsentGate({
      accountRiskRules: valid,
      defaultRiskRules: null,
    });
    assert.equal(decision.allowed, true);
    if (decision.allowed) assert.equal(decision.source, "account");
  });

  it("default-template consent valid + no account-specific row → allowed (source='default')", () => {
    const decision = decideConsentGate({
      accountRiskRules: null,
      defaultRiskRules: valid,
    });
    assert.equal(decision.allowed, true);
    if (decision.allowed) assert.equal(decision.source, "default");
  });

  it("account-specific row with empty consent does NOT fall back to default → blocked", () => {
    // Critical: an account-specific rule row exists but the user never checked
    // consent on it. Defaulting to the template's consent here would silently
    // enable broker writes on accounts the user never consented for.
    const decision = decideConsentGate({
      accountRiskRules: empty,
      defaultRiskRules: valid,
    });
    assert.equal(decision.allowed, false);
  });

  it("version mismatch → blocked with reason='version_mismatch'", () => {
    // Release that bumps AUTOMATED_ACTIONS_CONSENT_VERSION must re-prompt
    // every user — old consent is treated as missing, but with a distinct
    // reason so audit logs can tell "never consented" from "consent expired".
    const decision = decideConsentGate({
      accountRiskRules: oldVersion,
      defaultRiskRules: null,
    });
    assert.equal(decision.allowed, false);
    if (!decision.allowed) {
      assert.equal(decision.reason, "version_mismatch");
    }
  });

  it("permission upgrade scenario: consent must be valid even when full_access is granted later", () => {
    // The user-listed scenario: a connection upgrades from read_only to
    // full_access via a re-probe. decideConsentGate doesn't consult
    // permissionLevel — it only looks at consent. So even after the upgrade,
    // a missing consent still blocks (the permissionLevel check is upstream).
    const decision = decideConsentGate({
      accountRiskRules: empty,
      defaultRiskRules: empty,
    });
    assert.equal(decision.allowed, false);
  });

  it("blocked decisions return the user-facing 'Broker action unavailable' message", () => {
    const decision = decideConsentGate({
      accountRiskRules: null,
      defaultRiskRules: null,
    });
    assert.equal(decision.allowed, false);
    if (!decision.allowed) {
      assert.ok(decision.message.includes("Broker action unavailable"));
      assert.ok(decision.message.toLowerCase().includes("consent"));
    }
  });

  it("internal-lock invariant: this gate only governs broker writes, not internal Guardrail lock", () => {
    // Documents that decideConsentGate returns a lockStatus / flattenStatus
    // intended for the broker-write outcome only. The caller still records
    // the breach to GuardianIntervention and applies riskState=STOPPED — the
    // internal lock is independent of broker-write consent.
    const decision = decideConsentGate({
      accountRiskRules: null,
      defaultRiskRules: null,
    });
    // The shape returned describes the broker outcome; there is no
    // "skipInternalLock" flag — internal lock is always applied upstream.
    if (!decision.allowed) {
      assert.equal(decision.lockStatus, "unavailable_consent_missing");
      assert.equal(decision.flattenStatus, "unavailable_consent_missing");
    }
  });
});
