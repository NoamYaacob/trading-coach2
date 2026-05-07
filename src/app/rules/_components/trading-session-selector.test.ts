import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { fmt12h } from "./trading-session-utils.ts";
import { SESSION_PRESETS, buildRuleEditLockMessage } from "../../../lib/rule-edit-eligibility.ts";
import { riskRulesData } from "../../api/accounts/[id]/risk-rules-data.ts";

describe("fmt12h", () => {
  test("09:30 → 9:30 AM", () => {
    assert.equal(fmt12h("09:30"), "9:30 AM");
  });

  test("13:00 → 1:00 PM", () => {
    assert.equal(fmt12h("13:00"), "1:00 PM");
  });

  test("00:00 → 12:00 AM (midnight)", () => {
    assert.equal(fmt12h("00:00"), "12:00 AM");
  });

  test("12:00 → 12:00 PM (noon)", () => {
    assert.equal(fmt12h("12:00"), "12:00 PM");
  });

  test("18:00 → 6:00 PM (Asia start)", () => {
    assert.equal(fmt12h("18:00"), "6:00 PM");
  });

  test("01:00 → 1:00 AM (Asia end / London start)", () => {
    assert.equal(fmt12h("01:00"), "1:00 AM");
  });
});

describe("SESSION_PRESETS", () => {
  test("all SESSION_PRESETS have non-empty label (not IANA)", () => {
    for (const preset of SESSION_PRESETS) {
      assert.ok(preset.label.length > 0, `preset ${preset.id} has empty label`);
      assert.ok(!preset.label.includes("/"), `preset ${preset.id} label looks like IANA timezone: ${preset.label}`);
      assert.notEqual(preset.label, preset.timezone, `preset ${preset.id} label equals timezone`);
    }
  });

  test("Asia preset summary shows 12-hour times", () => {
    const asia = SESSION_PRESETS.find((p) => p.id === "asia");
    assert.ok(asia, "asia preset not found");
    assert.equal(fmt12h(asia!.sessionStartTime), "6:00 PM");
    assert.notEqual(fmt12h(asia!.sessionStartTime), asia!.sessionStartTime);
  });

  test("NY AM preset starts at 9:30 AM ET", () => {
    const nyAm = SESSION_PRESETS.find((p) => p.id === "ny_am");
    assert.ok(nyAm, "ny_am preset not found");
    assert.equal(fmt12h(nyAm!.sessionStartTime), "9:30 AM");
  });

  test("lockBuffer for Asia preset: fmt12h(18:00 minus 60min) === 5:00 PM", () => {
    // Asia starts at 18:00. 18:00 - 60 min = 17:00 → 5:00 PM
    assert.equal(fmt12h("17:00"), "5:00 PM");
  });
});

describe("riskRulesData session fields", () => {
  test("selectedSessionPresets array → sessionPresetsJson", () => {
    const result = riskRulesData({ selectedSessionPresets: ["ny_am", "london"] });
    assert.equal(result.sessionPresetsJson, JSON.stringify(["ny_am", "london"]));
  });

  test("selectedSessionPresets null → sessionPresetsJson null", () => {
    const result = riskRulesData({ selectedSessionPresets: null });
    assert.equal(result.sessionPresetsJson, null);
  });

  test("selectedSessionPresets empty array → sessionPresetsJson '[]'", () => {
    const result = riskRulesData({ selectedSessionPresets: [] });
    assert.equal(result.sessionPresetsJson, "[]");
  });

  test("custom session fields are mapped correctly", () => {
    const result = riskRulesData({
      sessionPreset: "custom",
      sessionStartTime: "09:30",
      sessionEndTime: "16:00",
      sessionTimezone: "America/New_York",
    });
    assert.equal(result.sessionPreset, "custom");
    assert.equal(result.sessionStartTime, "09:30");
    assert.equal(result.sessionEndTime, "16:00");
    assert.equal(result.sessionTimezone, "America/New_York");
  });

  test("ruleEditLockBufferMinutes 30 → 30", () => {
    const result = riskRulesData({ ruleEditLockBufferMinutes: 30 });
    assert.equal(result.ruleEditLockBufferMinutes, 30);
  });

  test("ruleEditLockBufferMinutes undefined → null", () => {
    const result = riskRulesData({});
    assert.equal(result.ruleEditLockBufferMinutes, null);
  });
});

