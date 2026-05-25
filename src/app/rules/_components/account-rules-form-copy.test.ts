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

// Section components extracted from the account form. Source-scan tests treat
// the account form and its section files as one logical source — any string
// they assert may live in any of these files.
const ACCOUNT_SECTION_FILES = [
  // Core rules absorbed money-limits + trading-behavior + position-symbol
  // maxContracts into a single compact card.
  resolve(import.meta.dirname, "sections/core-rules-section.tsx"),
  // Symbol-limits row is the collapsed-by-default version of the former
  // Position & symbol controls card.
  resolve(import.meta.dirname, "sections/symbol-limits-row.tsx"),
  resolve(import.meta.dirname, "sections/session-cutoff-section.tsx"),
  resolve(import.meta.dirname, "sections/notifications-section.tsx"),
  resolve(import.meta.dirname, "sections/advanced-broker-actions-section.tsx"),
  resolve(import.meta.dirname, "sections/field-primitives.tsx"),
] as const;

const FORM_FILES = {
  account: resolve(import.meta.dirname, "account-rules-form.tsx"),
  default: resolve(import.meta.dirname, "rules-form.tsx"),
} as const;

function read(path: string): string {
  const base = readFileSync(path, "utf8");
  // When reading the account form, also include the source of every section
  // component it composes. Copy that used to live inline now lives in those
  // section files, so source-scan assertions need to see them as one source.
  if (path === FORM_FILES.account) {
    const sections = ACCOUNT_SECTION_FILES.map((f) => readFileSync(f, "utf8")).join("\n");
    return `${base}\n${sections}`;
  }
  return base;
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

test("both forms use a 'Risk per trade' label — no 'Max risk per trade' divergence", () => {
  // Default and account forms drifted on this label: default form said
  // 'Max risk per trade' and account form said 'Risk per trade'. The DB
  // column is `maxRiskPerTrade`/`riskPerTrade` (legacy schema), but the
  // user-visible label must not imply a different rule semantics.
  // PR #39: the account form card design drops the trailing '($)' from the
  // card label since the large value already shows '$'; the default form
  // (field-style) still uses 'Risk per trade ($)'. Neither must say 'Max'.
  const defaultSrc = read(FORM_FILES.default);
  const accountSrc = read(FORM_FILES.account);
  assert.ok(
    defaultSrc.includes('label="Risk per trade ($)"'),
    "default form must label this field 'Risk per trade ($)' — do NOT regress to 'Max risk per trade'",
  );
  assert.ok(
    accountSrc.includes('"Risk per trade"') || accountSrc.includes('"Risk per trade ($)"'),
    "account form must label this field 'Risk per trade' (with or without '$' suffix)",
  );
  assert.ok(
    !defaultSrc.includes('"Max risk per trade ($)"'),
    "default form must not contain the old 'Max risk per trade ($)' label",
  );
  assert.ok(
    !accountSrc.includes('"Max risk per trade'),
    "account form must not say 'Max risk per trade' — this label implies a different rule",
  );
});

test("both forms use the SAME risk-per-trade hint copy", () => {
  const defaultSrc = read(FORM_FILES.default);
  const accountSrc = read(FORM_FILES.account);
  const SHARED_HINT = "Warning only — does not lock the account.";
  assert.ok(defaultSrc.includes(SHARED_HINT), "default form must use shared risk-per-trade hint");
  assert.ok(accountSrc.includes(SHARED_HINT), "account form must use shared risk-per-trade hint");
});

test("default form exposes the canonical four section cards in order", () => {
  // Default template form sections (still inline): Money limits → Trading
  // limits → Daily cutoff → Notifications → Trading Session (separate
  // component). The default form keeps its existing structure for now; the
  // section-card refactor lands on the account form first.
  const SECTIONS = [
    'aria-label="Money limits"',
    'aria-label="Trading limits"',
    'aria-label="Daily cutoff"',
    'aria-label="Notifications"',
  ];
  const src = read(FORM_FILES.default);
  let lastIdx = -1;
  for (const section of SECTIONS) {
    const idx = src.indexOf(section);
    assert.ok(
      idx !== -1,
      `default form is missing section ${section} — it must declare the canonical section list`,
    );
    assert.ok(
      idx > lastIdx,
      `default form declares ${section} before an earlier section in the canonical order`,
    );
    lastIdx = idx;
  }
});

test("account form exposes Core rules first, followed by collapsed advanced rows", () => {
  // Redesigned layout (PR #37): the five enforce-today rules live in a
  // single Core rules card; everything else (per-symbol caps, session
  // cutoff, notifications, advanced broker actions, planned rules) is a
  // <details>-wrapped collapsed row underneath.
  //
  // Each row declares its label either via SectionCard's ariaLabel prop
  // (Core rules card) or via aria-label on a <details> wrapper (the
  // collapsed advanced rows). The helper accepts either syntax.
  const SECTIONS = [
    "Core rules",
    "Contract limits by symbol",
    "Session cutoff",
    "Notifications",
    "Advanced broker actions",
  ];
  const src = read(FORM_FILES.account);
  let lastIdx = -1;
  for (const section of SECTIONS) {
    const idxA = src.indexOf(`ariaLabel="${section}"`);
    const idxB = src.indexOf(`aria-label="${section}"`);
    const candidates = [idxA, idxB].filter((i) => i !== -1);
    assert.ok(
      candidates.length > 0,
      `account form is missing section "${section}" — must declare it via ariaLabel or aria-label`,
    );
    const idx = Math.min(...candidates);
    assert.ok(
      idx > lastIdx,
      `account form declares "${section}" before an earlier section in the canonical order`,
    );
    lastIdx = idx;
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

// ── Trading session selector removed from the account form (Phase 2 cleanup) ─

test("account form does NOT render TradingSessionSelector — removed in Phase 2 cleanup", () => {
  // The trading-session selector is not part of the core account-risk setup,
  // is not connected to active broker enforcement, and made the page feel
  // overloaded. It was removed from the account-specific form. The component
  // still exists and is used by the default-template form (rules-form.tsx);
  // this test guards against a future re-mount in the account form.
  //
  // `read(FORM_FILES.account)` concatenates the form + every section file —
  // if any of them re-introduce the selector, this test fires.
  const src = read(FORM_FILES.account);
  assert.ok(
    !src.includes("<TradingSessionSelector"),
    "account form must not render <TradingSessionSelector> — it was removed during the Phase 2 cleanup",
  );
  assert.ok(
    !/from\s+["']\.\/trading-session-selector["']/.test(src) &&
      !/from\s+["']\.\.\/trading-session-selector["']/.test(src),
    "account form (and its section files) must not import TradingSessionSelector",
  );
});

test("default form STILL renders TradingSessionSelector — only the account form removed it", () => {
  // Safety: the cleanup must not delete the underlying component or its
  // usage on the default template, since that form still configures
  // session presets for accounts that fall back to defaults.
  const src = read(FORM_FILES.default);
  assert.ok(
    src.includes("<TradingSessionSelector"),
    "default-template form must still render <TradingSessionSelector>",
  );
});

// ── Progressive disclosure: collapsed sections and Learn more (UX cleanup) ───

test("account form: Advanced broker actions is collapsed by default", () => {
  // After the UX cleanup the section is a <details> with no `open` attribute,
  // so the four planned actions are tucked away until the user expands them.
  // Source-scan: confirm the section uses <details> and does NOT default to open.
  const src = read(FORM_FILES.account);
  const idx = src.indexOf('aria-label="Advanced broker actions"');
  assert.ok(idx !== -1, "Advanced broker actions section must declare aria-label");
  // Walk backwards a short distance to find the opening tag this aria-label belongs to.
  const before = src.slice(Math.max(0, idx - 200), idx + 60);
  assert.ok(
    /<details\b[^>]*$/.test(before.replace(/\s+/g, " ").split("aria-label")[0] ?? "") ||
      /<details\b/.test(before),
    "Advanced broker actions must be wrapped in a <details> element",
  );
  // The tag must NOT carry the `open` attribute — collapsed by default.
  const tagBlock = src.slice(Math.max(0, idx - 200), idx + 200);
  assert.ok(
    !/<details\b[^>]*\bopen\b/.test(tagBlock),
    "Advanced broker actions <details> must not default to open",
  );
});

/**
 * Strip JSDoc block comments + single-line comments so source-scan assertions
 * only see customer-visible JSX/TSX — not commentary that may legitimately
 * mention placeholder rule names while explaining why they were moved.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

test("account form: Max trades per week is NOT shown as a primary Core rules row", () => {
  // The placeholder moved to PlannedRulesSection (collapsed). Core rules
  // must only contain the rules that actually enforce today (max trades/day +
  // stop after losses + dollar limits + max contracts) so the card stays scannable.
  const coreRules = codeOnly(
    readFileSync(
      resolve(import.meta.dirname, "sections/core-rules-section.tsx"),
      "utf8",
    ),
  );
  assert.ok(
    !coreRules.includes("Max trades per week"),
    "Max trades per week must not appear in core-rules-section JSX — move it to PlannedRulesSection",
  );
});

test("account form: Symbol blocks is NOT shown as a primary symbol-limits row", () => {
  // Same reasoning as Max trades per week: Symbol blocks is not implemented
  // and must not compete with the rules that actually enforce today.
  const symbolLimitsRow = codeOnly(
    readFileSync(
      resolve(import.meta.dirname, "sections/symbol-limits-row.tsx"),
      "utf8",
    ),
  );
  assert.ok(
    !symbolLimitsRow.includes("Symbol blocks"),
    "Symbol blocks must not appear in symbol-limits-row JSX — move it to PlannedRulesSection",
  );
});

test("account form: PlannedRulesSection collapses the not-yet-active rules", () => {
  // Both placeholder rules live in the new collapsed PlannedRulesSection.
  // It must use <details> (collapsed by default) and must list both rule names.
  const planned = readFileSync(
    resolve(import.meta.dirname, "sections/planned-rules-section.tsx"),
    "utf8",
  );
  assert.ok(planned.includes("<details"), "PlannedRulesSection must use <details>");
  assert.ok(
    !/<details\b[^>]*\bopen\b/.test(planned),
    "PlannedRulesSection <details> must not default to open",
  );
  assert.ok(
    planned.includes("Max trades per week") && planned.includes("Symbol blocks"),
    "PlannedRulesSection must list both not-active placeholders",
  );
});

test("account form: long helper copy is gated behind a 'Learn more' disclosure", () => {
  // The progressive-disclosure pattern uses the Field component's `details`
  // prop, which renders a collapsed <details><summary>Learn more</summary>...
  // Confirm at least one Field across the section files uses details=.
  const src = read(FORM_FILES.account);
  assert.ok(
    src.includes("Learn more"),
    "section cards must surface long copy behind a 'Learn more' disclosure",
  );
  assert.ok(
    src.includes("details="),
    "at least one Field must wire its long copy through the `details` prop",
  );
});

// ── Disabled-state visual hierarchy (Phase 2 cleanup) ────────────────────────

test("account form: locked fieldset does NOT use opacity-50 (text stays readable)", () => {
  // The previous disabled state combined a heavy `opacity-50` filter with
  // the browser's native disabled input styling, which washed out section
  // titles, helper text, and inherited-context strips so badly that the
  // page became hard to scan. Inputs are still natively disabled via
  // `<fieldset disabled>` — we no longer overlay opacity on top.
  const src = read(FORM_FILES.account);
  // Find the editable fieldset wrapper and inspect its className expression.
  const idx = src.indexOf("disabled={fieldsDisabled}");
  assert.ok(idx !== -1, "fieldset must still be disabled when fieldsDisabled is true");
  const block = src.slice(idx, idx + 400);
  assert.ok(
    !block.includes("opacity-50"),
    "the locked fieldset must not apply opacity-50 — text must stay readable",
  );
  assert.ok(
    block.includes("cursor-not-allowed"),
    "the locked fieldset must still use cursor-not-allowed to signal the disabled state",
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
  // After the PR #37 redesign, the chain runs:
  //   account-rules-form.tsx → <SymbolLimitsRow disabled={fieldsDisabled} />
  //   symbol-limits-row.tsx  → <SymbolLimitsTable disabled={disabled} />
  // Both ends must be wired or a locked account becomes editable for symbol limits.
  const src = read(FORM_FILES.account);
  const idx = src.indexOf("<SymbolLimitsTable");
  assert.ok(idx !== -1, "SymbolLimitsTable must be rendered");
  const block = src.slice(idx, idx + 320);
  assert.ok(
    block.includes("disabled={disabled}"),
    "SymbolLimitsTable must receive disabled={disabled} so a locked account is read-only",
  );
  // Verify the parent form propagates fieldsDisabled into the row's disabled prop.
  const rowIdx = src.indexOf("<SymbolLimitsRow");
  assert.ok(rowIdx !== -1, "account form must render <SymbolLimitsRow>");
  // The JSX block ends at the self-close `/>` of the row's opening tag.
  const rowBlock = src.slice(rowIdx, src.indexOf("/>", rowIdx) + 2);
  assert.ok(
    rowBlock.includes("disabled={fieldsDisabled}"),
    "account form must pass fieldsDisabled into the SymbolLimitsRow's disabled prop",
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

test("account form: symbol-limits section is badged 'Saved · Evaluation coming soon'", () => {
  // Symbol limits are stored on the rule record but the guardian evaluator
  // does not read them yet, so the badge must say "Saved · Evaluation coming
  // soon" — not "Monitoring only" (which would imply live warning evaluation).
  const src = read(FORM_FILES.account);
  const idx = src.indexOf("SYMBOL_LIMITS_COPY.heading");
  assert.ok(idx !== -1, "symbol-limits section heading must be rendered");
  const block = src.slice(idx, idx + 320);
  assert.ok(
    block.includes('variant="saved-eval-soon"'),
    "symbol-limits section must carry the 'Saved · Evaluation coming soon' badge variant",
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

// Match any of three syntaxes used across the rules forms:
//   - Default form: <StatusBadge text="Guardrail lock" />          (legacy)
//   - Old section card: <RuleStatusBadge variant="guardrail-lock" />
//   - New compact row: <RuleRow status="guardrail-lock" />          (PR #37)
// All three resolve to the same canonical badge variant.
function hasGuardrailLockBadge(block: string): boolean {
  return (
    block.includes('text="Guardrail lock"') ||
    block.includes('variant="guardrail-lock"') ||
    block.includes('status="guardrail-lock"')
  );
}

function claimsMonitoringOnly(block: string): boolean {
  return (
    block.includes('text="Monitoring only"') ||
    block.includes('variant="monitoring-only"') ||
    block.includes('status="monitoring-only"')
  );
}

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
      hasGuardrailLockBadge(fieldBlock),
      `${name}: max trades badge must say "Guardrail lock" — this rule creates an internal lock on breach`,
    );
    assert.ok(
      !claimsMonitoringOnly(fieldBlock),
      `${name}: max trades badge must NOT say "Monitoring only" — it locks the account`,
    );
  }
});

test("both forms: stop after losses badge says 'Guardrail lock' not 'Monitoring only'", () => {
  // PR #39: account form card relabels this rule "Tilt protection" (field key stopAfterLosses
  // is unchanged). Default form still says "Stop after consecutive losses". Check each form
  // by its own label convention so divergence is intentional, not accidental.
  for (const [name, path] of Object.entries(FORM_FILES)) {
    const src = read(path);
    // Account form uses "Tilt protection"; default form uses the original label.
    const accountLabel = '"Tilt protection"';
    const defaultLabel = '"Stop after consecutive losses"';
    const idx =
      src.indexOf(accountLabel) !== -1
        ? src.indexOf(accountLabel)
        : src.indexOf(defaultLabel);
    assert.ok(
      idx !== -1,
      `${name}: stop-after-losses label must be present as 'Tilt protection' or 'Stop after consecutive losses'`,
    );
    const fieldBlock = src.slice(idx, idx + 400);
    assert.ok(
      hasGuardrailLockBadge(fieldBlock),
      `${name}: stop-after-losses badge must say "Guardrail lock" — this rule creates an internal lock on breach`,
    );
    assert.ok(
      !claimsMonitoringOnly(fieldBlock),
      `${name}: stop-after-losses badge must NOT say "Monitoring only" — it locks the account`,
    );
  }
});

test("both forms: max position size badge says 'Guardrail lock' not 'Monitoring only'", () => {
  // max_position_size creates an InternalLockEvent via the sync path (demo-only).
  // PR #39: account form card uses label="Max contracts" (spec: shorter card label);
  // the guardrail-lock badge is on the same RuleCard. Default form still uses
  // MAX_POSITION_SIZE_COPY.label. Check each form by its own label convention.
  for (const [name, path] of Object.entries(FORM_FILES)) {
    const src = read(path);
    // Account sections: look for the "Max contracts" RuleCard with status="guardrail-lock"
    // Default form: look for MAX_POSITION_SIZE_COPY.label near a guardrail-lock badge
    const accountCardLabel = '"Max contracts"';
    const defaultRef = "MAX_POSITION_SIZE_COPY.label";
    const idxAccount = src.indexOf(accountCardLabel);
    const idxDefault = src.indexOf(defaultRef);
    const idx = idxAccount !== -1 ? idxAccount : idxDefault;
    assert.ok(
      idx !== -1,
      `${name}: max position size must appear as "Max contracts" card or MAX_POSITION_SIZE_COPY.label reference`,
    );
    // For the account form, the RuleCard has status="guardrail-lock" on the same tag.
    // For the default form, the badge appears within ~400 chars of the label reference.
    const fieldBlock = src.slice(Math.max(0, idx - 20), idx + 400);
    assert.ok(
      hasGuardrailLockBadge(fieldBlock),
      `${name}: max position size badge must say "Guardrail lock" — this rule creates an internal lock on breach`,
    );
    assert.ok(
      !claimsMonitoringOnly(fieldBlock),
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
