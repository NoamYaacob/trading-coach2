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

  it("feed rows include a clear action link with an arrow", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("{actionLabel} →"),
      "feed rows must include an action link (e.g. 'View rules →')",
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

  it("has a System filter chip definition (shown conditionally)", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes('"system"') && ALERTS_PAGE_SRC.includes("System"),
      "must define a System filter chip",
    );
  });

  it("System chip is hidden when the user has no system alerts", () => {
    // The System chip must be gated on whether any system alert exists for this
    // user (or the user manually navigated to ?filter=system) — never a dead
    // filter that usually shows empty.
    assert.ok(
      ALERTS_PAGE_SRC.includes("systemAlertCount") &&
        ALERTS_PAGE_SRC.includes("showSystemChip"),
      "the System chip must be gated on a system-alert count",
    );
    assert.ok(
      /showSystemChip\s*=\s*systemAlertCount > 0 \|\| activeFilter === "system"/.test(ALERTS_PAGE_SRC),
      "showSystemChip must be true only when a system alert exists or ?filter=system is active",
    );
    assert.ok(
      ALERTS_PAGE_SRC.includes("showSystemChip ? [{ key: \"system\""),
      "the System chip must be conditionally appended to the chip list",
    );
  });

  it("counts system alerts with a userId-scoped query", () => {
    const countIdx = ALERTS_PAGE_SRC.indexOf("guardianIntervention.count");
    assert.ok(countIdx !== -1, "must count system alerts via guardianIntervention.count");
    const block = ALERTS_PAGE_SRC.slice(countIdx, countIdx + 160);
    assert.ok(
      block.includes("userId: user.id"),
      "the system-alert count must be scoped by userId",
    );
  });

  it("does NOT expose a Broker filter chip (no broker events exist yet)", () => {
    assert.ok(
      !ALERTS_PAGE_SRC.includes('{ key: "broker"') &&
        !ALERTS_PAGE_SRC.includes('label: "Broker"'),
      "the chip list must not include a Broker chip while no broker events exist",
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

  it("switcher pills render friendly derived labels, not raw ids", () => {
    // Pills render the friendly name from accountMeta / deriveAccountDisplayLabel.
    // Neither acc.id nor acc.label (a raw broker number) is rendered as the
    // primary visible JSX text child.
    const switcherIdx = ALERTS_PAGE_SRC.indexOf("Account switcher");
    const filterIdx = ALERTS_PAGE_SRC.indexOf("Filter chips");
    const block = ALERTS_PAGE_SRC.slice(switcherIdx, filterIdx);
    assert.ok(
      block.includes("meta?.name"),
      "account switcher pills must render the derived friendly name (meta.name)",
    );
    assert.ok(
      !/>\s*\{acc\.id\}\s*</.test(block) && !/>\s*\{acc\.label\}\s*</.test(block),
      "switcher pills must not render raw acc.id / acc.label as primary visible text",
    );
  });
});

// ── Friendly account naming (no long broker ids as primary labels) ────────────

describe("/alerts page — friendly account naming", () => {
  it("uses the shared deriveAccountDisplayLabel helper", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("deriveAccountDisplayLabel") &&
        ALERTS_PAGE_SRC.includes('from "@/lib/account-display"'),
      "the page must derive friendly account names via deriveAccountDisplayLabel",
    );
  });

  it("selects displayName / propFirm / accountType for friendly naming", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("displayName: true") &&
        ALERTS_PAGE_SRC.includes("propFirm: true") &&
        ALERTS_PAGE_SRC.includes("accountType: true"),
      "the account query must select the fields needed for a friendly label",
    );
  });

  it("exposes the broker id only as a title attribute, never primary text", () => {
    // The raw broker account number lives on meta.brokerId and is only passed to
    // a `title=` attribute (tooltip) — never rendered as a visible text node.
    assert.ok(
      ALERTS_PAGE_SRC.includes("title={meta?.brokerId"),
      "broker ids must be surfaced only via a title attribute",
    );
    assert.ok(
      !/>\s*\{meta\?\.brokerId\}\s*</.test(ALERTS_PAGE_SRC) &&
        !/>\s*\{meta\.brokerId\}\s*</.test(ALERTS_PAGE_SRC),
      "broker ids must not be rendered as visible text",
    );
  });
});

// ── Rich, human alert summaries ───────────────────────────────────────────────

describe("/alerts page — humanized summaries", () => {
  it("daily loss summary says what happened and what Guardrail did", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes(
        "Daily loss limit reached. Guardrail stopped this account for the session.",
      ),
      "daily_loss_limit must have a rich human summary",
    );
  });

  it("trade limit summary explains new trades are blocked", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes(
        "Trade limit reached. New trades are blocked for the rest of the session.",
      ),
      "trade_limit must explain that new trades are blocked",
    );
  });

  it("position size summary explains the flag + monitoring", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes(
        "Position size limit exceeded. Guardrail flagged the account and kept monitoring.",
      ),
      "max_position_size must explain Guardrail flagged + monitored",
    );
  });

  it("outside-session summary is human", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("Trade activity detected outside your selected session."),
      "outside_session_hours must have a human summary",
    );
  });

  it("known trigger types always use the curated summary (never raw message)", () => {
    // rowSummary returns the canned TRIGGER_SUMMARY first, so a noisy stored
    // message for a known trigger is never shown.
    assert.ok(
      /const canned = TRIGGER_SUMMARY\[triggerType\];[\s\S]*?if \(canned\) return canned;/.test(
        ALERTS_PAGE_SRC,
      ),
      "rowSummary must prefer the curated summary for known trigger types",
    );
  });
});

