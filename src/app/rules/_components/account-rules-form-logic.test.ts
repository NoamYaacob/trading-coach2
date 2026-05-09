import test from "node:test";
import assert from "node:assert/strict";

import {
  computeAccountRulesBanner,
  computeAccountSaveButtonState,
  computePendingFieldRows,
  computeShowPendingPanel,
  canSaveAccountRulesNow,
  mapDefaultRulesToAccountForm,
  FIRST_TIME_SETUP_BANNER,
  LOCKED_BANNER,
  REVIEW_INHERITED_HINT,
  type PendingDiffActiveBaseline,
} from "./account-rules-form-logic.ts";

const baseSaveInput = {
  isDirty: false,
  saving: false,
  removing: false,
  hasExistingRules: true,
  hasValidConsent: true,
  consentChecked: false,
  savedAt: null,
  pendingMessage: null,
} as const;

// ─── canSaveAccountRulesNow ───────────────────────────────────────────────────

test("new account (no existing rules) can save immediately even when locked", () => {
  assert.equal(canSaveAccountRulesNow(false, true), true);
});

test("new account (no existing rules) can save immediately when not locked", () => {
  assert.equal(canSaveAccountRulesNow(false, false), true);
});

test("existing account with rules defers save when locked", () => {
  assert.equal(canSaveAccountRulesNow(true, true), false);
});

test("existing account with rules can save immediately when not locked", () => {
  assert.equal(canSaveAccountRulesNow(true, false), true);
});

test("first-time exception cannot be used to bypass lock on an account that already has rules", () => {
  // hasExistingRules=true — lock must be respected regardless of any first-time claim
  assert.equal(canSaveAccountRulesNow(true, true), false);
});

test("pending_decision / newly-added account (no existing rules) first setup applies immediately", () => {
  // pending_decision accounts have no account-specific rules yet → first-time path
  const hasExistingRules = false;
  const isLocked = true;
  assert.equal(canSaveAccountRulesNow(hasExistingRules, isLocked), true);
});

// ─── computeAccountRulesBanner ────────────────────────────────────────────────

test("form not shown: banner is none regardless of lock or rules state", () => {
  assert.equal(computeAccountRulesBanner(false, true, false).kind, "none");
  assert.equal(computeAccountRulesBanner(true, true, false).kind, "none");
});

test("first-time setup: shows first_time banner, not locked banner", () => {
  const banner = computeAccountRulesBanner(false, true, true);
  assert.equal(banner.kind, "first_time");
});

test("first-time setup: banner message says First-time setup and immediate", () => {
  const banner = computeAccountRulesBanner(false, true, true);
  assert.ok(banner.kind === "first_time");
  assert.ok(banner.message.includes("First-time setup"));
  assert.ok(banner.message.includes("immediately"));
  assert.equal(banner.message, FIRST_TIME_SETUP_BANNER);
});

test("first-time setup: no lock banner even when isLocked=true", () => {
  const banner = computeAccountRulesBanner(false, true, true);
  assert.notEqual(banner.kind, "locked");
});

test("existing rules, locked: shows locked banner", () => {
  const banner = computeAccountRulesBanner(true, true, true);
  assert.equal(banner.kind, "locked");
  assert.equal(banner.message, LOCKED_BANNER);
});

test("existing rules, not locked: no banner", () => {
  const banner = computeAccountRulesBanner(true, false, true);
  assert.equal(banner.kind, "none");
});

test("deferred banner still appears for real rule changes (existing rules + locked)", () => {
  const banner = computeAccountRulesBanner(true, true, true);
  assert.equal(banner.kind, "locked");
  // The new framing tells users they can edit anytime; saves during active
  // trading are queued as pending and activate at the next safe window.
  assert.ok(banner.message.includes("edit anytime"), "banner must say editing is always allowed");
  assert.ok(
    banner.message.includes("pending") && banner.message.includes("safe window"),
    "banner must explain the save will be queued until the account's next safe window",
  );
});

test("locked banner uses server lockMessage when provided", () => {
  const banner = computeAccountRulesBanner(true, true, true, "Changes apply at May 8, 2026, 5:00 PM CT");
  assert.equal(banner.kind, "locked");
  assert.equal(banner.message, "Changes apply at May 8, 2026, 5:00 PM CT");
});

