import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  canActivateRulesNow,
  activationReasonMessage,
} from "./rule-activation-window.ts";

// ─── Reference instants in CME time ───────────────────────────────────────────
//
// CDT = UTC-5, CST = UTC-6. The codebase's CME helpers use America/Chicago
// directly, so DST is handled inside the helpers — we just construct UTC
// instants that line up with the wall-clock moments we want.
//
// In May 2026 (CDT, UTC-5):
//   17:00 CT = 22:00 UTC
//   16:00 CT = 21:00 UTC
//   16:30 CT = 21:30 UTC

const MON_18CT = new Date("2026-05-11T23:00:00.000Z");      // Mon 18:00 CT — active trading
const MON_1630CT = new Date("2026-05-11T21:30:00.000Z");    // Mon 16:30 CT — daily maintenance break
const FRI_1630CT = new Date("2026-05-15T21:30:00.000Z");    // Fri 16:30 CT — weekend close
const SUN_1530CT = new Date("2026-05-17T20:30:00.000Z");    // Sun 15:30 CT — weekend close (still)
const SUN_1830CT = new Date("2026-05-17T23:30:00.000Z");    // Sun 18:30 CT — market re-opened
const SAT_NOON_CT = new Date("2026-05-16T17:00:00.000Z");   // Sat 12:00 CT — weekend close

// ─── CME-global safe windows ──────────────────────────────────────────────────

describe("canActivateRulesNow — CME-global safe windows always allow activation", () => {
  test("Monday 16:30 CT (daily maintenance) → safe for account scope", () => {
    const d = canActivateRulesNow({ scope: "account", accountIsLocked: false, now: MON_1630CT });
    assert.equal(d.canActivate, true);
    assert.equal(d.reason, "cme_maintenance");
  });

  test("Monday 16:30 CT (daily maintenance) → safe for default scope even if accounts active", () => {
    const d = canActivateRulesNow({ scope: "default", anyInheritingAccountActive: true, now: MON_1630CT });
    assert.equal(d.canActivate, true);
    assert.equal(d.reason, "cme_maintenance");
  });

  test("Friday 16:30 CT → weekend close, not maintenance", () => {
    const d = canActivateRulesNow({ scope: "account", accountIsLocked: false, now: FRI_1630CT });
    assert.equal(d.canActivate, true);
    assert.equal(d.reason, "cme_weekend_close");
  });

  test("Sunday 15:30 CT → still weekend close (market hasn't reopened yet)", () => {
    const d = canActivateRulesNow({ scope: "account", accountIsLocked: false, now: SUN_1530CT });
    assert.equal(d.canActivate, true);
    assert.equal(d.reason, "cme_weekend_close");
  });

  test("Saturday noon CT → weekend close", () => {
    const d = canActivateRulesNow({ scope: "default", anyInheritingAccountActive: true, now: SAT_NOON_CT });
    assert.equal(d.canActivate, true);
    assert.equal(d.reason, "cme_weekend_close");
  });

  test("Sunday 18:30 CT → market open again, scope check applies", () => {
    const d = canActivateRulesNow({ scope: "account", accountIsLocked: false, now: SUN_1830CT });
    assert.equal(d.canActivate, false);
    assert.equal(d.reason, "account_active");
  });
});

// ─── Account scope ────────────────────────────────────────────────────────────

describe("canActivateRulesNow — account scope during CME active hours", () => {
  test("locked account → safe", () => {
    const d = canActivateRulesNow({ scope: "account", accountIsLocked: true, now: MON_18CT });
    assert.equal(d.canActivate, true);
    assert.equal(d.reason, "account_locked");
  });

  test("active account → not safe (queue as pending)", () => {
    const d = canActivateRulesNow({ scope: "account", accountIsLocked: false, now: MON_18CT });
    assert.equal(d.canActivate, false);
    assert.equal(d.reason, "account_active");
  });
});

// ─── Default scope ────────────────────────────────────────────────────────────

describe("canActivateRulesNow — default scope during CME active hours", () => {
  test("any inheriting account active → not safe", () => {
    const d = canActivateRulesNow({
      scope: "default",
      anyInheritingAccountActive: true,
      now: MON_18CT,
    });
    assert.equal(d.canActivate, false);
    assert.equal(d.reason, "default_inheriting_account_active");
  });

  test("no inheriting account active → safe", () => {
    const d = canActivateRulesNow({
      scope: "default",
      anyInheritingAccountActive: false,
      now: MON_18CT,
    });
    assert.equal(d.canActivate, true);
    assert.equal(d.reason, "default_safe");
  });

  test("user with no accounts at all → safe (anyInheritingAccountActive=false)", () => {
    const d = canActivateRulesNow({
      scope: "default",
      anyInheritingAccountActive: false,
      now: MON_18CT,
    });
    assert.equal(d.canActivate, true);
  });
});

// ─── Reason precedence ────────────────────────────────────────────────────────

describe("canActivateRulesNow — reason precedence", () => {
  test("CME maintenance precedes account_active reason", () => {
    // Even if the account is active per its own state, the CME maintenance
    // window forces a global safe window — no account can be live.
    const d = canActivateRulesNow({ scope: "account", accountIsLocked: false, now: MON_1630CT });
    assert.equal(d.reason, "cme_maintenance");
  });

  test("CME maintenance precedes default_inheriting_account_active reason", () => {
    const d = canActivateRulesNow({ scope: "default", anyInheritingAccountActive: true, now: MON_1630CT });
    assert.equal(d.reason, "cme_maintenance");
  });
});

// ─── Reason text ──────────────────────────────────────────────────────────────

describe("activationReasonMessage", () => {
  test("account_active explains pending will activate at next safe window for the account", () => {
    const msg = activationReasonMessage("account_active");
    assert.match(msg, /account/i);
    assert.match(msg, /next safe window/i);
  });

  test("default_inheriting_account_active mentions inheriting account and CME safe windows", () => {
    const msg = activationReasonMessage("default_inheriting_account_active");
    assert.match(msg, /inheriting/i);
    assert.match(msg, /CME maintenance|weekend close/i);
  });

  test("cme_maintenance message says changes apply now", () => {
    const msg = activationReasonMessage("cme_maintenance");
    assert.match(msg, /apply now/i);
  });

  test("account_locked message says changes apply now", () => {
    const msg = activationReasonMessage("account_locked");
    assert.match(msg, /apply now/i);
  });
});
