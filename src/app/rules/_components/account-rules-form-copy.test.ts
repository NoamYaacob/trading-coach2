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
  // After the section-parity refactor, inherited default-only fields are
  // surfaced in the section where they conceptually belong rather than in
  // a single consolidated callout:
  //   - Account size + Daily profit target → inside the "Money limits" section
  //     as a small inherited mini-table.
  //   - Breach alerts → inside the "Notifications" section as an inherited card.
  // This mirrors the default template's section list while making it obvious
  // that those fields are managed elsewhere.
  const src = read(FORM_FILES.account);
  assert.ok(src.includes("Account size"), "Money limits section must mention 'Account size' as inherited");
  assert.ok(src.includes("Daily profit target"), "Money limits section must mention 'Daily profit target' as inherited");
  assert.ok(
    /Breach alerts are configured on the default template/i.test(src),
    "Notifications section must explain that breach alerts are inherited",
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
    src.includes("Not active until cutoff scheduling and live order actions are enabled"),
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
  // The hint was updated to reflect the Apex '10 micro = 1 standard' model and
  // to warn that broker hard limits may be raw-contract based. Both forms read
  // MAX_POSITION_SIZE_COPY from position-size-copy.ts so checking the source
  // file is enough to catch regressions.
  const copySrc = readFileSync(
    resolve(import.meta.dirname, "position-size-copy.ts"),
    "utf8",
  );
  assert.match(copySrc, /standard-equivalent/i, "copy must use standard-equivalent framing");
  assert.match(copySrc, /10 micro/i, "hint must explain the Apex 10-micro = 1-standard rule");
  assert.match(copySrc, /raw.{0,20}contract/i, "hint must warn that broker-side limits use raw contract counts, not standard-equivalent weighting");
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