test("locked banner falls back to LOCKED_BANNER when lockMessage is null", () => {
  const banner = computeAccountRulesBanner(true, true, true, null);
  assert.equal(banner.kind, "locked");
  assert.equal(banner.message, LOCKED_BANNER);
});

test("first-time save never shows lock message even when lockMessage is provided", () => {
  const banner = computeAccountRulesBanner(false, true, true, "Locked until session end");
  assert.equal(banner.kind, "first_time");
  assert.equal(banner.message, FIRST_TIME_SETUP_BANNER);
  assert.ok(!banner.message.includes("Locked"), "first-time banner must not contain lock copy");
});

// ─── constants ────────────────────────────────────────────────────────────────

test("REVIEW_INHERITED_HINT mentions reviewing limits", () => {
  assert.ok(REVIEW_INHERITED_HINT.toLowerCase().includes("review"));
  assert.ok(REVIEW_INHERITED_HINT.toLowerCase().includes("inherited") || REVIEW_INHERITED_HINT.toLowerCase().includes("limit"));
});

// ─── computeAccountSaveButtonState ────────────────────────────────────────────

test("save button disabled when nothing changed (existing rules, clean form)", () => {
  const state = computeAccountSaveButtonState({ ...baseSaveInput });
  assert.equal(state.disabled, true);
  assert.equal(state.label, "Save rules");
});

test("save button enabled as soon as a field changes (isDirty=true)", () => {
  const state = computeAccountSaveButtonState({ ...baseSaveInput, isDirty: true });
  assert.equal(state.disabled, false);
  assert.equal(state.label, "Save rules");
});

test("save button enabled for first-time setup even when nothing typed yet", () => {
  // hasExistingRules=false → user is creating an override; saving the inherited
  // values into a new AccountRiskRules row counts as a save.
  const state = computeAccountSaveButtonState({
    ...baseSaveInput,
    hasExistingRules: false,
  });
  assert.equal(state.disabled, false);
});

test("save button enabled when consent is freshly ticked even with clean form", () => {
  const state = computeAccountSaveButtonState({
    ...baseSaveInput,
    hasValidConsent: false,
    consentChecked: true,
  });
  assert.equal(state.disabled, false);
});

test("save button label says 'Saving…' while saving", () => {
  const state = computeAccountSaveButtonState({
    ...baseSaveInput,
    isDirty: true,
    saving: true,
  });
  assert.equal(state.disabled, true);
  assert.equal(state.label, "Saving…");
});

test("save button shows 'Saved' after successful save (clean form, savedAt stamped)", () => {
  const state = computeAccountSaveButtonState({
    ...baseSaveInput,
    isDirty: false,
    savedAt: new Date(),
  });
  assert.equal(state.disabled, true, "stays disabled until next edit");
  assert.equal(state.label, "Saved");
});

test("after save → user edits a field → button re-enables and label flips back to 'Save rules'", () => {
  // Simulate the lifecycle: saved, then user edits a field.
  const after = computeAccountSaveButtonState({
    ...baseSaveInput,
    isDirty: true,
    savedAt: new Date(),
  });
  assert.equal(after.disabled, false);
  assert.equal(after.label, "Save rules");
});

test("save button disabled while remove flow is in flight", () => {
  const state = computeAccountSaveButtonState({
    ...baseSaveInput,
    isDirty: true,
    removing: true,
  });
  assert.equal(state.disabled, true);
});

test("save button stays in 'Save rules' label when a pending message is shown after save", () => {
  // pendingMessage is set when the save was deferred (locked window).
  // Label should stay "Save rules" rather than "Saved" — the change is not yet applied.
  const state = computeAccountSaveButtonState({
    ...baseSaveInput,
    isDirty: false,
    savedAt: new Date(),
    pendingMessage: "Saved as pending — applies at next edit window.",
  });
  assert.equal(state.label, "Save rules");
});

test("save button disabled when validation errors are present even on a dirty form", () => {
  const state = computeAccountSaveButtonState({
    ...baseSaveInput,
    isDirty: true,
    hasValidationErrors: true,
  });
  assert.equal(state.disabled, true);
  assert.equal(state.label, "Save rules");
});

test("save button disabled when validation errors are present even on first-time setup", () => {
  // First-time setup normally enables save; validation errors override that.
  const state = computeAccountSaveButtonState({
    ...baseSaveInput,
    hasExistingRules: false,
    hasValidationErrors: true,
  });
  assert.equal(state.disabled, true);
});

