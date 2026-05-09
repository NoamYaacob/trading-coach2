import test from "node:test";
import assert from "node:assert/strict";

import {
  computeAccountRulesBanner,
  computeAccountSaveButtonState,
  computeShowPendingPanel,
  canSaveAccountRulesNow,
  FIRST_TIME_SETUP_BANNER,
  LOCKED_BANNER,
  REVIEW_INHERITED_HINT,
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
