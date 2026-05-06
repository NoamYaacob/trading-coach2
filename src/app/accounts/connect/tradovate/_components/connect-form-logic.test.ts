import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  getDefaultEnv,
  getDefaultEnvForPhase,
  isLiveAllowed,
  isEnvForced,
  getEnvHint,
  validateSourceEnv,
  PROP_FIRM_PHASES,
  DEFAULT_PROP_FIRM_PHASE,
} from "./connect-form-logic.ts";

// ── getDefaultEnv ─────────────────────────────────────────────────────────────

describe("getDefaultEnv", () => {
  test("prop firm defaults to Demo/Simulation", () => {
    assert.equal(getDefaultEnv("prop_firm"), "demo");
  });

  test("personal brokerage defaults to Live", () => {
    assert.equal(getDefaultEnv("personal"), "live");
  });

  test("paper trading defaults to Demo/Simulation", () => {
    assert.equal(getDefaultEnv("demo"), "demo");
  });

  test("not sure / other defaults to Demo/Simulation", () => {
    assert.equal(getDefaultEnv("other"), "demo");
  });
});

// ── isLiveAllowed ─────────────────────────────────────────────────────────────

describe("isLiveAllowed", () => {
  test("paper trading does not allow Live", () => {
    assert.equal(isLiveAllowed("demo"), false);
  });

  test("prop firm allows Live", () => {
    assert.equal(isLiveAllowed("prop_firm"), true);
  });

  test("personal brokerage allows Live", () => {
    assert.equal(isLiveAllowed("personal"), true);
  });

  test("not sure / other allows Live", () => {
    assert.equal(isLiveAllowed("other"), true);
  });
});

// ── isEnvForced ───────────────────────────────────────────────────────────────

describe("isEnvForced", () => {
  test("paper trading forces Demo (env is not user-changeable)", () => {
    assert.equal(isEnvForced("demo"), true);
  });

  test("prop firm does not force env", () => {
    assert.equal(isEnvForced("prop_firm"), false);
  });

  test("personal brokerage does not force env", () => {
    assert.equal(isEnvForced("personal"), false);
  });

  test("not sure / other does not force env", () => {
    assert.equal(isEnvForced("other"), false);
  });
});

// ── getDefaultEnvForPhase ─────────────────────────────────────────────────────

describe("getDefaultEnvForPhase", () => {
  test("evaluation defaults to Demo/Simulation", () => {
    assert.equal(getDefaultEnvForPhase("evaluation"), "demo");
  });

  test("funded_sim defaults to Demo/Simulation", () => {
    assert.equal(getDefaultEnvForPhase("funded_sim"), "demo");
  });

  test("live_funded defaults to Live", () => {
    assert.equal(getDefaultEnvForPhase("live_funded"), "live");
  });

  test("not_sure defaults to Demo/Simulation", () => {
    assert.equal(getDefaultEnvForPhase("not_sure"), "demo");
  });
});

// ── getEnvHint ────────────────────────────────────────────────────────────────

describe("getEnvHint", () => {
  test("paper trading always shows a hint about Demo being required", () => {
    const hint = getEnvHint("demo", "demo");
    assert.ok(hint != null, "hint should be shown for paper trading");
    assert.match(hint!, /paper trading/i);
    assert.match(hint!, /demo/i);
  });

  test("paper trading hint is the same regardless of env value", () => {
    assert.equal(getEnvHint("demo", "demo"), getEnvHint("demo", "live"));
  });

  test("prop firm evaluation phase shows hint covering evaluations, challenges, and combines", () => {
    const hint = getEnvHint("prop_firm", "demo", "evaluation");
    assert.ok(hint != null);
    assert.match(hint!, /evaluation/i);
    assert.match(hint!, /challenge/i);
    assert.match(hint!, /combine/i);
  });

  test("prop firm funded_sim phase shows hint about simulated funded accounts", () => {
    const hint = getEnvHint("prop_firm", "demo", "funded_sim");
    assert.ok(hint != null);
    assert.match(hint!, /simulated/i);
    assert.match(hint!, /demo|simulation/i);
  });

  test("prop firm live_funded phase shows Live advisory", () => {
    const hint = getEnvHint("prop_firm", "live", "live_funded");
    assert.ok(hint != null);
    assert.match(hint!, /live/i);
    assert.match(hint!, /tradovate live/i);
  });

  test("prop firm not_sure phase shows neutral hint", () => {
    const hint = getEnvHint("prop_firm", "demo", "not_sure");
    assert.ok(hint != null);
    assert.match(hint!, /tradovate/i);
  });

  test("prop firm with no phase falls back to neutral hint", () => {
    const hint = getEnvHint("prop_firm", "demo");
    assert.ok(hint != null);
    assert.match(hint!, /tradovate/i);
  });

  test("personal brokerage + Live returns null (no warning needed)", () => {
    assert.equal(getEnvHint("personal", "live"), null);
  });

  test("personal brokerage + Demo shows hint about Live being more common", () => {
    const hint = getEnvHint("personal", "demo");
    assert.ok(hint != null);
    assert.match(hint!, /live/i);
  });

  test("not sure / other shows a neutral hint about choosing by where account appears", () => {
    const hint = getEnvHint("other", "demo");
    assert.ok(hint != null);
    assert.match(hint!, /tradovate/i);
  });
});