test("save button re-enables once validation errors clear (dirty + valid)", () => {
  const state = computeAccountSaveButtonState({
    ...baseSaveInput,
    isDirty: true,
    hasValidationErrors: false,
  });
  assert.equal(state.disabled, false);
});

// ─── computeShowPendingPanel ──────────────────────────────────────────────────

const basePendingInput = {
  pendingFieldRows: [] as { active: string; pending: string }[],
  pendingIsDelete: false,
  hasPendingPayload: true,
  pendingSessionPresets: null as string[] | null,
  activeSessionPresets: [] as string[],
  isDirty: false,
} as const;

test("pending panel hidden when there are no differing field rows and no pending session presets", () => {
  const result = computeShowPendingPanel({ ...basePendingInput });
  assert.equal(result, false);
});

test("pending panel hidden when all pending field values equal the active values", () => {
  // This guards the post-promotion case: promoter wrote active=$500 but
  // pendingPayloadJson was not yet cleared — both sides show $500.
  const result = computeShowPendingPanel({
    ...basePendingInput,
    pendingFieldRows: [
      { active: "$500", pending: "$500" },
      { active: "5", pending: "5" },
    ],
  });
  assert.equal(result, false, "panel must be hidden when active and pending values are identical");
});

test("pending panel shown when at least one field value differs", () => {
  const result = computeShowPendingPanel({
    ...basePendingInput,
    pendingFieldRows: [
      { active: "$500", pending: "$600" },
      { active: "5", pending: "5" },
    ],
  });
  assert.equal(result, true, "panel must be visible when any field differs");
});

test("pending panel shown for a single differing field even if others are identical", () => {
  const result = computeShowPendingPanel({
    ...basePendingInput,
    pendingFieldRows: [
      { active: "$500", pending: "$500" },
      { active: "2", pending: "3" },
    ],
  });
  assert.equal(result, true);
});

test("session pending panel hidden when active and pending session presets are equal", () => {
  const result = computeShowPendingPanel({
    ...basePendingInput,
    pendingSessionPresets: ["ny_open", "london"],
    activeSessionPresets: ["london", "ny_open"],
  });
  assert.equal(result, false, "panel must be hidden when session presets are the same (order-independent)");
});

test("session pending panel shown when pending session presets differ from active", () => {
  const result = computeShowPendingPanel({
    ...basePendingInput,
    pendingSessionPresets: ["ny_open", "ny_close"],
    activeSessionPresets: ["ny_open"],
  });
  assert.equal(result, true);
});

test("session pending panel shown when pending presets cleared to empty but active had presets", () => {
  const result = computeShowPendingPanel({
    ...basePendingInput,
    pendingSessionPresets: [],
    activeSessionPresets: ["ny_open"],
  });
  assert.equal(result, true);
});

test("pending panel hidden when form is dirty, even with differing field values", () => {
  const result = computeShowPendingPanel({
    ...basePendingInput,
    isDirty: true,
    pendingFieldRows: [{ active: "$500", pending: "$600" }],
  });
  assert.equal(result, false, "panel is suppressed while user is actively editing");
});

test("delete-override panel shown when hasPendingPayload is true", () => {
  const result = computeShowPendingPanel({
    ...basePendingInput,
    pendingIsDelete: true,
    hasPendingPayload: true,
  });
  assert.equal(result, true, "delete-override sentinel must always show the panel when payload exists");
});

test("delete-override panel hidden when hasPendingPayload is false", () => {
  const result = computeShowPendingPanel({
    ...basePendingInput,
    pendingIsDelete: true,
    hasPendingPayload: false,
  });
  assert.equal(result, false);
});

// ─── computePendingFieldRows ──────────────────────────────────────────────────

const baseActiveBaseline: PendingDiffActiveBaseline = {
  maxDailyLoss: "500",
  riskPerTrade: "200",
  maxTradesPerDay: "5",
  stopAfterLosses: "2",
  allowedEndHour: "16",
  maxContracts: "2",
};

test("pending field rows: empty when pendingPayload is null", () => {
  const rows = computePendingFieldRows({
    activeBaseline: baseActiveBaseline,
    pendingPayload: null,
    pendingIsDelete: false,
  });
  assert.deepEqual(rows, []);
});

test("pending field rows: empty when pendingIsDelete is true (handled elsewhere)", () => {
  const rows = computePendingFieldRows({
    activeBaseline: baseActiveBaseline,
    pendingPayload: { __delete: true },
    pendingIsDelete: true,
  });
  assert.deepEqual(rows, []);
});

