/**
 * Trading Plan UX cleanup — regression tests.
 *
 * Locks in:
 *  - session-cutoff edits inline via CmeHourSelect (kind: "hour")
 *  - notifications shows a per-account Telegram toggle (no detail-pane navigation)
 *  - per-symbol-limits shows a static "Evaluator coming soon" card (no navigation)
 *  - advanced-broker-actions shows a static "Planned · not active" card (no navigation)
 *  - telegramAlertsEnabled is included in the PATCH payload
 *  - handleSaveTelegramAlerts wired in AccountRulesForm
 *  - ? help button is subtler (border-transparent default state)
 *  - webhook suppresses Telegram (only) when telegramAlertsEnabled === false,
 *    in-app intervention is persisted independently of the gate
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname);
const REPO_ROOT = resolve(ROOT, "../../../..");

function read(rel: string) {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

function readRepo(rel: string) {
  return readFileSync(resolve(REPO_ROOT, rel), "utf8");
}

const OVERVIEW = read("rules-overview-screen.tsx");
const FORM = read("account-rules-form.tsx");
const WEBHOOK = readRepo("src/app/api/tradovate/webhook/route.ts");

// ── Session cutoff — inline hour editor ──────────────────────────────────────

describe("session-cutoff inline editor", () => {
  it("session-cutoff is in INLINE_RULES with kind: hour and valueKey: allowedEndHour", () => {
    assert.ok(
      OVERVIEW.includes('"session-cutoff"') &&
        OVERVIEW.includes('"allowedEndHour"') &&
        OVERVIEW.includes('"hour"'),
      "INLINE_RULES must include session-cutoff with valueKey allowedEndHour and kind hour",
    );
  });

  it("CmeHourSelect is imported in rules-overview-screen", () => {
    assert.ok(
      OVERVIEW.includes("CmeHourSelect"),
      "rules-overview-screen must import CmeHourSelect for the hour edit state",
    );
  });

  it("InlineRuleCard renders CmeHourSelect when kind is hour", () => {
    assert.ok(
      OVERVIEW.includes("<CmeHourSelect"),
      "InlineRuleCard must render <CmeHourSelect> for the hour edit state",
    );
  });

  it("rawValueForRule handles allowedEndHour case", () => {
    assert.ok(
      OVERVIEW.includes('case "allowedEndHour": return values.allowedEndHour'),
      "rawValueForRule must handle the allowedEndHour case for session-cutoff inline editing",
    );
  });
});

// ── Notifications — Telegram toggle (no navigation) ──────────────────────────

describe("notifications card — Telegram toggle", () => {
  it("NotificationsTelegramCard component exists in rules-overview-screen", () => {
    assert.ok(
      OVERVIEW.includes("NotificationsTelegramCard"),
      "rules-overview-screen must define NotificationsTelegramCard",
    );
  });

  it("notifications card shows Yes/No Telegram toggle", () => {
    // Check for the label and toggle buttons in NotificationsTelegramCard.
    // JSX text content appears as bare text (no surrounding quotes) in source.
    assert.ok(
      OVERVIEW.includes("Telegram alerts:"),
      "NotificationsTelegramCard must show a 'Telegram alerts:' label",
    );
    assert.ok(
      /aria-pressed=\{alertsOn\}[\s\S]*?Yes[\s\S]*?aria-pressed=\{!alertsOn\}[\s\S]*?No/.test(OVERVIEW),
      "NotificationsTelegramCard must have Yes and No buttons with aria-pressed",
    );
  });

  it("notifications card shows 'In-app alerts are always active'", () => {
    assert.ok(
      OVERVIEW.includes("In-app alerts are always active"),
      "NotificationsTelegramCard must confirm in-app alerts are always on",
    );
  });

  it("notifications card shows a needs-setup prompt when Telegram not connected", () => {
    assert.ok(
      OVERVIEW.includes("connect it in Settings"),
      "NotificationsTelegramCard must prompt connection in Settings when Telegram not connected",
    );
  });

  it("not-connected state renders a real link to Settings → Alerts & Telegram", () => {
    assert.ok(
      OVERVIEW.includes('href="/settings#alerts-telegram"'),
      "not-connected state must render a real <a> link to /settings#alerts-telegram",
    );
    assert.ok(
      OVERVIEW.includes("Connect Telegram in Settings"),
      "the link text must read 'Connect Telegram in Settings'",
    );
  });

  it("the Settings page exposes the alerts-telegram anchor the card links to", () => {
    const settings = readRepo("src/app/settings/page.tsx");
    assert.ok(
      settings.includes('id="alerts-telegram"'),
      "Settings must expose a stable id=\"alerts-telegram\" anchor for the deep link",
    );
  });

  it("the not-connected link is a route anchor, not the rule detail pane", () => {
    // The link must navigate to /settings (a real route), never call onSelectRule
    // or set form state. A plain <a href> guarantees a full route change.
    const cardStart = OVERVIEW.indexOf("function NotificationsTelegramCard");
    const cardEnd = OVERVIEW.indexOf("export function RulesOverviewScreen");
    const cardSrc = OVERVIEW.slice(cardStart, cardEnd);
    assert.ok(
      !cardSrc.includes("onSelectRule"),
      "NotificationsTelegramCard must not call onSelectRule (no detail-pane navigation)",
    );
  });

  it("renderRuleCard dispatches notifications to NotificationsTelegramCard (not RuleCard)", () => {
    // renderRuleCard must have a specific branch for "notifications" before the fallback RuleCard
    const notifBranchIdx = OVERVIEW.indexOf('r.id === "notifications"');
    const ruleCardIdx = OVERVIEW.indexOf("<RuleCard");
    assert.ok(notifBranchIdx !== -1, "renderRuleCard must have a branch for notifications");
    assert.ok(
      notifBranchIdx < ruleCardIdx,
      "notifications branch must come before the RuleCard fallback",
    );
  });
});

// ── Per-symbol limits — static card ──────────────────────────────────────────

describe("per-symbol-limits static card", () => {
  it("StaticInfoCard component exists in rules-overview-screen", () => {
    assert.ok(
      OVERVIEW.includes("StaticInfoCard"),
      "rules-overview-screen must define StaticInfoCard for static non-navigable cards",
    );
  });

  it("per-symbol-limits card shows 'Evaluator coming soon'", () => {
    assert.ok(
      OVERVIEW.includes("Evaluator coming soon"),
      "per-symbol-limits StaticInfoCard must show 'Evaluator coming soon'",
    );
  });

  it("renderRuleCard dispatches per-symbol-limits to StaticInfoCard", () => {
    assert.ok(
      OVERVIEW.includes('r.id === "per-symbol-limits"'),
      "renderRuleCard must have a special branch for per-symbol-limits",
    );
  });
});

// ── Advanced broker actions — static card ────────────────────────────────────

describe("advanced-broker-actions static card", () => {
  it("advanced-broker-actions card shows 'Planned · not active'", () => {
    assert.ok(
      OVERVIEW.includes("Planned · not active"),
      "advanced-broker-actions StaticInfoCard must show 'Planned · not active'",
    );
  });

  it("renderRuleCard dispatches advanced-broker-actions to StaticInfoCard", () => {
    assert.ok(
      OVERVIEW.includes('r.id === "advanced-broker-actions"'),
      "renderRuleCard must have a special branch for advanced-broker-actions",
    );
  });
});

// ── AccountRulesForm — Telegram payload + handler ────────────────────────────

describe("AccountRulesForm — telegramAlertsEnabled in payload and handler", () => {
  it("telegramAlertsEnabled is included in buildRiskRulesPayload", () => {
    assert.ok(
      FORM.includes("telegramAlertsEnabled: values.telegramAlertsEnabled"),
      "buildRiskRulesPayload must include telegramAlertsEnabled from form values",
    );
  });

  it("handleSaveTelegramAlerts function exists in AccountRulesForm", () => {
    assert.ok(
      FORM.includes("handleSaveTelegramAlerts"),
      "AccountRulesForm must define handleSaveTelegramAlerts for the notifications toggle",
    );
  });

  it("handleSaveTelegramAlerts calls persist with updated telegramAlertsEnabled", () => {
    assert.ok(
      FORM.includes("telegramAlertsEnabled: enabled"),
      "handleSaveTelegramAlerts must update telegramAlertsEnabled before calling persist",
    );
  });

  it("RulesOverviewScreen receives telegramConnected, telegramAlertsEnabled, onSaveTelegramAlerts", () => {
    assert.ok(
      FORM.includes("telegramConnected={hasTelegramConnected}") &&
        FORM.includes("telegramAlertsEnabled={values.telegramAlertsEnabled}") &&
        FORM.includes("onSaveTelegramAlerts={handleSaveTelegramAlerts}"),
      "AccountRulesForm must pass all three Telegram props to RulesOverviewScreen",
    );
  });
});

// ── Help button subtler default state ────────────────────────────────────────

describe("InlineRuleCard — ? help button subtler default state", () => {
  it("help button default state uses border-transparent (invisible resting state)", () => {
    assert.ok(
      OVERVIEW.includes("border-transparent bg-transparent"),
      "? help button must use border-transparent bg-transparent in its default (non-active) state",
    );
  });

  it("help button active state still uses amber styling", () => {
    assert.ok(
      OVERVIEW.includes("border-amber-400 bg-amber-50 text-amber-700"),
      "? help button must still use amber styling when showHelp is true",
    );
  });
});

// ── Webhook — per-account Telegram suppression ───────────────────────────────

describe("webhook — Telegram delivery gated on telegramAlertsEnabled", () => {
  it("Telegram send is gated on telegramAlertsEnabled !== false", () => {
    assert.ok(
      WEBHOOK.includes("telegramAlertsEnabled !== false"),
      "webhook must gate Telegram delivery on account.riskRules?.telegramAlertsEnabled !== false",
    );
  });

  it("the gate is applied to the Telegram send branch (chatId && telegramAllowed)", () => {
    assert.ok(
      /if \(chatId && telegramAllowed\)/.test(WEBHOOK),
      "the Telegram send must require both a chatId and telegramAllowed (the opt-out gate)",
    );
  });

  it("null / true (not opted out) still send — false is the only suppressing value", () => {
    // The gate uses `!== false`, so null (unset) and true both evaluate truthy
    // and preserve the existing send-when-connected behavior. Only an explicit
    // false suppresses. This is the documented backward-compatible default.
    const telegramAllowedIdx = WEBHOOK.indexOf("const telegramAllowed =");
    assert.ok(telegramAllowedIdx !== -1, "webhook must compute telegramAllowed");
    const line = WEBHOOK.slice(telegramAllowedIdx, telegramAllowedIdx + 120);
    assert.ok(
      line.includes("!== false"),
      "telegramAllowed must use `!== false` so null/true keep sending and only false opts out",
    );
  });

  it("in-app intervention is persisted before (independent of) the Telegram gate", () => {
    // The guardianIntervention.create (the in-app record / alert source) must
    // happen BEFORE the Telegram opt-out gate, so opting out of Telegram never
    // suppresses the in-app alert or the DB state change.
    const interventionIdx = WEBHOOK.indexOf("prisma.guardianIntervention.create");
    const gateIdx = WEBHOOK.indexOf("const telegramAllowed =");
    assert.ok(interventionIdx !== -1, "webhook must create a guardianIntervention record");
    assert.ok(gateIdx !== -1, "webhook must compute the telegramAllowed gate");
    assert.ok(
      interventionIdx < gateIdx,
      "the in-app intervention record must be created before the Telegram opt-out gate",
    );
  });
});