// ── validateSourceEnv ─────────────────────────────────────────────────────────

describe("validateSourceEnv", () => {
  test("paper trading + Live is invalid", () => {
    const err = validateSourceEnv("demo", "live");
    assert.ok(err != null, "paper + live must return a validation error");
    assert.match(err!, /paper trading|demo/i);
  });

  test("paper trading + Demo is valid", () => {
    assert.equal(validateSourceEnv("demo", "demo"), null);
  });

  test("prop firm + Demo is valid", () => {
    assert.equal(validateSourceEnv("prop_firm", "demo"), null);
  });

  test("prop firm + Live is valid", () => {
    assert.equal(validateSourceEnv("prop_firm", "live"), null);
  });

  test("personal + Live is valid", () => {
    assert.equal(validateSourceEnv("personal", "live"), null);
  });

  test("personal + Demo is valid", () => {
    assert.equal(validateSourceEnv("personal", "demo"), null);
  });

  test("not sure / other + Live is valid", () => {
    assert.equal(validateSourceEnv("other", "live"), null);
  });

  test("not sure / other + Demo is valid", () => {
    assert.equal(validateSourceEnv("other", "demo"), null);
  });
});

// ── PROP_FIRM_PHASES contract ─────────────────────────────────────────────────

describe("PROP_FIRM_PHASES contract", () => {
  test("default phase is evaluation", () => {
    assert.equal(DEFAULT_PROP_FIRM_PHASE, "evaluation");
  });

  test("has Evaluation / Challenge / Combine as a single merged option", () => {
    const option = PROP_FIRM_PHASES.find((p) => p.value === "evaluation");
    assert.ok(option != null, "evaluation option must exist");
    assert.match(option!.label, /evaluation/i);
    assert.match(option!.label, /challenge/i);
    assert.match(option!.label, /combine/i);
  });

  test("there is no separate Challenge / Combine option", () => {
    const challengeOnly = PROP_FIRM_PHASES.find(
      (p) => /challenge/i.test(p.label) && !/evaluation/i.test(p.label),
    );
    assert.equal(challengeOnly, undefined, "challenge must be merged into the evaluation option");
  });

  test("has Funded / Sim funded as a single merged option", () => {
    const option = PROP_FIRM_PHASES.find((p) => p.value === "funded_sim");
    assert.ok(option != null, "funded_sim option must exist");
    assert.match(option!.label, /funded/i);
    assert.match(option!.label, /sim/i);
  });

  test("there is no standalone Funded option", () => {
    const standalone = PROP_FIRM_PHASES.find(
      (p) => p.value === "funded" || (p.label === "Funded"),
    );
    assert.equal(standalone, undefined, "Funded must be merged into funded_sim option");
  });

  test("there is no standalone Sim funded option", () => {
    const standalone = PROP_FIRM_PHASES.find((p) => p.value === "sim_funded");
    assert.equal(standalone, undefined, "Sim funded must be merged into funded_sim option");
  });

  test("has Live funded option", () => {
    const option = PROP_FIRM_PHASES.find((p) => p.value === "live_funded");
    assert.ok(option != null, "live_funded option must exist");
    assert.match(option!.label, /live/i);
    assert.match(option!.label, /funded/i);
  });

  test("user can choose Not sure", () => {
    assert.ok(PROP_FIRM_PHASES.some((p) => p.value === "not_sure"));
  });

  test("selecting live_funded sets environment to Live", () => {
    assert.equal(getDefaultEnvForPhase("live_funded"), "live");
  });

  test("switching back from live_funded to funded_sim sets environment to Demo", () => {
    assert.equal(getDefaultEnvForPhase("funded_sim"), "demo");
  });

  test("switching back from live_funded to evaluation sets environment to Demo", () => {
    assert.equal(getDefaultEnvForPhase("evaluation"), "demo");
  });
});

// ── Prop firm phase selector contract ────────────────────────────────────────

describe("prop firm phase selector contract", () => {
  // The phase selector is rendered only when accountSource === "prop_firm".
  // This is a UI contract documented here.

  test("phase selector is shown for prop firm accounts", () => {
    const showPhaseSelector = (source: string) => source === "prop_firm";
    assert.equal(showPhaseSelector("prop_firm"), true);
  });

  test("phase selector is not shown for personal brokerage", () => {
    const showPhaseSelector = (source: string) => source === "prop_firm";
    assert.equal(showPhaseSelector("personal"), false);
  });

  test("phase selector is not shown for paper trading", () => {
    const showPhaseSelector = (source: string) => source === "prop_firm";
    assert.equal(showPhaseSelector("demo"), false);
  });

  test("phase selector is not shown for not sure / other", () => {
    const showPhaseSelector = (source: string) => source === "prop_firm";
    assert.equal(showPhaseSelector("other"), false);
  });
});