test("pending field rows: returns active=DB-baseline, pending=payload for one differing field", () => {
  const rows = computePendingFieldRows({
    activeBaseline: baseActiveBaseline,
    pendingPayload: { maxDailyLoss: "400" },
    pendingIsDelete: false,
  });
  assert.deepEqual(rows, [
    { label: "Daily loss limit", active: "$500", pending: "$400" },
  ]);
});

test("REGRESSION: active side comes from baseline, NOT from a stale form-state value", () => {
  // Bug being guarded: after a pending save, the form's `values` state still
  // holds the user's submitted edit ($400). If the diff was built from form
  // state, the row would render "$400 → $400" instead of the correct
  // "$500 → $400". This test passes the DB baseline ($500) and the payload
  // ($400) explicitly; if the implementation ever regresses to reading from
  // an alternate baseline, this assertion will catch it.
  const dbBaseline: PendingDiffActiveBaseline = {
    ...baseActiveBaseline,
    maxDailyLoss: "500",
  };
  const rows = computePendingFieldRows({
    activeBaseline: dbBaseline,
    pendingPayload: { maxDailyLoss: "400" },
    pendingIsDelete: false,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].active, "$500", "active side must equal the DB baseline value");
  assert.equal(rows[0].pending, "$400", "pending side must equal the payload value");
});

test("pending field rows: filters out a field whose pending value equals the active baseline", () => {
  // Payload contains a key whose value matches the active baseline — the
  // row must not be emitted because there is nothing meaningful to show.
  const rows = computePendingFieldRows({
    activeBaseline: baseActiveBaseline,
    pendingPayload: { maxDailyLoss: "500", riskPerTrade: "150" },
    pendingIsDelete: false,
  });
  assert.deepEqual(rows, [
    { label: "Risk per trade", active: "$200", pending: "$150" },
  ]);
});

test("pending field rows: returns multiple rows when several fields differ", () => {
  const rows = computePendingFieldRows({
    activeBaseline: baseActiveBaseline,
    pendingPayload: {
      maxDailyLoss: "400",
      riskPerTrade: "150",
      maxTradesPerDay: 3,
      stopAfterLosses: 1,
      allowedEndHour: 15,
      maxContracts: 1,
    },
    pendingIsDelete: false,
  });
  assert.deepEqual(rows.map((r) => r.label), [
    "Daily loss limit",
    "Risk per trade",
    "Max trades / day",
    "Stop after losses",
    "Cutoff time",
    "Max position size",
  ]);
  // Spot-check the formatting of each kind of value (money, count, cutoff).
  assert.deepEqual(
    rows.find((r) => r.label === "Daily loss limit"),
    { label: "Daily loss limit", active: "$500", pending: "$400" },
  );
  assert.deepEqual(
    rows.find((r) => r.label === "Max trades / day"),
    { label: "Max trades / day", active: "5", pending: "3" },
  );
  assert.deepEqual(
    rows.find((r) => r.label === "Cutoff time"),
    { label: "Cutoff time", active: "16:00 CME", pending: "15:00 CME" },
  );
});

test("pending field rows: returns empty when payload only repeats the active values", () => {
  // The post-promotion / no-op-save scenario: every key in the payload matches
  // the active baseline. The panel should ultimately be hidden — this helper
  // returns no rows, which is what computeShowPendingPanel checks.
  const rows = computePendingFieldRows({
    activeBaseline: baseActiveBaseline,
    pendingPayload: {
      maxDailyLoss: "500",
      riskPerTrade: "200",
      maxTradesPerDay: 5,
      stopAfterLosses: 2,
      allowedEndHour: 16,
      maxContracts: 2,
    },
    pendingIsDelete: false,
  });
  assert.deepEqual(rows, []);
});

test("pending field rows: ignores payload keys with the wrong type", () => {
  // Defensive: a malformed payload (e.g. maxDailyLoss serialised as a number
  // instead of a string) should not crash and should not emit a row.
  const rows = computePendingFieldRows({
    activeBaseline: baseActiveBaseline,
    pendingPayload: { maxDailyLoss: 400, maxTradesPerDay: "5" },
    pendingIsDelete: false,
  });
  assert.deepEqual(rows, [], "wrong types are silently dropped — no row emitted");
});

