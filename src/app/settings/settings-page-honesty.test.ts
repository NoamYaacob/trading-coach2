/**
 * Settings page honesty audit.
 *
 * Guards that the Settings page:
 *   1. Never leaks internal implementation terms to users.
 *   2. Does not advertise controls that do nothing — the Telegram
 *      connect button actually triggers the link-token flow.
 *   3. States Telegram behavior honestly (what it sends today, what is
 *      planned) and never falsely claims setup is unavailable.
 *   4. Keeps destructive (danger zone) copy explicit and gated behind a
 *      typed confirmation.
 *
 * Source-scan approach mirrors alerts-page-honesty.test.ts.
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const THIS_FILE = "settings-page-honesty.test.ts";

const PAGE_SRC = readFileSync(join(__dirname, "page.tsx"), "utf8");
const TELEGRAM_SRC = readFileSync(join(__dirname, "_components/telegram-connection.tsx"), "utf8");
const DELETE_SRC = readFileSync(join(__dirname, "_components/delete-account.tsx"), "utf8");

const INTERNAL_TERMS = [
  "dry_run",
  "DryRunViolation",
  "GuardianIntervention",
  "InternalLockEvent",
  "BrokerRiskSettingsSyncAudit",
];

function collectSettingsFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSettingsFiles(full, out);
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      entry.name !== THIS_FILE &&
      !entry.name.endsWith(".test.ts")
    ) {
      out.push(full);
    }
  }
}

// ── No internal terms ─────────────────────────────────────────────────────────

describe("Settings page — no internal terms", () => {
  it("leaks no internal implementation terms in any settings source file", () => {
    const files: string[] = [];
    collectSettingsFiles(__dirname, files);

    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const term of INTERNAL_TERMS) {
        assert.ok(
          !src.includes(term),
          `internal term "${term}" must not appear in ${file.slice(__dirname.length + 1)}`,
        );
      }
    }
  });
});

// ── No dead controls ──────────────────────────────────────────────────────────

describe("Settings page — no dead controls", () => {
  it("does not claim Telegram setup is unavailable", () => {
    assert.ok(
      !PAGE_SRC.includes("demo build") && !TELEGRAM_SRC.includes("demo build"),
      "the page must not claim Telegram setup is unavailable in a demo build",
    );
  });

  it("Telegram connect button actually triggers the link-token flow", () => {
    assert.ok(
      TELEGRAM_SRC.includes("/api/telegram/link-token"),
      "the Telegram connect control must call the link-token API, not be a dead button",
    );
  });
});

// ── Telegram copy matches actual behavior ─────────────────────────────────────

describe("Settings page — Telegram copy", () => {
  it("shows a clear connected / not connected state", () => {
    assert.ok(
      TELEGRAM_SRC.includes("Connected") && TELEGRAM_SRC.includes("Not connected"),
      "Telegram setup state must be clearly labelled",
    );
  });

  it("describes what Telegram sends today (rule breaches and behavioral patterns)", () => {
    assert.ok(
      TELEGRAM_SRC.includes("rule breaches") && TELEGRAM_SRC.includes("behavioral patterns"),
      "Telegram copy must explain the alerts it actually sends",
    );
  });

  it("marks unbuilt Telegram features as Planned", () => {
    assert.ok(
      TELEGRAM_SRC.includes("Planned:"),
      "unbuilt Telegram features must be marked Planned, not implied as live",
    );
  });
});

// ── Danger zone copy is clear ─────────────────────────────────────────────────

describe("Settings page — danger zone", () => {
  it("labels the destructive section as a danger zone with irreversible copy", () => {
    assert.ok(
      PAGE_SRC.includes("Danger zone") && PAGE_SRC.includes("Irreversible"),
      "the destructive section must be clearly labelled as irreversible",
    );
  });

  it("delete account spells out exactly what is removed and that it cannot be undone", () => {
    assert.ok(
      DELETE_SRC.includes("cannot be undone") &&
        DELETE_SRC.includes("permanently deletes"),
      "delete-account copy must state the action is permanent and cannot be undone",
    );
  });

  it("delete account is gated behind a typed DELETE confirmation", () => {
    assert.ok(
      DELETE_SRC.includes('confirmText === "DELETE"'),
      "account deletion must require typing DELETE to confirm",
    );
  });
});
