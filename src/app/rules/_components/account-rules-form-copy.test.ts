/**
 * Copy regression tests for the Trading Plan rules forms.
 *
 * These freeze the user-facing wording for cutoff behavior, the 4 PM CT
 * boundary note, and the pending-panel guidance so future edits don't
 * silently re-introduce phrasing that implies live automation.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cmeHourBoundaryNote } from "./cme-hour-parsing.ts";

const FORM_FILES = {
  account: resolve(import.meta.dirname, "account-rules-form.tsx"),
  default: resolve(import.meta.dirname, "rules-form.tsx"),
} as const;

function read(path: string): string {
  return readFileSync(path, "utf8");
}

// ── Pending panel: active vs pending guidance ────────────────────────────────

test("account form: pending panel header says 'Pending changes saved'", () => {
  const src = read(FORM_FILES.account);
  assert.ok(
    src.includes("Pending changes saved"),
    "pending panel must say 'Pending changes saved' to make state explicit",
  );
});

test("account form: pending panel subline says auto-activation at next safe window", () => {
  // The promoter cron is now wired (src/lib/pending-rule-promoter.ts +
  // /api/cron/promote-pending-rules). Activation is gated by the per-row
  // SAFETY window (CME maintenance / weekend close / market closed / account
  // locked) — not by a calendar "edit window". Copy must reflect this.
  const src = read(FORM_FILES.account);
  assert.ok(
    src.includes("will activate automatically at the next safe window"),
    "pending panel must say 'will activate automatically at the next safe window'",
  );
});

test("account form: stale 'not wired yet' copy has been removed", () => {
  const src = read(FORM_FILES.account);
  assert.ok(
    !src.includes("automatic activation is not wired yet"),
    "the 'not wired yet' line must be removed now that the promoter exists",
  );
  assert.ok(
    !src.includes("Re-open this form during the next edit window and save again"),
    "the manual-save instruction must be removed now that the promoter exists",
  );
});

test("account form: above-panel guidance says fields show active rules", () => {
  const src = read(FORM_FILES.account);
  assert.ok(
    src.includes("Form fields show active rules"),
    "form must tell the user that fields show active rules when pending exists",
  );
});

test("account form: surfaces inherited fields per-section (parity with default form structure)", () => {
  // Inherited default-only fields are surfaced in the section where they
  // conceptually belong:
  //   - Account size + Daily profit target → inside the "Money limits" section
  //     as a small inherited mini-table.
  //   - Notifications → a read-only honest summary. There is no real per-rule
  //     alert toggle, so the section describes actual delivery (in-app +
  //     Telegram), not a fictional inherited "breach alert setting".
  const src = read(FORM_FILES.account);
  assert.ok(src.includes("Account size"), "Money limits section must mention 'Account size' as inherited");
  assert.ok(src.includes("Daily profit target"), "Money limits section must mention 'Daily profit target' as inherited");
  assert.ok(
    src.includes("Rule-breach notices appear in-app on the Dashboard"),
    "Notifications section must honestly describe in-app + Telegram delivery",
  );
});

test("account form: trading-session diff uses 'active now' / 'pending next' framing", () => {
  const src = read(FORM_FILES.account);
  assert.ok(
    src.includes("Trading session — active now"),
    "session diff must use 'Trading session — active now' label",
  );
  assert.ok(
    src.includes("Trading session — pending next"),
    "session diff must use 'Trading session — pending next' label",
  );
});

test("account form: pending panel guidance does NOT use stale 'changes pending — applies' header", () => {
  const src = read(FORM_FILES.account);
  // The new header is "Pending changes saved" with the date in a subline.
  // The old "Changes pending — applies <date>" was ambiguous about what's
  // active vs pending; assert the form template no longer contains it.
  assert.ok(
    !src.includes("Changes pending{localPendingDate"),
    "the old 'Changes pending — applies <date>' header must be removed",
  );
});

test("account form: explanatory note appears next to 'Not set' rows", () => {
  // When a diff row's active side is "Not set" (because both the account
  // override and the default template have null for that field), a small
  // inline note must appear under the rows explaining what that means. The
  // note prevents users from misreading 'Not set' as "the value is whatever
  // the input placeholder shows" (e.g. the hardcoded "2" hint on the
  // maxContracts input). The guard now uses `activeSource === "not_set"`
  // (the source-aware tag) rather than string matching on the formatted
  // active value, since the diff helper no longer reuses "Not set" for
  // inherited values that match the default template.
  const src = read(FORM_FILES.account);
  assert.ok(
    /Not set.{0,30}means neither the account override nor the default template has a value/i.test(
      src.replace(/\s+/g, " "),
    ),
    "form must include the 'Not set' explanatory note copy",
  );
  assert.ok(
    /pendingFieldRows\.some\(\s*\(r\)\s*=>\s*r\.activeSource === "not_set"\s*\)/.test(src),
    "the note must be guarded by an activeSource === 'not_set' check, not always-on",
  );
});

test("account form: temporary data-debug-* attributes have been removed from production HTML", () => {
  const src = read(FORM_FILES.account);
  assert.ok(
    !/data-debug-/.test(src),
    "production form must not include any data-debug-* diagnostic attributes",
  );
});

// ── Cutoff behavior options ──────────────────────────────────────────────────

test("account form: flatten-at-cutoff hint uses the saved-for-future-automation copy", () => {
  const src = read(FORM_FILES.account);
  assert.ok(
    src.includes("Saved for future cutoff automation"),
    "flatten-at-cutoff hint must say 'Saved for future cutoff automation'",
  );
  assert.ok(
    src.includes("This action is not active yet"),
    "flatten-at-cutoff hint must clearly state it is not active yet",
  );
});

test("default form: flatten-at-cutoff hint matches the account form (consistent copy)", () => {
  const src = read(FORM_FILES.default);
  assert.ok(
    src.includes("Saved for future cutoff automation"),
    "default form flatten hint must use the same 'saved for future automation' copy as the account form",
  );
});

test("account form: wait-for-exit-then-lock hint says scheduling is not active yet", () => {
  const src = read(FORM_FILES.account);
  // The hint must NOT just say "the account is locked for the rest of the day"
  // without qualification — that implies a live scheduler exists.
  assert.ok(
    src.includes("Automatic cutoff scheduling is not active yet"),
    "wait-for-exit hint must state that automatic cutoff scheduling is not active",
  );
});

test("no form text claims Guardrail will lock or flatten the account today via cutoff", () => {
  // We catch "will lock the account for the rest of the trading day" specifically —
  // the previous wording that implied live automation. Replacements must use
  // "Automatic cutoff scheduling is not active yet" or "When enabled, ...".
  for (const path of Object.values(FORM_FILES)) {
    const src = read(path);
    assert.ok(
      !src.includes("the account is locked for the rest of the day"),
      `${path} must not claim live cutoff lock; rewrite to mention scheduling is not active`,
    );
    assert.ok(
      !src.includes("Guardrail will lock the account for the rest of the trading day"),
      `${path} must not claim Guardrail auto-locks at cutoff`,
    );
  }
});

// ── 4:00 PM CT boundary note ─────────────────────────────────────────────────

test("4PM boundary note mentions Monday–Thursday daily break", () => {
  const note = cmeHourBoundaryNote(16);
  assert.ok(note);
  assert.match(note!, /Monday.Thursday/);
  assert.match(note!, /daily break/i);
});

test("4PM boundary note mentions Friday weekly close", () => {
  const note = cmeHourBoundaryNote(16);
  assert.ok(note);
  assert.match(note!, /Friday/);
  assert.match(note!, /weekly close/i);
});

test("4PM boundary note states automatic cutoff enforcement is not active yet", () => {
  const note = cmeHourBoundaryNote(16);
  assert.ok(note);
  assert.match(note!, /not active yet/i);
});

// ── Cross-form parity ────────────────────────────────────────────────────────

test("both forms use identical 'Risk per trade ($)' label (no 'Max risk per trade' divergence)", () => {
  // Default and account forms drifted on this label: default form said
  // 'Max risk per trade' and account form said 'Risk per trade'. The DB
  // column is `maxRiskPerTrade`/`riskPerTrade` (legacy schema), but the
  // user-visible label must be the same in both places to avoid implying
  // a different rule semantics.
  const defaultSrc = read(FORM_FILES.default);
  const accountSrc = read(FORM_FILES.account);
  assert.ok(
    defaultSrc.includes('label="Risk per trade ($)"'),
    "default form must label this field 'Risk per trade ($)' — do NOT regress to 'Max risk per trade'",
  );
  assert.ok(
    accountSrc.includes('label="Risk per trade ($)"'),
    "account form must label this field 'Risk per trade ($)'",
  );
  assert.ok(
    !defaultSrc.includes('"Max risk per trade ($)"'),
    "default form must not contain the old 'Max risk per trade ($)' label",
  );
});

test("both forms use the SAME risk-per-trade hint copy", () => {
  const defaultSrc = read(FORM_FILES.default);
  const accountSrc = read(FORM_FILES.account);
  const SHARED_HINT = "Warning only — does not lock the account.";
  assert.ok(defaultSrc.includes(SHARED_HINT), "default form must use shared risk-per-trade hint");
  assert.ok(accountSrc.includes(SHARED_HINT), "account form must use shared risk-per-trade hint");
});

test("both forms expose the same five top-level sections in the same order", () => {
  // Default template form sections: Money limits → Trading limits → Daily
  // cutoff → Notifications → Trading Session (mounted as a separate component).
  // The account form must mirror this section list so the two pages feel like
  // the same form rather than two unrelated layouts. Trading Session is
  // rendered by <TradingSessionSelector> (no role="group"), so we only
  // assert on the four section cards that live in the form file itself.
  const SECTIONS = [
    'aria-label="Money limits"',
    'aria-label="Trading limits"',
    'aria-label="Daily cutoff"',
    'aria-label="Notifications"',
  ];
  for (const path of [FORM_FILES.default, FORM_FILES.account]) {
    const src = read(path);
    let lastIdx = -1;
    for (const section of SECTIONS) {
      const idx = src.indexOf(section);
      assert.ok(
        idx !== -1,
        `${path} is missing section ${section} — both forms must declare the same section list`,
      );
      assert.ok(
        idx > lastIdx,
        `${path} declares ${section} before an earlier section in the canonical order`,
      );
      lastIdx = idx;
    }
  }
});

test("account form does NOT have a stray 'At cutoff' section card (cutoff behavior must live inside Daily cutoff)", () => {
  // Pre-parity: account form had a separate `aria-label="At cutoff"` card,
  // which split the cutoff settings across two cards while the default
  // template kept them together. The behavior radio now lives nested
  // inside the Daily cutoff section, matching the default form.
  const src = read(FORM_FILES.account);
  assert.ok(
    !src.includes('aria-label="At cutoff"'),
    "remove the standalone 'At cutoff' card — its radios must nest inside Daily cutoff",
  );
});

test("pending diff renders three columns: Rule / Active now / Pending next", () => {
  // The amber paragraph list was replaced with a compact diff table.
  // Asserting the column headers locks the new layout against future
  // regressions back to the old 'X → Y' inline list.
  const src = read(FORM_FILES.account);
  assert.match(src, />\s*Rule\s*</);
  assert.match(src, />\s*Active now\s*</);
  assert.match(src, />\s*Pending next\s*</);
});

test("pending diff active value is tagged Inherited / Override / Not set via activeSource", () => {
  // The form must call renderActiveSourceTag(activeSource) for each row so
  // the user can tell whether the active value is this account's override,
  // the inherited default, or genuinely missing. Without this, the diff
  // would silently regress to "Not set → 4" for inherited values.
  const src = read(FORM_FILES.account);
  assert.match(
    src,
    /renderActiveSourceTag\(\s*activeSource\s*\)/,
    "diff must invoke renderActiveSourceTag(activeSource) per row",
  );
  // The three legal labels must all be present in the renderer.
  assert.match(src, />\s*Inherited\s*</);
  assert.match(src, />\s*Override\s*</);
  assert.match(src, />\s*Not set\s*</);
});

test("pending save status copy uses 'Saved as pending — these rules will activate at the next safe window'", () => {
  // Replaces the old generic pendingMessage echo with explicit copy that
  // tells the user the rules are NOT active yet and when they will become
  // active.
  const src = read(FORM_FILES.account);
  assert.ok(
    src.includes("Saved as pending — these rules will activate at the next safe window."),
    "form must show the new pending-save status copy",
  );
});

test("Max position size copy uses standard-equivalent model (Apex prop-firm framing)", () => {
  // The hint uses the simplified customer-facing explanation of the standard-equivalent
  // model. Internal API reasoning (raw contract counts, broker cap logic) is not
  // exposed in the customer hint.
  const copySrc = readFileSync(
    resolve(import.meta.dirname, "position-size-copy.ts"),
    "utf8",
  );
  assert.match(copySrc, /standard-equivalent/i, "copy must use standard-equivalent framing");
  assert.match(copySrc, /1 NQ equal 10 MNQ/i, "hint must explain the Apex 1 NQ = 10 MNQ sizing");
  assert.ok(
    copySrc.includes("Guardrail monitors this limit and locks the session when exposure exceeds the cap"),
    "hint must describe that Guardrail locks the session on breach (not just monitors)",
  );
  assert.ok(
    !copySrc.includes("Broker-side blocking is not active yet"),
    "stale 'not active yet' wording must be removed from MAX_POSITION_SIZE_COPY",
  );
});

// ── Task A: Default form pending indicator ────────────────────────────────────

test("default form: Field component accepts pendingNote prop", () => {
  // Task A: when an active DB column is null but pendingPayloadJson has a
  // value, the default form must render an inline amber note. The note copy
  // must include "Pending next safe window" and should NOT say the value IS
  // active — it must make clear the value is waiting for promotion.
  const src = read(FORM_FILES.default);
  assert.ok(
    src.includes("Pending next safe window:"),
    "default form's pendingFieldNote helper must use 'Pending next safe window:' copy",
  );
  assert.ok(
    /pendingNote=/.test(src),
    "Field invocations must pass pendingNote= prop for pending-payload display",
  );
});

test("default form: pendingFieldNote only shows note when active value is empty", () => {
  // The helper must return null when activeValue is non-empty, so users with
  // an active value set don't see a redundant double-note.
  const src = read(FORM_FILES.default);
  assert.ok(
    /activeValue\.trim\(\) !== ""/.test(src),
    "pendingFieldNote must guard on activeValue.trim() !== '' to suppress note when active is set",
  );
});

test("default form: pendingPayload prop is accepted and forwarded to field notes", () => {
  // The RulesForm component must accept a pendingPayload prop and the fields
  // must consume it so the page can pass the server's pendingPayloadJson.
  const src = read(FORM_FILES.default);
  assert.ok(
    /pendingPayload\?.*Record<string, unknown>/.test(src.replace(/\s+/g, " ")),
    "RulesForm Props must include pendingPayload?: Record<string, unknown> | null",
  );
});

// ── Task B: Account form inherited-default-pending note ───────────────────────

test("account form: defaultPendingPayload prop is accepted", () => {
  // Task B: when the inherited default active column is null but the default
  // pendingPayloadJson has a value, the account form should surface a note.
  const src = read(FORM_FILES.account);
  assert.ok(
    /defaultPendingPayload\?.*Record<string, unknown>/.test(src.replace(/\s+/g, " ")),
    "AccountRulesForm Props must include defaultPendingPayload?: Record<string, unknown> | null",
  );
});

test("account form: defaultPendingNote copy mentions 'Default template has' and 'pending'", () => {
  // The note must make it clear the value is from the DEFAULT TEMPLATE and is
  // PENDING (not yet active), not from this account's own pending state.
  const src = read(FORM_FILES.account);
  assert.ok(
    /Default template has.*pending/i.test(src.replace(/\s+/g, " ")),
    "account form must include copy that mentions 'Default template has ... pending'",
  );
  assert.ok(
    /not active yet/.test(src),
    "account form default-pending note must say 'not active yet'",
  );
});

// ── Pending panel: blocking reason exposure ──────────────────────────────────

test("account form: pending panel shows 'Cannot apply yet' when activation is blocked", () => {
  // When canApplyPendingNow is false, the pending panel must show a human-
  // readable reason so the user understands why the "Apply pending now" button
  // is absent. The copy must contain "Cannot apply yet" as the lead-in to the
  // reason string supplied by activationReasonMessage().
  const src = read(FORM_FILES.account);
  assert.ok(
    src.includes("Cannot apply yet:"),
    "pending panel must include 'Cannot apply yet:' lead-in when activation is blocked",
  );
});

test("account form: pending panel renders pendingBlockReason when provided", () => {
  // The component must reference the pendingBlockReason prop directly in the
  // JSX so the server-computed reason string is displayed to the user.
  const src = read(FORM_FILES.account);
  assert.ok(
    src.includes("pendingBlockReason"),
    "account form must reference pendingBlockReason in JSX to render the blocking reason",
  );
});

test("account form: pending panel shows button OR reason, never silent", () => {
  // There must be no path where pending changes exist and neither a button nor
  // a reason is shown. The JSX must use a ternary/conditional that surfaces
  // one of: ApplyPendingButton (when safe) or the Cannot-apply-yet paragraph
  // (when blocked). A silent "Changes will activate..." with no context is
  // insufficient UX — the user needs actionable information.
  const src = read(FORM_FILES.account);
  // Both the button and the reason branch must be present in the source.
  assert.ok(
    src.includes("canApplyPendingNow") && src.includes("ApplyPendingButton"),
    "pending panel must show ApplyPendingButton when canApplyPendingNow is true",
  );
  assert.ok(
    src.includes("pendingBlockReason") && src.includes("Cannot apply yet:"),
    "pending panel must show block reason when pendingBlockReason is set",
  );
});

// ── Task G: No 'verified/guaranteed reject' language before demo sign-off ─────

test("no form claims Tradovate rejection is verified or guaranteed", () => {
  // The demo verification plan (docs/ops/tradovate-position-limit-demo.md)
  // must be completed before we claim broker-side rejection is confirmed.
  // Any wording that implies live testing has been done is premature and
  // misleading — lock it out via copy test until the demo checklist is signed.
  for (const path of Object.values(FORM_FILES)) {
    const src = read(path);
    const FORBIDDEN = [
      "verified reject",
      "guaranteed reject",
      "confirmed reject",
      "rejection verified",
      "rejection guaranteed",
      "tested and verified",
      "broker will reject",
    ];
    for (const phrase of FORBIDDEN) {
      assert.ok(
        !src.toLowerCase().includes(phrase),
        `${path} must not claim verified/guaranteed broker rejection before demo sign-off — found: "${phrase}"`,
      );
    }
  }
});

// ── Phase 2: Account empty state ──────────────────────────────────────────────

test("account form: empty state shows 'No Trading Plan yet' heading", () => {
  const src = read(FORM_FILES.account);
  assert.ok(
    src.includes("No Trading Plan yet"),
    "empty state must say 'No Trading Plan yet' — not 'Inherited from default template'",
  );
});

test("account form: empty state shows 'Create rules for this account' button", () => {
  const src = read(FORM_FILES.account);
  assert.ok(
    src.includes("Create rules for this account"),
    "empty state must have a 'Create rules for this account' CTA",
  );
});

test("account form: empty state shows 'Copy from another account' button (Phase 3 implemented)", () => {
  const src = read(FORM_FILES.account);
  assert.ok(
    src.includes("Copy from another account"),
    "empty state must have 'Copy from another account' button",
  );
  assert.ok(
    !src.includes("Coming soon"),
    "Phase 3: copy button must no longer say 'Coming soon' — it is now implemented",
  );
  assert.ok(
    src.includes("setShowCopyModal") || src.includes("CopyRulesModal"),
    "Phase 3: copy button must open CopyRulesModal",
  );
});

test("account form: empty state does NOT show inherited summary table as active enforcement", () => {
  const src = read(FORM_FILES.account);
  assert.ok(
    !src.includes("Default template values (not enforced without override)"),
    "Phase 2 empty state must not show the inherited-values summary table",
  );
  assert.ok(
    !src.includes("Inherited from default template"),
    "Phase 2 empty state must not say 'Inherited from default template'",
  );
});

test("account form: empty state copy says Guardrail cannot monitor without account rules", () => {
  const src = read(FORM_FILES.account);
  assert.ok(
    src.includes("Create account-specific rules before Guardrail can monitor"),
    "empty state must explain monitoring requires account-specific rules",
  );
});

// ── Phase 3: Copy rules UI ────────────────────────────────────────────────────

const COPY_MODAL = resolve(import.meta.dirname, "copy-rules-modal.tsx");

test("copy modal: exists and is a client component", () => {
  const src = read(COPY_MODAL);
  assert.ok(src.includes('"use client"'), "copy-rules-modal must be a client component");
});

test("copy modal: shows 'No other Trading Plans to copy yet' when sourceAccounts is empty", () => {
  const src = read(COPY_MODAL);
  assert.ok(
    src.includes("No other Trading Plans to copy yet"),
    "modal must handle empty source list gracefully",
  );
});

test("copy modal: calls POST /api/accounts/[id]/rules/copy endpoint", () => {
  const src = read(COPY_MODAL);
  assert.ok(
    src.includes("/api/accounts/") && src.includes("/rules/copy"),
    "modal must POST to /api/accounts/[id]/rules/copy",
  );
  assert.ok(src.includes('method: "POST"'), "modal must use POST method");
});

test("copy modal: handles 423 lock response", () => {
  const src = read(COPY_MODAL);
  assert.ok(
    src.includes("res.status === 423") || src.includes("status === 423"),
    "modal must handle 423 session lock response",
  );
  assert.ok(
    src.includes('"locked"'),
    "modal must enter locked state on 423",
  );
});

test("copy modal: shows success message on copy", () => {
  const src = read(COPY_MODAL);
  assert.ok(
    src.includes("Trading Plan copied successfully"),
    "modal must show success message after copy",
  );
});

test("copy modal: does not use Tradovate or internal terms in user-facing copy", () => {
  const src = read(COPY_MODAL);
  const FORBIDDEN_IN_JSX = [
    "AccountRiskRules",
    "RiskRules",
    "BROKER_ENFORCEMENT_ENABLED",
    "TRADOVATE",
    "enforcement engine",
    "dry run",
  ];
  for (const term of FORBIDDEN_IN_JSX) {
    assert.ok(
      !src.includes(term),
      `copy modal must not expose internal term "${term}" to users`,
    );
  }
});

test("copy modal: shows account label and env in source list", () => {
  const src = read(COPY_MODAL);
  assert.ok(
    src.includes("account.label"),
    "modal must render account label in source list",
  );
  assert.ok(
    src.includes("envLabel") || src.includes("account.env"),
    "modal must render env label (Demo/Live) when available",
  );
});

test("account form: copy button shows disabled state when no sources available", () => {
  const src = read(FORM_FILES.account);
  assert.ok(
    src.includes("No other Trading Plans to copy yet"),
    "form must show 'No other Trading Plans to copy yet' as disabled title when no sources",
  );
});

test("account form: copySourceAccounts prop is declared", () => {
  const src = read(FORM_FILES.account);
  assert.ok(
    src.includes("copySourceAccounts"),
    "AccountRulesForm must accept copySourceAccounts prop",
  );
});

// ── Phase 4B: symbol-specific max contracts table ────────────────────────────

test("account form: imports and renders SymbolLimitsTable", () => {
  const src = read(FORM_FILES.account);
  assert.ok(
    src.includes('from "./symbol-limits-table"'),
    "account form must import SymbolLimitsTable",
  );
  assert.ok(
    src.includes("<SymbolLimitsTable"),
    "account form must render the SymbolLimitsTable in the Max Contracts section",
  );
});

test("account form: SymbolLimitsTable is disabled when the form is locked", () => {
  const src = read(FORM_FILES.account);
  const idx = src.indexOf("<SymbolLimitsTable");
  assert.ok(idx !== -1, "SymbolLimitsTable must be rendered");
  const block = src.slice(idx, idx + 240);
  assert.ok(
    block.includes("disabled={fieldsDisabled}"),
    "SymbolLimitsTable must receive disabled={fieldsDisabled} so a locked account is read-only",
  );
});

test("account form: serializes symbolLimits into maxContractsBySymbolJson on submit", () => {
  const src = read(FORM_FILES.account);
  assert.ok(
    src.includes("maxContractsBySymbolJson: serializeSymbolLimits(values.symbolLimits)"),
    "submit payload must serialize symbolLimits into maxContractsBySymbolJson",
  );
});

test("account form: an empty symbol table serializes to null", () => {
  const src = read(FORM_FILES.account);
  const idx = src.indexOf("function serializeSymbolLimits");
  assert.ok(idx !== -1, "serializeSymbolLimits helper must exist");
  const fn = src.slice(idx, idx + 420);
  assert.ok(
    fn.includes("entries.length > 0 ? JSON.stringify(entries) : null"),
    "serializeSymbolLimits must return null when no symbol rows are present",
  );
});

test("account form: symbolLimits is declared on AccountRulesValues", () => {
  const src = read(FORM_FILES.account);
  assert.ok(
    src.includes("symbolLimits: SymbolLimitRow[]"),
    "AccountRulesValues must include the symbolLimits field",
  );
});

test("account form: shows the global-fallback note on the max contracts field", () => {
  const src = read(FORM_FILES.account);
  assert.ok(
    src.includes("SYMBOL_LIMITS_COPY.globalFallbackNote"),
    "the global maxContracts field must show the fallback note",
  );
});

test("account form: symbol-limits section is badged Monitoring only", () => {
  const src = read(FORM_FILES.account);
  const idx = src.indexOf("SYMBOL_LIMITS_COPY.heading");
  assert.ok(idx !== -1, "symbol-limits section heading must be rendered");
  const block = src.slice(idx, idx + 260);
  assert.ok(
    block.includes('text="Monitoring only"'),
    "symbol-limits section must carry the 'Monitoring only' badge",
  );
});

test("account form: symbol-limits section does not claim broker-backed enforcement", () => {
  const src = read(FORM_FILES.account);
  const idx = src.indexOf("SYMBOL_LIMITS_COPY.heading");
  const block = src.slice(idx, idx + 400).toLowerCase();
  for (const phrase of ["broker-backed", "broker enforced", "broker will"]) {
    assert.ok(
      !block.includes(phrase),
      `symbol-limits section must not claim "${phrase}"`,
    );
  }
});

// ── Notifications honesty (Telegram + notifications audit) ───────────────────

test("default form: notifications section has no fake onBreachWarn toggle", () => {
  const src = read(FORM_FILES.default);
  // The onBreachWarn checkbox never gated any send path — it was a dead toggle.
  assert.ok(
    !src.includes("Send alert when a rule is triggered"),
    "the default form must not show a fake 'Send alert' toggle that controls nothing",
  );
  assert.ok(
    !src.includes("In-app alerts are planned"),
    "in-app rule notices already render on the Dashboard — copy must not call them planned",
  );
});

test("default form: notifications section honestly describes in-app + Telegram delivery", () => {
  const src = read(FORM_FILES.default);
  assert.ok(
    src.includes("Rule-breach notices appear in-app on the Dashboard"),
    "the default form notifications section must honestly describe in-app delivery",
  );
  assert.ok(
    src.includes("early warning at 80%") && src.includes("loss-streak limit"),
    "the notifications section must describe the two proactive Telegram warnings actually sent",
  );
});

test("account form: notifications section drops the stale inherited-setting framing", () => {
  const src = read(FORM_FILES.account);
  assert.ok(
    !src.includes("Breach alert setting is inherited"),
    "the account form must not present a fictional inherited 'breach alert setting'",
  );
  assert.ok(
    !/Alerts require a connected Telegram channel to fire/.test(src),
    "in-app notices fire without Telegram — the account form must not claim alerts need Telegram",
  );
});

// ── Enforcement accuracy: badges and footer ──────────────────────────────────

test("both forms: max trades badge says 'Guardrail lock' not 'Monitoring only'", () => {
  // max trades, stop after losses, and max contracts all create InternalLockEvent
  // rows on breach (app-level enforcement). Their badges must reflect enforcement,
  // not just monitoring. "Monitoring only" implies no action is taken — incorrect.
  for (const [name, path] of Object.entries(FORM_FILES)) {
    const src = read(path);
    const maxTradesIdx = src.indexOf('"Max trades per day"');
    assert.ok(maxTradesIdx !== -1, `${name}: label 'Max trades per day' must be present`);
    const fieldBlock = src.slice(maxTradesIdx, maxTradesIdx + 400);
    assert.ok(
      fieldBlock.includes('text="Guardrail lock"'),
      `${name}: max trades badge must say "Guardrail lock" — this rule creates an internal lock on breach`,
    );
    assert.ok(
      !fieldBlock.includes('text="Monitoring only"'),
      `${name}: max trades badge must NOT say "Monitoring only" — it locks the account`,
    );
  }
});

test("both forms: stop after losses badge says 'Guardrail lock' not 'Monitoring only'", () => {
  for (const [name, path] of Object.entries(FORM_FILES)) {
    const src = read(path);
    const idx = src.indexOf('"Stop after consecutive losses"');
    assert.ok(idx !== -1, `${name}: label 'Stop after consecutive losses' must be present`);
    const fieldBlock = src.slice(idx, idx + 400);
    assert.ok(
      fieldBlock.includes('text="Guardrail lock"'),
      `${name}: stop-after-losses badge must say "Guardrail lock" — this rule creates an internal lock on breach`,
    );
    assert.ok(
      !fieldBlock.includes('text="Monitoring only"'),
      `${name}: stop-after-losses badge must NOT say "Monitoring only" — it locks the account`,
    );
  }
});

test("both forms: max position size badge says 'Guardrail lock' not 'Monitoring only'", () => {
  // max_position_size creates an InternalLockEvent via the sync path (demo-only).
  for (const [name, path] of Object.entries(FORM_FILES)) {
    const src = read(path);
    const idx = src.indexOf("MAX_POSITION_SIZE_COPY.label");
    assert.ok(idx !== -1, `${name}: MAX_POSITION_SIZE_COPY.label reference must be present`);
    const fieldBlock = src.slice(idx - 20, idx + 400);
    assert.ok(
      fieldBlock.includes('text="Guardrail lock"'),
      `${name}: max position size badge must say "Guardrail lock" — this rule creates an internal lock on breach`,
    );
    assert.ok(
      !fieldBlock.includes('text="Monitoring only"'),
      `${name}: max position size badge must NOT say "Monitoring only" — it locks the account`,
    );
  }
});

test("both forms: footer does NOT say 'All rules currently operate in monitoring mode'", () => {
  // This phrase is incorrect: max trades, stop after losses, and max position size
  // all create Guardrail internal locks on breach — they are not just monitoring.
  for (const [name, path] of Object.entries(FORM_FILES)) {
    const src = read(path);
    assert.ok(
      !src.includes("All rules currently operate in monitoring mode"),
      `${name}: footer must not say "All rules currently operate in monitoring mode" — three rules create internal locks`,
    );
  }
});

test("both forms: footer distinguishes broker-backed daily loss from internal-lock rules", () => {
  // The footer must accurately distinguish: daily loss can be broker-backed;
  // other rules create Guardrail internal locks with no broker action.
  for (const [name, path] of Object.entries(FORM_FILES)) {
    const src = read(path);
    assert.ok(
      src.includes("Daily loss can be broker-backed"),
      `${name}: footer must mention that Daily loss can be broker-backed`,
    );
    assert.ok(
      src.includes("Guardrail internal locks") || src.includes("internal lock"),
      `${name}: footer must mention that other rules create Guardrail internal locks`,
    );
    assert.ok(
      src.includes("no broker actions are sent"),
      `${name}: footer must state no broker actions are sent for non-daily-loss rules`,
    );
  }
});
