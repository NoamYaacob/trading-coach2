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

test("account form: pending panel subline says auto-activation at next edit window", () => {
  // The promoter cron is now wired (src/lib/pending-rule-promoter.ts +
  // /api/cron/promote-pending-rules). Copy must reflect that pending
  // changes activate automatically.
  const src = read(FORM_FILES.account);
  assert.ok(
    src.includes("will activate automatically at the next edit window"),
    "pending panel must say 'will activate automatically at the next edit window'",
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

test("account form: shows inherited/default-only summary so missing fields don't feel broken", () => {
  const src = read(FORM_FILES.account);
  assert.ok(
    src.includes("Inherited from default template"),
    "account form must surface the inherited/default-only summary",
  );
  assert.ok(
    /Account size.*daily profit target.*notifications.*Guardian/i.test(src.replace(/\s+/g, " ")),
    "summary must list account size, daily profit target, notifications, and Guardian toggle",
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