test("pending panel hides entirely when computePendingFieldRows is empty and presets match", () => {
  // Integration check: the two helpers compose correctly. After a successful
  // promotion (or a no-op save), every field is identical and presets match.
  const rows = computePendingFieldRows({
    activeBaseline: baseActiveBaseline,
    pendingPayload: { maxDailyLoss: "500", riskPerTrade: "200" },
    pendingIsDelete: false,
  });
  const show = computeShowPendingPanel({
    pendingFieldRows: rows,
    pendingIsDelete: false,
    hasPendingPayload: true,
    pendingSessionPresets: ["ny_open"],
    activeSessionPresets: ["ny_open"],
    isDirty: false,
  });
  assert.equal(show, false);
});

// ─── Effective-baseline composition (override OR inherited default) ──────────
//
// In production, `account-rules-form.tsx` builds the activeBaseline with
// effectiveValue(accountOverride, inheritedDefault) for each field — the
// override when present, otherwise the inherited default. These tests exercise
// computePendingFieldRows with both shapes of baseline so a regression in how
// the form composes the baseline is caught here.

test("EFFECTIVE BASELINE: account override exists → diff shows the override on the active side", () => {
  // Account has its own maxDailyLoss override of $500. Pending payload edits
  // it to $400. Effective baseline (override): $500.
  const effectiveBaseline: PendingDiffActiveBaseline = {
    ...baseActiveBaseline,
    maxDailyLoss: "500", // account-override value (would come from initial.maxDailyLoss)
  };
  const rows = computePendingFieldRows({
    activeBaseline: effectiveBaseline,
    pendingPayload: { maxDailyLoss: "400" },
    pendingIsDelete: false,
  });
  assert.deepEqual(rows, [
    { label: "Daily loss limit", active: "$500", pending: "$400" },
  ]);
});

test("EFFECTIVE BASELINE: account inherits → diff shows the default-template value on the active side", () => {
  // Bug being fixed: account has NO maxDailyLoss override (initial value is "")
  // but the default template has $500. The form now builds the baseline with
  // effectiveValue("", "500") → "500". The diff renders "$500 → $400", not
  // "— → $400".
  const inheritedAccount = "";
  const inheritedDefault = "500";
  const effectiveBaseline: PendingDiffActiveBaseline = {
    ...baseActiveBaseline,
    // simulate: effectiveValue("", "500") = "500"
    maxDailyLoss: inheritedAccount.trim() ? inheritedAccount : inheritedDefault,
  };
  const rows = computePendingFieldRows({
    activeBaseline: effectiveBaseline,
    pendingPayload: { maxDailyLoss: "400" },
    pendingIsDelete: false,
  });
  assert.deepEqual(rows, [
    { label: "Daily loss limit", active: "$500", pending: "$400" },
  ]);
  assert.notEqual(rows[0].active, "—", "must NOT render '—' when default has a value");
});

test("EFFECTIVE BASELINE: missing account override does NOT produce '—' if default has a value", () => {
  // Multi-field check: every field is inherited (account has no override),
  // and the default has a value for each. The diff must render the default
  // values on the active side, never "—".
  const effectiveBaseline: PendingDiffActiveBaseline = {
    maxDailyLoss: "500",      // from default
    riskPerTrade: "100",      // from default
    maxTradesPerDay: "5",     // from default
    stopAfterLosses: "2",     // from default
    allowedEndHour: "16",     // from default
    maxContracts: "3",        // from default
  };
  const rows = computePendingFieldRows({
    activeBaseline: effectiveBaseline,
    pendingPayload: {
      maxDailyLoss: "400",
      riskPerTrade: "200",
      maxTradesPerDay: 4,
      stopAfterLosses: 2,
      maxContracts: 1,
    },
    pendingIsDelete: false,
  });
  assert.deepEqual(rows.find((r) => r.label === "Daily loss limit"), {
    label: "Daily loss limit",
    active: "$500",
    pending: "$400",
  });
  assert.deepEqual(rows.find((r) => r.label === "Risk per trade"), {
    label: "Risk per trade",
    active: "$100",
    pending: "$200",
  });
  assert.deepEqual(rows.find((r) => r.label === "Max trades / day"), {
    label: "Max trades / day",
    active: "5",
    pending: "4",
  });
  assert.deepEqual(rows.find((r) => r.label === "Max position size"), {
    label: "Max position size",
    active: "3",
    pending: "1",
  });
  // Stop after losses identical (2 == 2) — must be filtered out.
  assert.equal(
    rows.find((r) => r.label === "Stop after losses"),
    undefined,
    "identical row must be filtered out even when both sides come from the default",
  );
  // None of the rows render the dash placeholder.
  for (const r of rows) {
    assert.notEqual(r.active, "—", `${r.label} active side must not be '—'`);
  }
});