// ── Action links per category ─────────────────────────────────────────────────

describe("/alerts page — row action links", () => {
  it("rule alerts link to View rules → /rules", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes('return "View rules"') &&
        ALERTS_PAGE_SRC.includes("/rules?scope=account"),
      "rule alerts must show 'View rules' and link to /rules",
    );
  });

  it("system/session alerts link to View dashboard → /dashboard", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes('return "View dashboard"') &&
        ALERTS_PAGE_SRC.includes("/dashboard?accountId="),
      "system alerts must show 'View dashboard' and link to /dashboard",
    );
  });

  it("settings/broker alerts link to Open settings", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes('return "Open settings"'),
      "broker/settings alerts must show 'Open settings'",
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

  it("has a useful per-account empty state with a trading-plan action link", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("No alerts for this account") &&
        ALERTS_PAGE_SRC.includes(
          "Guardrail has not detected any rule breaches or session issues for this account yet.",
        ),
      "an account-scoped view with no results must show a useful per-account empty state",
    );
    assert.ok(
      ALERTS_PAGE_SRC.includes('label: "View trading plan"'),
      "the per-account empty state must offer a 'View trading plan' action",
    );
  });

  it("Today-only empty state reassures the user they're clear", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes(
        "You're clear so far. New rule breaches and session events will appear here.",
      ),
      "the Today-only empty state must have the reassuring subtitle",
    );
  });

  it("empty states can render an action link", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("emptyState.action") &&
        ALERTS_PAGE_SRC.includes("emptyState.action.href") &&
        ALERTS_PAGE_SRC.includes("emptyState.action.label"),
      "the empty-state panel must render an optional action link",
    );
  });
});

// ── Date grouping (Today / Last 7 days / Older) ───────────────────────────────

describe("/alerts page — date grouping", () => {
  it("defines the three date groups in order", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes('label: "Today"') &&
        ALERTS_PAGE_SRC.includes('label: "Last 7 days"') &&
        ALERTS_PAGE_SRC.includes('label: "Older"'),
      "the feed must define Today / Last 7 days / Older groups",
    );
    const today = ALERTS_PAGE_SRC.indexOf('label: "Today"');
    const week = ALERTS_PAGE_SRC.indexOf('label: "Last 7 days"');
    const older = ALERTS_PAGE_SRC.indexOf('label: "Older"');
    assert.ok(today < week && week < older, "groups must be ordered Today → Last 7 days → Older");
  });

  it("buckets each row by createdAt into today / week / older", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("function dateBucket") &&
        ALERTS_PAGE_SRC.includes("d >= todayStart") &&
        ALERTS_PAGE_SRC.includes("d >= weekAgo"),
      "dateBucket must classify rows by today / last-7-days / older",
    );
    assert.ok(
      ALERTS_PAGE_SRC.includes("groupedRows[dateBucket(r.createdAt)].push(r)"),
      "rows must be distributed into the grouped buckets",
    );
  });

  it("only renders groups that have rows", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("DATE_GROUPS.filter((g) => groupedRows[g.key].length > 0)"),
      "empty date groups must not render a header",
    );
  });

  it("keeps the compact row design (severity icon + action label) inside groups", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("<SeverityIcon severity={severity} />") &&
        ALERTS_PAGE_SRC.includes("{actionLabel} →"),
      "grouped rows must keep the compact severity-icon + action-link design",
    );
  });
});

// ── Sticky filter bar (not clipped under the shell header) ────────────────────

describe("/alerts page — sticky filter bar", () => {
  it("pins the switcher + chips with a sticky offset of top: 0", () => {
    assert.ok(
      /position:\s*"sticky",\s*top:\s*0/.test(ALERTS_PAGE_SRC),
      "the filter bar must use position: sticky with top: 0 (sits under the shell header)",
    );
  });

  it("the sticky bar has an opaque background so rows are not visible through it", () => {
    const stickyIdx = ALERTS_PAGE_SRC.indexOf('position: "sticky"');
    assert.ok(stickyIdx !== -1, "must have a sticky bar");
    const block = ALERTS_PAGE_SRC.slice(stickyIdx, stickyIdx + 200);
    assert.ok(
      block.includes("background: \"var(--gr-bg)\""),
      "the sticky filter bar must have an opaque background",
    );
  });
});

// ── Filtered alert count (not a global total) ─────────────────────────────────

describe("/alerts page — filtered alert count", () => {
  it("the title badge count derives from the filtered feedEvents, not a global query", () => {
    assert.ok(
      ALERTS_PAGE_SRC.includes("const alertCount = feedEvents.length"),
      "alertCount must come from feedEvents (which already applies account/filter/today)",
    );
    // It must NOT be wired to the global system-alert count used for chip gating.
    assert.ok(
      !ALERTS_PAGE_SRC.includes("const alertCount = systemAlertCount") &&
        !/alertCount\s*=\s*systemAlertCount/.test(ALERTS_PAGE_SRC),
      "alertCount must not reuse the global systemAlertCount",
    );
  });

  it("the feed query applies accountId, triggerType and today constraints", () => {
    const feedIdx = ALERTS_PAGE_SRC.indexOf("guardianIntervention.findMany");
    const block = ALERTS_PAGE_SRC.slice(feedIdx, feedIdx + 420);
    assert.ok(
      block.includes("accountId: requestedAccountId") &&
        block.includes("triggerType: { in: triggerTypeFilter }") &&
        block.includes("createdAt: { gte: todayStart }"),
      "the feed query (which feeds the count) must apply account/filter/today constraints",
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
