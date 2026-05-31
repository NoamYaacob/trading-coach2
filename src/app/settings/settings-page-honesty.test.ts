/**
 * Settings page honesty audit.
 *
 * Guards that the Settings page:
 *   1. Never leaks internal implementation terms to users.
 *   2. Does not advertise controls that do nothing — the Telegram
 *      connect button actually triggers the link-token flow.
 *   3. States Telegram behavior honestly (what it sends today, what is
 *      planned) and never falsely claims setup is unavailable.
 *   4. When the Telegram bot is not configured, renders a friendly
 *      "coming soon" state rather than a runtime error.
 *   5. Keeps destructive (danger zone) copy explicit and gated behind a
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

// ── Telegram bot-not-configured state is friendly ─────────────────────────────

describe("Settings page — Telegram bot-not-configured state", () => {
  it("accepts a botConfigured prop so the server can signal bot availability", () => {
    assert.ok(
      TELEGRAM_SRC.includes("botConfigured"),
      "TelegramConnection must accept a botConfigured prop",
    );
  });

  it("renders a friendly coming-soon state when bot is not configured, not a runtime error", () => {
    assert.ok(
      TELEGRAM_SRC.includes("Coming soon") &&
        TELEGRAM_SRC.includes("bot to be configured"),
      "the bot-not-configured state must say 'Coming soon' and explain the bot needs to be configured",
    );
  });

  it("the bot-not-configured state does not show the connect button or trigger the API", () => {
    // When botConfigured=false the component returns early before the connect button.
    // The guard is the botConfigured branch that precedes the connected/not-connected branches.
    const botBranchIdx = TELEGRAM_SRC.indexOf("!botConfigured");
    const connectBtnIdx = TELEGRAM_SRC.indexOf("Connect Telegram");
    assert.ok(
      botBranchIdx > -1 && botBranchIdx < connectBtnIdx,
      "the !botConfigured branch must appear before the Connect Telegram button",
    );
  });

  it("the settings page passes botConfigured derived from TELEGRAM_BOT_USERNAME env var", () => {
    assert.ok(
      PAGE_SRC.includes("botConfigured") && PAGE_SRC.includes("TELEGRAM_BOT_USERNAME"),
      "the settings page must pass botConfigured based on the TELEGRAM_BOT_USERNAME env var",
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

// ── Sidebar only shows active accounts ────────────────────────────────────────

describe("Settings page — sidebar account filtering", () => {
  it("filters the sidebar to protected and monitor_only accounts only", () => {
    assert.ok(
      PAGE_SRC.includes('"protected"') && PAGE_SRC.includes('"monitor_only"'),
      "settings sidebar must restrict to protected/monitor_only protectionStatus",
    );
  });

  it("excludes accounts missing from broker (missingFromBrokerSince = null check)", () => {
    assert.ok(
      PAGE_SRC.includes("missingFromBrokerSince == null"),
      "settings sidebar must filter out accounts with missingFromBrokerSince set",
    );
  });

  it("uses a separate sidebarAccounts variable so connectedAccounts remains full for broker section", () => {
    assert.ok(
      PAGE_SRC.includes("sidebarAccounts"),
      "settings page must compute sidebarAccounts separately from connectedAccounts",
    );
  });

  it("excludes accounts on an expired or errored broker connection", () => {
    assert.ok(
      PAGE_SRC.includes('"expired"') && PAGE_SRC.includes('"connection_error"'),
      "settings sidebar must exclude expired / connection_error connections",
    );
  });
});

// ── Deep-link anchors ─────────────────────────────────────────────────────────

describe("Settings page — deep-link anchors", () => {
  it("has id='broker-connections' so the Alerts page deep link works", () => {
    // The Alerts page links to /settings#broker-connections for broker-category
    // events. Without this anchor the hash is silently dropped and the page
    // opens at the top instead of scrolling to the broker section.
    assert.ok(
      PAGE_SRC.includes('id="broker-connections"'),
      "settings page must have id='broker-connections' for the /alerts deep link",
    );
  });

  it("broker-connections anchor has scroll-mt so it is not hidden under the page header", () => {
    const idx = PAGE_SRC.indexOf('id="broker-connections"');
    assert.ok(idx !== -1, "broker-connections anchor must exist");
    const surrounding = PAGE_SRC.slice(Math.max(0, idx - 20), idx + 120);
    assert.ok(
      surrounding.includes("scroll-mt"),
      "the broker-connections anchor element must include a scroll-mt-* class",
    );
  });

  it("has id='alerts-telegram' for the Trading Plan Notifications deep link", () => {
    // Existing anchor — guard it stays present.
    assert.ok(
      PAGE_SRC.includes('id="alerts-telegram"'),
      "settings page must preserve the alerts-telegram deep-link anchor",
    );
  });
});

// ── Copy polish ───────────────────────────────────────────────────────────────

describe("Settings page — copy polish", () => {
  it("broker connections section description says 'broker connections', not 'broker accounts'", () => {
    assert.ok(
      PAGE_SRC.includes("broker connections"),
      "Settings page must describe the section as 'broker connections'",
    );
    assert.ok(
      !PAGE_SRC.includes("broker accounts"),
      "Settings page must not say 'broker accounts' in the section description",
    );
  });

  it("inactive accounts section says 'No longer found at broker', not 'Archived / inactive'", () => {
    const src = readFileSync(join(__dirname, "_components/broker-connections-section.tsx"), "utf8");
    assert.ok(
      src.includes("No longer found at broker"),
      "inactive section header must say 'No longer found at broker'",
    );
    assert.ok(
      !src.includes("Archived / inactive"),
      "old 'Archived / inactive' label must be removed",
    );
  });
});
