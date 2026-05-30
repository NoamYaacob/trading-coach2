/**
 * Alerts page honesty + AlertPreferences orphan guard.
 *
 * AlertPreferences is a Prisma model that is NOT wired into the app: no UI
 * renders its toggles and no code reads it before sending alerts. That is
 * acceptable only because nothing promises the user those toggles exist.
 *
 * These guards confirm:
 *   1. The /alerts page exposes no interactive AlertPreferences toggles.
 *   2. The page is a read-only Server Component (no onClick/onChange).
 *   3. AlertPreferences stays orphaned — if any source file starts reading or
 *      rendering it, this test fails so the feature can be finished properly
 *      (preference reads default-false fields could otherwise silently
 *      suppress alerts).
 *   4. The feed layout is honest: queries guardianIntervention, not raw tables.
 *   5. Old static channels/planned sections are gone.
 *
 * Run: npm run test:unit
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const SRC_ROOT = join(__dirname, "../..");
const THIS_FILE = "alerts-page-honesty.test.ts";

const ALERTS_PAGE_SRC = readFileSync(join(__dirname, "page.tsx"), "utf8");

// ── /alerts page is honest and read-only ──────────────────────────────────────

describe("/alerts page", () => {
  it("renders no AlertPreferences toggles", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes("AlertPreferences") &&
        !ALERTS_PAGE_SRC.includes("alertPreferences"),
      "the alerts page must not render or read AlertPreferences",
    );
  });

  it("has no interactive toggle handlers (read-only Server Component)", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes("onChange") && !ALERTS_PAGE_SRC.includes("onClick"),
      "the alerts page must stay read-only — no toggle handlers",
    );
  });

  it("exposes no internal implementation terms to users", () => {
    for (const term of ["dry_run", "DryRunViolation", "GuardianIntervention", "InternalLockEvent"]) {
      assert.ok(
        !ALERTS_PAGE_SRC.includes(term),
        `internal term "${term}" must not appear in user-facing copy`,
      );
    }
  });
});

// ── Trigger honesty: only wired triggers are shown as active ──────────────────

describe("/alerts page trigger honesty", () => {
  it("does not query dailyProfitTarget (not a live trigger)", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes("dailyProfitTarget"),
      "dailyProfitTarget is not wired to an alert — must not be queried or claimed as active",
    );
  });

  it("does not query newsLockoutEnabled (not a live trigger)", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes("newsLockoutEnabled"),
      "newsLockoutEnabled is not wired to an alert — must not be queried or claimed as active",
    );
  });

  it("does not query riskPerTrade — no unrealized-drawdown trigger is wired", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes("riskPerTrade"),
      "riskPerTrade is not wired to an alert — must not be queried or claimed as active",
    );
  });
});

// ── Feed layout ───────────────────────────────────────────────────────────────

describe("/alerts page — feed layout", () => {
  it("queries guardianIntervention for the alert feed", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("guardianIntervention.findMany"),
      "the alerts page must query guardianIntervention for the feed data",
    );
  });

  it("scopes the feed query by userId: user.id (no cross-user leakage)", () => {
    const feedIdx = ALERTS_PAGE_SRC.indexOf("guardianIntervention.findMany");
    const whereBlock = ALERTS_PAGE_SRC.slice(feedIdx, feedIdx + 200);
    assert.ok(
      whereBlock.includes("userId: user.id"),
      "the feed query must scope by userId: user.id",
    );
  });

  it("shows 'Notification settings' link to /settings#alerts-telegram", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("/settings#alerts-telegram") &&
        ALERTS_PAGE_SRC.includes("Notification settings"),
      "must render a 'Notification settings' link pointing to /settings#alerts-telegram",
    );
  });

  it("empty state shows 'No alerts yet'", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("No alerts yet"),
      "empty state must show 'No alerts yet'",
    );
  });

  it("empty state explains what kinds of alerts will appear", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes(
        "Guardrail will show rule breaches, session events, and broker sync events here.",
      ),
      "empty state must explain what kinds of alerts Guardrail will show",
    );
  });

  it("feed rows include a 'View →' action link", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("View →"),
      "feed rows must include a 'View →' action link",
    );
  });

  it("rule alerts route to /rules", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("/rules?scope=account"),
      "rule alerts must link to /rules?scope=account&id=<accountId>",
    );
  });

  it("system/session alerts route to /dashboard?accountId=<id> (not Settings)", () => {
    // outside_session_hours is a trading-activity event, so its View link must
    // go to the Dashboard scoped to the account — never to a settings page.
    assert.ok(
      ALERTS_PAGE_SRC.includes("/dashboard?accountId="),
      "system/session alerts must link to /dashboard?accountId=<id>",
    );
    // Guard: the system route must not be pointed at Settings.
    assert.ok(
      !ALERTS_PAGE_SRC.includes("/settings#session") &&
        !ALERTS_PAGE_SRC.includes("outside_session_hours.*settings"),
      "system/session alerts must not route to Settings",
    );
  });
});

// ── Filter chips ──────────────────────────────────────────────────────────────

describe("/alerts page — filter chips", () => {
  it("has All filter chip", () => {
    assert.ok(ALERTS_PAGE_SRC.includes('"All"') || ALERTS_PAGE_SRC.includes("\"All\"") || ALERTS_PAGE_SRC.includes("label: \"All\"") || ALERTS_PAGE_SRC.includes("{ key: \"all\",    label: \"All\" }") || ALERTS_PAGE_SRC.includes("All"), "must have an All filter chip");
    // Check FILTER_CHIPS array contains "all"
    assert.ok(ALERTS_PAGE_SRC.includes('"all"') && ALERTS_PAGE_SRC.includes("All"), "FILTER_CHIPS must contain the all chip");
  });

  it("has Rule alerts filter chip", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("Rule alerts"),
      "must have a 'Rule alerts' filter chip",
    );
  });

  it("has System filter chip", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes('"system"') && ALERTS_PAGE_SRC.includes("System"),
      "must have a System filter chip",
    );
  });

  it("does NOT expose a dead Broker filter chip (no broker events exist yet)", () => {
    // GuardianIntervention stores no broker-connection events, so a Broker chip
    // would only ever show an empty state. It must stay out of FILTER_CHIPS
    // until a real broker-event source exists.
    const chipsStart = ALERTS_PAGE_SRC.indexOf("const FILTER_CHIPS");
    const chipsEnd = ALERTS_PAGE_SRC.indexOf("] as const", chipsStart);
    const chipsBlock = ALERTS_PAGE_SRC.slice(chipsStart, chipsEnd);
    assert.ok(
      !chipsBlock.includes("Broker") && !chipsBlock.includes('"broker"'),
      "FILTER_CHIPS must not include a Broker chip while no broker events exist",
    );
  });

  it("has Today only chip", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("Today only"),
      "must have a 'Today only' filter chip",
    );
  });

  it("filter chips use Link href, not onClick (URL-param based navigation)", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes("onClick") &&
        ALERTS_PAGE_SRC.includes('sp.set("filter"'),
      "filter chips must navigate via URL params (?filter=...), not onClick handlers",
    );
  });
});

// ── Account switcher ──────────────────────────────────────────────────────────

describe("/alerts page — account switcher", () => {
  it("renders an 'All accounts' option", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("All accounts"),
      "the account switcher must offer an 'All accounts' option",
    );
  });

  it("account selection is controlled by the accountId URL param", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("params.accountId") &&
        ALERTS_PAGE_SRC.includes('sp.set("accountId"'),
      "the selected account must come from / build into the accountId URL param",
    );
  });

  it("scopes the feed by accountId when an account is selected", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("requestedAccountId ? { accountId: requestedAccountId }"),
      "the feed query must filter by accountId only when one is requested",
    );
  });

  it("'All accounts' clears the accountId param (does not filter by account)", () => {
    // The All-accounts link passes accountId: null, which buildHref omits from
    // the query string — so no accountId filter is applied.
    assert.ok(
      ALERTS_PAGE_SRC.includes("buildHref({ accountId: null })"),
      "the All-accounts pill must clear the accountId param",
    );
  });

  it("switcher pills render friendly account labels, not raw ids", () => {
    // Pills map over switcher accounts and render acc.label (the friendly
    // broker label). acc.id may only appear as a React key / comparison, never
    // as a rendered JSX text child (e.g. `>{acc.id}<`).
    const switcherIdx = ALERTS_PAGE_SRC.indexOf("Account switcher");
    const filterIdx = ALERTS_PAGE_SRC.indexOf("Filter chips");
    const block = ALERTS_PAGE_SRC.slice(switcherIdx, filterIdx);
    assert.ok(
      block.includes("{acc.label}"),
      "account switcher pills must show acc.label",
    );
    assert.ok(
      !/>\s*\{acc\.id\}\s*</.test(block),
      "account switcher pills must not render raw acc.id as visible text",
    );
  });
});

// ── Humanized trigger labels + softened technical messages ────────────────────

describe("/alerts page — humanized labels", () => {
  it("maps technical trigger types to friendly titles", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes('"trade_limit":') &&
        ALERTS_PAGE_SRC.includes('return "Trade limit"'),
      "trade_limit must map to 'Trade limit'",
    );
    assert.ok(
      ALERTS_PAGE_SRC.includes('"max_position_size":') &&
        ALERTS_PAGE_SRC.includes('return "Max position size"'),
      "max_position_size must map to 'Max position size'",
    );
    assert.ok(
      ALERTS_PAGE_SRC.includes('"daily_loss_limit":') &&
        ALERTS_PAGE_SRC.includes('return "Daily loss limit"'),
      "daily_loss_limit must map to 'Daily loss limit'",
    );
    assert.ok(
      ALERTS_PAGE_SRC.includes('"outside_session_hours":') &&
        ALERTS_PAGE_SRC.includes('return "Outside trading hours"'),
      "outside_session_hours must map to 'Outside trading hours'",
    );
  });

  it("softens technical/log messages instead of showing them raw", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("isTechnicalMessage") &&
        ALERTS_PAGE_SRC.includes("TECHNICAL_MARKERS"),
      "the page must detect and soften technical messages",
    );
    assert.ok(
      ALERTS_PAGE_SRC.includes("rowSummary"),
      "the page must compute a human row summary, not render raw message verbatim",
    );
  });

  it("does not surface raw broker endpoint / autoliq tokens as row copy constants", () => {
    // These raw tokens must never be hard-coded user-facing strings. (They may
    // legitimately appear inside the TECHNICAL_MARKERS detector regex.)
    const markersIdx = ALERTS_PAGE_SRC.indexOf("TECHNICAL_MARKERS");
    const markersEnd = ALERTS_PAGE_SRC.indexOf(";", markersIdx);
    const withoutDetector =
      ALERTS_PAGE_SRC.slice(0, markersIdx) + ALERTS_PAGE_SRC.slice(markersEnd);
    assert.ok(
      !withoutDetector.includes("userAccountAutoLiq") &&
        !withoutDetector.includes("dailyLossAutoLiq") &&
        !withoutDetector.includes("connected_readonly"),
      "raw broker tokens must not be rendered as user-facing copy",
    );
  });
});

// ── Grouping of repeated alerts ───────────────────────────────────────────────

describe("/alerts page — repeated alert grouping", () => {
  it("groups consecutive repeats by triggerType + accountId + day", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("last.triggerType === e.triggerType") &&
        ALERTS_PAGE_SRC.includes("last.accountId === e.accountId") &&
        ALERTS_PAGE_SRC.includes("dayKey(last.createdAt) === dayKey(e.createdAt)"),
      "the feed must collapse consecutive same-type/account/day alerts into one row",
    );
  });

  it("shows a count when a row groups multiple alerts", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("row.count > 1") &&
        ALERTS_PAGE_SRC.includes("similar"),
      "a grouped row must show how many similar alerts it represents",
    );
  });
});

// ── Per-filter / per-account empty states ─────────────────────────────────────

describe("/alerts page — empty states", () => {
  it("has a 'No alerts today' empty state for Today only", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("No alerts today"),
      "Today-only with no results must show 'No alerts today'",
    );
  });

  it("has a 'No rule alerts yet' empty state for Rule alerts", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("No rule alerts yet"),
      "Rule-alerts filter with no results must show 'No rule alerts yet'",
    );
  });

  it("has a 'No alerts for this account yet' empty state for a selected account", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("No alerts for this account yet"),
      "an account-scoped view with no results must show a per-account empty state",
    );
  });
});

// ── No raw DB ids in visible text ─────────────────────────────────────────────

describe("/alerts page — no raw ids leaked", () => {
  it("event.id is only used as a React key, never rendered as text", () => {
    // event.id may seed row.key; row.key is used as a React key prop only.
    assert.ok(
      !ALERTS_PAGE_SRC.includes("{event.id}") && !ALERTS_PAGE_SRC.includes("{row.accountId}"),
      "raw event/account ids must not be rendered as visible text",
    );
  });
});

// ── Old static sections are gone ─────────────────────────────────────────────

describe("/alerts page — old static sections removed", () => {
  it("does not show a Channels section card", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes('"Channels"') && !ALERTS_PAGE_SRC.includes("'Channels'"),
      "the old Channels section card must be removed",
    );
  });

  it("does not show Email coming soon", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes("Email") || !ALERTS_PAGE_SRC.includes("Coming soon"),
      "the Email coming soon content must be removed",
    );
  });

  it("does not show Planned & coming soon section", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes("Planned &amp; coming soon") &&
        !ALERTS_PAGE_SRC.includes("Planned & coming soon"),
      "the old 'Planned & coming soon' section must be removed",
    );
  });

  it("does not show Alert preferences are planned text", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes("Alert preferences are planned"),
      "the old 'Alert preferences are planned' roadmap card must be removed",
    );
  });

  it("does not show old behavioral trigger section", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes("Revenge entry") &&
        !ALERTS_PAGE_SRC.includes("Rapid trading") &&
        !ALERTS_PAGE_SRC.includes("Size increase after loss"),
      "behavioral trigger rows must be removed from the new feed-based page",
    );
  });
});

// ── AlertPreferences stays orphaned ───────────────────────────────────────────

function collectSourceFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, out);
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      entry.name !== THIS_FILE
    ) {
      out.push(full);
    }
  }
}

describe("AlertPreferences model", () => {
  it("is not referenced anywhere in src/ (orphaned schema, not a broken feature)", () => {
    const files: string[] = [];
    collectSourceFiles(SRC_ROOT, files);

    const offenders = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return src.includes("alertPreferences") || src.includes("AlertPreferences");
    });

    assert.deepEqual(
      offenders.map((f) => f.slice(SRC_ROOT.length + 1)),
      [],
      "AlertPreferences must remain unwired until a real preferences UI exists; " +
        "wiring reads of its default-false fields could silently suppress alerts",
    );
  });
});

// ── Sidebar only shows active accounts ────────────────────────────────────────

describe("/alerts page — sidebar account filtering", () => {
  it("sidebar query restricts to protected and monitor_only protectionStatus", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes('"protected"') && ALERTS_PAGE_SRC.includes('"monitor_only"'),
      "alerts sidebar must restrict to protected/monitor_only — not { not: 'archived' }",
    );
  });

  it("sidebar query filters out accounts missing from broker", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("missingFromBrokerSince: null"),
      "alerts sidebar must filter missingFromBrokerSince: null to exclude unavailable accounts",
    );
  });

  it("excludes accounts on an expired or errored broker connection", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes('"expired"') &&
        ALERTS_PAGE_SRC.includes('"connection_error"'),
      "alerts sidebar must exclude expired / connection_error connections",
    );
  });
});