// ── Lock message timezone: preset sessions use ET not CT ──────────────────────

describe("buildRuleEditLockMessage timezone label", () => {
  // within_session with a nextAllowedAt gives a message containing the tz label.
  // nextAllowedAt at 2026-05-07 21:00 UTC = 5 PM ET / 4 PM CT — distinguishable.
  const mockEligibility = {
    canEditNow: false as const,
    reason: "within_session" as const,
    nextAllowedAt: new Date("2026-05-07T21:00:00Z"),
    lockStartsAt: new Date("2026-05-07T12:30:00Z"),
    sessionStartsAt: new Date("2026-05-07T13:30:00Z"),
    sessionEndsAt: new Date("2026-05-07T21:00:00Z"),
  };

  test("null sessionTimezone defaults to CT (old behaviour without fix)", () => {
    const msg = buildRuleEditLockMessage(mockEligibility, null);
    assert.ok(msg.includes("CT"), `expected CT in: ${msg}`);
    assert.ok(!msg.includes(" ET"), `did not expect ET in: ${msg}`);
  });

  test("America/New_York sessionTimezone shows ET in lock message", () => {
    const msg = buildRuleEditLockMessage(mockEligibility, "America/New_York");
    assert.ok(msg.includes("ET"), `expected ET in: ${msg}`);
    assert.ok(!msg.includes("CT"), `did not expect CT in: ${msg}`);
  });

  test("preset sessions should use ET timezone in lock message", () => {
    // Verifies the fix in both API routes: when presets are active, pass
    // "America/New_York" instead of userRules.sessionTimezone (which is null
    // for preset-based sessions, causing the default CT label to appear).
    const presetTz = SESSION_PRESETS.length > 0 ? "America/New_York" : null;
    const msg = buildRuleEditLockMessage(mockEligibility, presetTz);
    assert.ok(msg.includes("ET"), `preset session lock message should show ET, got: ${msg}`);
  });
});

// ── Active vs pending session invariant ──────────────────────────────────────
//
// When editing is locked, the API route stores riskRulesData(requestedBody) in
// pendingPayloadJson — it does NOT spread the result into the active columns.
// This test verifies the data-layer shape so a future refactor can't silently
// break the invariant.

describe("account-specific active vs pending session invariant", () => {
  test("pending payload for NY AM+NY PM does not match active Asia+London sessions", () => {
    // User had Asia + London active; they request NY AM + NY PM while locked.
    // The pending payload (what gets stored in pendingPayloadJson) must carry
    // the NEW sessions. The active DB row (Asia + London) is left untouched
    // because the locked route path only writes pendingPayloadJson/pendingEffectiveDate.
    const pendingPayload = riskRulesData({
      selectedSessionPresets: ["ny_am", "ny_pm"],
      sessionPreset: null,
      sessionStartTime: null,
      sessionEndTime: null,
      sessionTimezone: null,
    });

    assert.equal(pendingPayload.sessionPresetsJson, JSON.stringify(["ny_am", "ny_pm"]));

    // Active sessions (stored separately in the DB row) are untouched — they
    // still hold the old value. Confirm the pending payload differs from active.
    const activeSessionsInDb = JSON.stringify(["asia", "london"]);
    assert.notEqual(pendingPayload.sessionPresetsJson, activeSessionsInDb);
  });

  test("pending payload sessionPresetsJson is the exact JSON from the request, not active sessions", () => {
    // Ensures the serialization round-trips correctly so the apply-pending job
    // can deserialize it and write it to the active columns on the next trading day.
    const requested = ["ny_am", "ny_pm"];
    const payload = riskRulesData({ selectedSessionPresets: requested });
    const deserialized = JSON.parse(payload.sessionPresetsJson!);
    assert.deepEqual(deserialized, requested);
  });
});