test("EFFECTIVE BASELINE: only renders '— → value' when neither account nor default has a value", () => {
  // Truly missing baseline: no account override, no default. effectiveValue
  // returns "" and the formatter renders "—". The diff still emits the row
  // because there is a real difference ("" vs the pending value).
  const effectiveBaseline: PendingDiffActiveBaseline = {
    ...baseActiveBaseline,
    maxContracts: "", // no override AND no default
  };
  const rows = computePendingFieldRows({
    activeBaseline: effectiveBaseline,
    pendingPayload: { maxContracts: 2 },
    pendingIsDelete: false,
  });
  assert.deepEqual(rows, [
    { label: "Max position size", active: "—", pending: "2" },
  ]);
});

test("REGRESSION: pending payload field names match the active baseline keys", () => {
  // Keep these two shapes in sync. If the active baseline ever loses a key
  // that the pending payload still emits, computePendingFieldRows would
  // silently render the active side as "undefined" / "—" — which is exactly
  // the class of bug being guarded here.
  const baselineKeys: (keyof PendingDiffActiveBaseline)[] = [
    "maxDailyLoss",
    "riskPerTrade",
    "maxTradesPerDay",
    "stopAfterLosses",
    "allowedEndHour",
    "maxContracts",
  ];
  // Drive the helper with a payload that uses the same keys for every field
  // and a value that differs from baseActiveBaseline on every field, so the
  // identical-row filter does not interfere with the key-coverage check.
  const payload: Record<string, unknown> = {
    maxDailyLoss: "400",   // baseline 500 → 400
    riskPerTrade: "150",   // baseline 200 → 150
    maxTradesPerDay: 4,    // baseline 5 → 4
    stopAfterLosses: 1,    // baseline 2 → 1
    allowedEndHour: 15,    // baseline 16 → 15
    maxContracts: 1,       // baseline 2 → 1
  };
  const rows = computePendingFieldRows({
    activeBaseline: baseActiveBaseline,
    pendingPayload: payload,
    pendingIsDelete: false,
  });
  assert.equal(
    rows.length,
    baselineKeys.length,
    "every payload key must produce a diff row when all values differ",
  );
});

test("REGRESSION: account override $500 + pending $400 must render '$500 → $400', not '$400 → $400'", () => {
  // The pre-previous bug: form input state ($400) leaked into the active side.
  // Guard with an explicit baseline of $500 — independent of any client state.
  const rows = computePendingFieldRows({
    activeBaseline: { ...baseActiveBaseline, maxDailyLoss: "500" },
    pendingPayload: { maxDailyLoss: "400" },
    pendingIsDelete: false,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].active, "$500");
  assert.equal(rows[0].pending, "$400");
  assert.notEqual(rows[0].active, "$400", "guard against stale form-state leak into the active side");
});

// ─── mapDefaultRulesToAccountForm ────────────────────────────────────────────

test("default mapping: null/undefined input returns all-empty strings", () => {
  const fromNull = mapDefaultRulesToAccountForm(null);
  const fromUndefined = mapDefaultRulesToAccountForm(undefined);
  const empty = {
    maxDailyLoss: "",
    riskPerTrade: "",
    maxTradesPerDay: "",
    stopAfterLosses: "",
    allowedEndHour: "",
    maxContracts: "",
  };
  assert.deepEqual(fromNull, empty);
  assert.deepEqual(fromUndefined, empty);
});

test("default mapping: copies populated decimal/int columns straight across", () => {
  const result = mapDefaultRulesToAccountForm({
    maxDailyLoss: "500",
    riskPerTrade: "100",
    maxTradesPerDay: 5,
    stopAfterLosses: 2,
    sessionEndHour: 16,
    maxContracts: 3,
  });
  assert.deepEqual(result, {
    maxDailyLoss: "500",
    riskPerTrade: "100",
    maxTradesPerDay: "5",
    stopAfterLosses: "2",
    allowedEndHour: "16",
    maxContracts: "3",
  });
});

test("default mapping: riskPerTrade falls back to maxRiskPerTrade when riskPerTrade is null", () => {
  // Legacy users have only maxRiskPerTrade populated. Without this fallback
  // the account form's defaultValues.riskPerTrade is "", and the pending
  // diff renders "—" for inherited rows. With it, the active side shows
  // the value the user actually has on the default template.
  const result = mapDefaultRulesToAccountForm({
    riskPerTrade: null,
    maxRiskPerTrade: "150",
  });
  assert.equal(result.riskPerTrade, "150");
});

test("default mapping: riskPerTrade prefers riskPerTrade over maxRiskPerTrade when both present", () => {
  const result = mapDefaultRulesToAccountForm({
    riskPerTrade: "100",
    maxRiskPerTrade: "150",
  });
  assert.equal(result.riskPerTrade, "100", "current riskPerTrade wins over legacy maxRiskPerTrade");
});

test("default mapping: sessionEndHour (default-template column) maps to allowedEndHour (account-form key)", () => {
  // Account form expects `allowedEndHour` but the default template column is
  // `sessionEndHour`. Without this remap the account-form receives no cutoff
  // baseline.
  const result = mapDefaultRulesToAccountForm({ sessionEndHour: 16 });
  assert.equal(result.allowedEndHour, "16");
});

test("default mapping: emits empty string when a specific field is null even if others are populated", () => {
  // Mixed-population case: some default fields set, others not. The unset
  // ones must come back as "" so effectiveValue() can short-circuit them.
  const result = mapDefaultRulesToAccountForm({
    maxDailyLoss: "500",
    riskPerTrade: null,
    maxRiskPerTrade: null,
    maxTradesPerDay: null,
    stopAfterLosses: 3,
    sessionEndHour: null,
    maxContracts: null,
  });
  assert.equal(result.maxDailyLoss, "500");
  assert.equal(result.riskPerTrade, "");
  assert.equal(result.maxTradesPerDay, "");
  assert.equal(result.stopAfterLosses, "3");
  assert.equal(result.allowedEndHour, "");
  assert.equal(result.maxContracts, "");
});

test("REGRESSION: inherited account with default $500 produces '$500 → $400' diff (no '—')", () => {
  // The end-to-end flow: account has no override (initial.maxDailyLoss = "");
  // default template has $500. mapDefaultRulesToAccountForm gives the account
  // form a defaultValues row with maxDailyLoss="500". The form's
  // effectiveValue("", "500") = "500". The pending diff renders "$500 → $400".
  const accountFormDefaultValues = mapDefaultRulesToAccountForm({
    maxDailyLoss: "500",
  });
  // Mimic the form's effectiveValue() composition for the diff baseline.
  const inheritedAccountOverride = "";
  const baseline: PendingDiffActiveBaseline = {
    ...baseActiveBaseline,
    maxDailyLoss: inheritedAccountOverride.trim()
      ? inheritedAccountOverride
      : accountFormDefaultValues.maxDailyLoss,
  };
  const rows = computePendingFieldRows({
    activeBaseline: baseline,
    pendingPayload: { maxDailyLoss: "400" },
    pendingIsDelete: false,
  });
  assert.deepEqual(rows, [
    { label: "Daily loss limit", active: "$500", pending: "$400" },
  ]);
  assert.notEqual(rows[0].active, "—", "inherited from default must NOT render '—' on the active side");
});

test("REGRESSION: inherited account when default has only maxRiskPerTrade — riskPerTrade row uses fallback", () => {
  // Legacy user: default template has maxRiskPerTrade=150 but no riskPerTrade.
  // The account inherits. The fallback in mapDefaultRulesToAccountForm makes
  // defaultValues.riskPerTrade = "150", so the diff renders "$150 → $200".
  const accountFormDefaultValues = mapDefaultRulesToAccountForm({
    riskPerTrade: null,
    maxRiskPerTrade: "150",
  });
  const baseline: PendingDiffActiveBaseline = {
    ...baseActiveBaseline,
    riskPerTrade: accountFormDefaultValues.riskPerTrade,
  };
  const rows = computePendingFieldRows({
    activeBaseline: baseline,
    pendingPayload: { riskPerTrade: "200" },
    pendingIsDelete: false,
  });
  assert.deepEqual(rows, [
    { label: "Risk per trade", active: "$150", pending: "$200" },
  ]);
});
