/**
 * Dev-only Telegram coaching eval harness.
 * Returns 404 in production. Requires ANTHROPIC_API_KEY.
 *
 * Usage:
 *   curl http://localhost:3000/api/dev/coach-eval          — all 10 scenarios (text)
 *   curl http://localhost:3000/api/dev/coach-eval?scenario=1 — single scenario
 *   curl http://localhost:3000/api/dev/coach-eval?format=json — JSON output
 */

import { NextResponse } from "next/server";
import { generateVoiceReply } from "@/lib/voice-writer";
import type { VoiceWriterInput, CoachingIntent, PersonalCue } from "@/lib/voice-writer";

export const runtime = "nodejs";

// ─── Types ───────────────────────────────────────────────────────────────────

type CheckResult = { pass: boolean; detail?: string };
type EvalCheck = { name: string; run: (reply: string) => CheckResult };

type EvalScenario = {
  id: number;
  name: string;
  description: string;
  input: VoiceWriterInput;
  checks: EvalCheck[];
};

type EvalResult = {
  scenario: Pick<EvalScenario, "id" | "name" | "description">;
  input: { intent: string; message: string; language: string };
  reply: string | null;
  checks: Array<{ name: string; pass: boolean; detail?: string }>;
  passed: number;
  total: number;
  error?: string;
};

// ─── Reusable check factories ─────────────────────────────────────────────────

function checkNotEmpty(): EvalCheck {
  return {
    name: "not_empty",
    run: (r) => ({ pass: r.trim().length > 0, detail: r.trim().length === 0 ? "empty reply" : undefined }),
  };
}

function checkInHebrew(): EvalCheck {
  return {
    name: "in_hebrew",
    run: (r) => {
      const he = (r.match(/[א-ת]/g) ?? []).length;
      const lat = (r.match(/[a-zA-Z]/g) ?? []).length;
      const total = he + lat;
      const ratio = total === 0 ? 1 : he / total;
      return { pass: ratio >= 0.6, detail: `hebrew char ratio: ${ratio.toFixed(2)}` };
    },
  };
}

function checkMinLength(min: number): EvalCheck {
  return {
    name: `min_${min}_chars`,
    run: (r) => ({
      pass: r.trim().length >= min,
      detail: `${r.trim().length} chars (need ≥ ${min})`,
    }),
  };
}

function checkMaxLength(max: number): EvalCheck {
  return {
    name: `max_${max}_chars`,
    run: (r) => ({
      pass: r.trim().length <= max,
      detail: `${r.trim().length} chars (limit: ${max})`,
    }),
  };
}

function checkNoShameMarkers(): EvalCheck {
  const patterns: Array<{ re: RegExp; label: string }> = [
    { re: /לא הייית צריך|לא היית צריך/, label: "לא היית צריך" },
    { re: /אתה טועה/, label: "אתה טועה" },
    { re: /טיפשי|טיפש/, label: "טיפשי/טיפש" },
    { re: /שטות עשית/, label: "שטות עשית" },
    { re: /אכזבת/, label: "אכזבת" },
    { re: /כישלון/, label: "כישלון" },
    { re: /גרוע מאוד/, label: "גרוע מאוד" },
    { re: /מה חשבת/, label: "מה חשבת (accusatory)" },
  ];
  return {
    name: "no_shame_markers",
    run: (r) => {
      const found = patterns.find((p) => p.re.test(r));
      return { pass: !found, detail: found ? `found: "${found.label}"` : undefined };
    },
  };
}

function checkNoBannedPhrases(): EvalCheck {
  const phrases: Array<{ re: RegExp; label: string }> = [
    { re: /לפי הכללים שלך/, label: "לפי הכללים שלך" },
    { re: /שמור על משמעת/, label: "שמור על משמעת" },
    { re: /אני מאמן/, label: "אני מאמן..." },
    { re: /חשוב לזכור ש/, label: "חשוב לזכור ש..." },
    { re: /כדאי לזכור ש/, label: "כדאי לזכור ש..." },
    { re: /נראה לי ש/, label: "נראה לי ש..." },
    { re: /זה נשמע כאילו/, label: "זה נשמע כאילו..." },
    { re: /אני מבין ש/, label: "אני מבין ש..." },
    { re: /כאשר אתה/, label: "כאשר אתה..." },
    { re: /כל הכבוד שעצרת/, label: "כל הכבוד שעצרת" },
  ];
  return {
    name: "no_banned_phrases",
    run: (r) => {
      const found = phrases.find((p) => p.re.test(r));
      return { pass: !found, detail: found ? `found: "${found.label}"` : undefined };
    },
  };
}

// A reply is a "single command" if it's 1-2 Hebrew words + punctuation with no sentence-level context
function checkNotSingleCommand(): EvalCheck {
  return {
    name: "not_single_command",
    run: (r) => {
      const trimmed = r.trim();
      // Catches things like "עצור." or "תנשום." or "רגע." — too thin for coaching
      const isSingleCmd = /^[א-ת ]{1,12}[.!]?$/.test(trimmed) && !trimmed.includes("?");
      return {
        pass: !isSingleCmd,
        detail: isSingleCmd ? `too thin: "${trimmed}"` : undefined,
      };
    },
  };
}

// Checks that a distress reply includes at least one human-acknowledgment element
function checkContainsHumanElement(): EvalCheck {
  const markers = [
    /קורה/, /מובן/, /קשה/, /איתך/, /חזק/, /לא נעים/,
    /מרגיש/, /ביחד/, /הגיוני/, /מבין/, /אני רואה/,
    /זה מובן/, /זה טבעי/, /זה מצב/, /אני פה/,
    /להגן/, /שומר/, /בטוח/, /להחזיר/, /לרדוף/,
    /דחף/, /ממצב/, /מעמיק/, /מאחוריך/, /עוצרים/,
  ];
  return {
    name: "contains_human_element",
    run: (r) => {
      const found = markers.some((m) => m.test(r));
      return {
        pass: found,
        detail: found ? undefined : "no acknowledgment or grounding element found — may be too generic",
      };
    },
  };
}

function checkHasQuestion(): EvalCheck {
  return {
    name: "has_question",
    run: (r) => ({
      pass: r.includes("?"),
      detail: r.includes("?") ? undefined : "no question mark found",
    }),
  };
}

// For factual (meta) mode — should not bleed into emotional coaching
function checkNoEmotionalCoachingBleed(): EvalCheck {
  const emotional = [
    /אתה חם/, /קח נשימה/, /תצא מהמסך/, /אל תיכנס/,
    /תנשום/, /עוצרים כאן/, /לא עכשיו/,
  ];
  return {
    name: "no_emotional_coaching_bleed",
    run: (r) => {
      const found = emotional.find((p) => p.test(r));
      return {
        pass: !found,
        detail: found ? `emotional coaching language in factual reply` : undefined,
      };
    },
  };
}

function checkContainsNumbers(): EvalCheck {
  return {
    name: "contains_numbers",
    run: (r) => ({
      pass: /\d/.test(r),
      detail: /\d/.test(r) ? undefined : "no numbers — factual reply should include numeric data",
    }),
  };
}

// ─── Shared check sets ────────────────────────────────────────────────────────

const DISTRESS_CHECKS: EvalCheck[] = [
  checkNotEmpty(),
  checkInHebrew(),
  checkMinLength(25),
  checkMaxLength(500),
  checkNoShameMarkers(),
  checkNoBannedPhrases(),
  checkNotSingleCommand(),
  checkContainsHumanElement(),
];

// ─── Scenario definitions ─────────────────────────────────────────────────────

type BaseProfileFields = Omit<
  VoiceWriterInput,
  "intent" | "traderMessage" | "constraintMessage" | "personalCue" | "knownPattern" | "askQuestion"
>;

const BASE: BaseProfileFields = {
  language: "he",
  coachingTone: "direct",
  interruptionStyle: "Hard stop reminder",
  responseStyle: null,
  preferredAddress: "MASCULINE",
  recentMessages: [],
  recentCoachingExchanges: [],
  shortTermCoachingState: null,
  reminderAnchors: [],
  disciplineBreakPattern: "אחרי הפסד, נכנס מיד לעסקה נוספת",
  whatHelpsRefocus: "יציאה מהמסך לכמה דקות",
  wantsToughIntervention: true,
};

function input(
  intent: CoachingIntent,
  traderMessage: string,
  opts: {
    constraint?: string | null;
    cue?: PersonalCue | null;
    pattern?: string | null;
    question?: boolean;
    overrides?: Partial<BaseProfileFields>;
  } = {},
): VoiceWriterInput {
  return {
    ...BASE,
    ...(opts.overrides ?? {}),
    intent,
    traderMessage,
    constraintMessage: opts.constraint ?? null,
    personalCue: opts.cue ?? null,
    knownPattern: opts.pattern ?? null,
    askQuestion: opts.question ?? false,
  };
}

function buildScenarios(): EvalScenario[] {
  return [
    // ── 1. Revenge ─────────────────────────────────────────────────────────
    {
      id: 1,
      name: "Revenge urge after a loss",
      description: "Trader taps 'אני רוצה להחזיר הפסד' right after a loss",
      input: input("stop_revenge", "אני רוצה להחזיר הפסד", {
        cue: { type: "grounding", text: "כשאני חם — אני לא הסוחר שלי" },
        pattern: "אחרי הפסד יש לי דחף חזק להיכנס מיד לעסקה נוספת",
        question: false,
      }),
      checks: DISTRESS_CHECKS,
    },

    // ── 2. FOMO ────────────────────────────────────────────────────────────
    {
      id: 2,
      name: "FOMO after missing a move",
      description: "Trader taps 'יש לי FOMO' watching a breakout happen without them",
      input: input("stop_fomo", "יש לי FOMO", {
        pattern: "רודף אחרי כל מהלך גדול גם כשאין לו סטאפ",
        question: true,
      }),
      checks: DISTRESS_CHECKS,
    },

    // ── 3. Tilt ────────────────────────────────────────────────────────────
    {
      id: 3,
      name: "Tilt and anger after back-to-back mistakes",
      description: "Trader taps 'אני לא בשליטה' after a series of bad decisions",
      input: input("ground_tilt", "אני לא בשליטה", {
        cue: { type: "grounding", text: "כשאני חם — אני לא הסוחר שלי" },
        pattern: "מתפרק אחרי שני הפסדים ברצף, מקבל החלטות מתוך עצבים",
        question: true,
      }),
      checks: DISTRESS_CHECKS,
    },

    // ── 4. Shame / collapse after a loss ──────────────────────────────────
    {
      id: 4,
      name: "Shame and collapse after a bad trade",
      description: "Trader taps 'אני בעצבים' right after taking a significant loss",
      input: input("acknowledge_loss", "אני בעצבים", {
        cue: { type: "goal", text: "להיות עקבי 3 חודשים" },
        question: true,
      }),
      checks: [
        ...DISTRESS_CHECKS,
        {
          // Reply should NOT immediately redirect to "next setup" — that skips the acknowledgment
          name: "no_immediate_next_trade_redirect",
          run: (r) => {
            const redirect = /מה הסטאפ הבא|מה העסקה הבאה|בוא נסתכל קדימה/.test(r);
            return {
              pass: !redirect,
              detail: redirect ? "skipped acknowledgment — jumped straight to next trade" : undefined,
            };
          },
        },
      ],
    },

    // ── 5. Stop me — cooldown active ──────────────────────────────────────
    {
      id: 5,
      name: "Explicit 'stop me' — cooldown active",
      description: "Trader taps 'עצור אותי' — system cooldown is active",
      input: input("cooldown_active", "עצור אותי", {
        constraint: "Trader is in a cooldown period — a self-set rule to step away.",
        pattern: "מבקש עצירה לפני שהוא עושה טעות גדולה",
        question: false,
      }),
      checks: [
        ...DISTRESS_CHECKS,
        {
          // Should feel containing, not like a system status confirmation
          name: "not_mechanical_system_message",
          run: (r) => {
            const mechanical = /הקירור פעיל|מצב קירור|cooldown|תוקפו/.test(r);
            return {
              pass: !mechanical,
              detail: mechanical ? "sounds like a system status message, not a coaching response" : undefined,
            };
          },
        },
      ],
    },

    // ── 6. Dragged into a bad trade ───────────────────────────────────────
    {
      id: 6,
      name: "Got dragged into an impulsive trade",
      description: "Trader taps 'נגררתי' — entered without a real setup",
      input: input("stop_fomo", "נגררתי", {
        pattern: "נגרר אחרי תנועות גדולות ללא סטאפ אמיתי",
        question: true,
      }),
      checks: [
        ...DISTRESS_CHECKS,
        {
          // Reply should acknowledge the "dragging" — not just generic FOMO coaching
          name: "acknowledges_dragging_context",
          run: (r) => {
            const ack = /נגרר|הוא שלך|הסטאפ הבא|לא הסטאפ שלך|תנועה שלא/.test(r);
            return {
              pass: ack,
              detail: ack ? undefined : "doesn't acknowledge the impulsive/dragged context specifically",
            };
          },
        },
      ],
    },

    // ── 7. Multiple consecutive losses ────────────────────────────────────
    {
      id: 7,
      name: "Multiple consecutive losses — cumulative weight",
      description: "Trader taps 'אני לא בשליטה' after 3 losses in a row",
      input: input("acknowledge_multiple_losses", "אני לא בשליטה", {
        constraint: "Self-reported consecutive losses: 3",
        cue: { type: "goal", text: "להיות עקבי 3 חודשים" },
        pattern: "מתפרק אחרי שלושה הפסדים ברצף, ממשיך לסחור במקום לעצור",
        question: true,
      }),
      checks: [
        ...DISTRESS_CHECKS,
        {
          // Should not count/announce losses in a blaming way
          name: "no_loss_tally_blaming",
          run: (r) => {
            const counts = /3 הפסד|שלושה הפסד|הפסדת 3|הפסדת שלושה/.test(r);
            return {
              pass: !counts,
              detail: counts ? "announcing the loss count sounds blaming" : undefined,
            };
          },
        },
      ],
    },

    // ── 8. Pre-session check-in — calm ────────────────────────────────────
    {
      id: 8,
      name: "Pre-session check-in — calm and ready",
      description: "Trader taps 'צ'ק אין' before a new session",
      input: input("pre_session_checkin", "צ'ק אין", {
        constraint: "Today's rules: max daily loss: $500, max 5 trades, stop after 3 consecutive losses",
        cue: { type: "why", text: "להשיג חופש כלכלי למשפחה שלי" },
        question: true,
        overrides: { wantsToughIntervention: false },
      }),
      checks: [
        checkNotEmpty(),
        checkInHebrew(),
        checkMinLength(30),
        checkMaxLength(450),
        checkNoBannedPhrases(),
        checkHasQuestion(),
        {
          // Should NOT inject distress coaching language into a calm check-in
          name: "no_distress_framing",
          run: (r) => {
            const distress = /עצור|לא בשליטה|תנשום עמוק|הפסד ברצף/.test(r);
            return {
              pass: !distress,
              detail: distress ? "distress-mode language injected into a calm check-in" : undefined,
            };
          },
        },
      ],
    },

    // ── 9. End-of-day review — rough session ──────────────────────────────
    {
      id: 9,
      name: "End-of-day review after a rough session",
      description: "Trader taps 'סכם לי את היום' after multiple losses",
      input: input("end_of_day_review", "סכם לי את היום", {
        cue: { type: "goal", text: "להיות עקבי 3 חודשים" },
        pattern: "ימים עם הפסדים מרובים — קשה לו לסגור ולא לנסות להחזיר",
        question: true,
        overrides: { wantsToughIntervention: false },
      }),
      checks: [
        checkNotEmpty(),
        checkInHebrew(),
        checkMinLength(30),
        checkMaxLength(500),
        checkNoBannedPhrases(),
        checkHasQuestion(),
        {
          // Should not silver-line or over-comfort after a hard day
          name: "no_silver_lining",
          run: (r) => {
            const silver = /כל הכבוד|עשית טוב|תמשיך כך|הכל יהיה טוב|זה בסדר גמור/.test(r);
            return {
              pass: !silver,
              detail: silver ? "over-comforting / silver-lining a rough day" : undefined,
            };
          },
        },
        {
          // Should ask max 2 questions, not list all 4 template questions
          name: "max_two_questions",
          run: (r) => {
            const qs = (r.match(/\?/g) ?? []).length;
            return {
              pass: qs <= 2,
              detail: qs > 2 ? `${qs} question marks — likely listing all template questions` : `${qs} question(s)`,
            };
          },
        },
      ],
    },

    // ── 10. Remaining budget — factual query ──────────────────────────────
    {
      id: 10,
      name: "Remaining budget — factual query",
      description: "Trader taps 'כמה נשאר לי היום?' — expects numbers, not emotional coaching",
      input: input("rule_limits_summary", "כמה נשאר לי היום?", {
        constraint:
          "Daily loss: $120 used of $500 limit ($380 remaining, 24% used). Trades: 2 of 5 taken today. Consecutive losses: 1 of 3 limit.",
        question: false,
        overrides: { wantsToughIntervention: false },
      }),
      checks: [
        checkNotEmpty(),
        checkInHebrew(),
        checkMaxLength(280),
        checkNoBannedPhrases(),
        checkContainsNumbers(),
        checkNoEmotionalCoachingBleed(),
        {
          // The reply should include the remaining dollar amount from the constraint
          name: "includes_remaining_amount",
          run: (r) => {
            const hasDollars = /380|500|120|\$/.test(r);
            return {
              pass: hasDollars,
              detail: hasDollars ? undefined : "missing specific dollar amounts from the constraint",
            };
          },
        },
      ],
    },
  ];
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function runScenario(scenario: EvalScenario): Promise<EvalResult> {
  let reply: string | null = null;
  let error: string | undefined;

  try {
    reply = await generateVoiceReply(scenario.input);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const checkResults = scenario.checks.map((check) => {
    if (reply === null) return { name: check.name, pass: false, detail: "no reply generated" };
    const result = check.run(reply);
    return { name: check.name, pass: result.pass, detail: result.detail };
  });

  return {
    scenario: { id: scenario.id, name: scenario.name, description: scenario.description },
    input: {
      intent: scenario.input.intent,
      message: scenario.input.traderMessage,
      language: scenario.input.language,
    },
    reply,
    checks: checkResults,
    passed: checkResults.filter((c) => c.pass).length,
    total: checkResults.length,
    error,
  };
}

// ─── Text report ──────────────────────────────────────────────────────────────

function formatReport(results: EvalResult[], durationMs: number): string {
  const SEP = "─".repeat(62);
  const BIG = "═".repeat(62);
  const lines: string[] = [];

  lines.push(BIG);
  lines.push("  GUARDRAIL COACHING EVAL");
  lines.push(`  ${new Date().toISOString()}`);
  lines.push(BIG);
  lines.push("");

  for (const r of results) {
    const allPass = r.passed === r.total;
    lines.push(SEP);
    lines.push(`${allPass ? "✅" : "❌"}  [${r.scenario.id}] ${r.scenario.name}`);
    lines.push(`    ${r.scenario.description}`);
    lines.push("");
    lines.push(`    Message : "${r.input.message}"`);
    lines.push(`    Intent  : ${r.input.intent}`);
    lines.push("");

    if (r.error) {
      lines.push(`    ERROR: ${r.error}`);
    } else if (r.reply === null) {
      lines.push("    Reply: (null — generation failed or API key missing)");
    } else {
      lines.push("    Reply:");
      // Wrap reply text at ~55 chars for readability
      const words = r.reply.split(" ");
      let line = "      ";
      for (const word of words) {
        if (line.length + word.length > 58) {
          lines.push(line);
          line = "      " + word + " ";
        } else {
          line += word + " ";
        }
      }
      if (line.trim()) lines.push(line);
    }
    lines.push("");

    lines.push("    Checks:");
    for (const c of r.checks) {
      const mark = c.pass ? "✅" : "❌";
      const detail = c.detail ? `  (${c.detail})` : "";
      lines.push(`      ${mark}  ${c.name}${detail}`);
    }
    lines.push("");
    lines.push(`    Score: ${r.passed}/${r.total} checks`);
    lines.push("");
  }

  lines.push(BIG);
  const passedScenarios = results.filter((r) => r.passed === r.total).length;
  const allChecks = results.flatMap((r) => r.checks);
  const passedChecks = allChecks.filter((c) => c.pass).length;
  lines.push(`  SUMMARY  ${passedScenarios}/${results.length} scenarios fully passed`);
  lines.push(`           ${passedChecks}/${allChecks.length} individual checks passed`);
  lines.push(`           ${durationMs}ms (sequential, real generation)`);
  lines.push(BIG);

  return lines.join("\n");
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return new NextResponse(
      "ANTHROPIC_API_KEY not set — cannot run eval\n",
      { status: 503, headers: { "Content-Type": "text/plain" } },
    );
  }

  const url = new URL(request.url);
  const scenarioParam = url.searchParams.get("scenario");
  const formatParam = url.searchParams.get("format") ?? "text";

  const scenarios = buildScenarios();
  const toRun = scenarioParam
    ? scenarios.filter((s) => String(s.id) === scenarioParam)
    : scenarios;

  if (toRun.length === 0) {
    return new NextResponse(
      `Scenario "${scenarioParam}" not found. Valid IDs: 1–${scenarios.length}\n`,
      { status: 400, headers: { "Content-Type": "text/plain" } },
    );
  }

  const start = Date.now();

  // Run sequentially — avoids rate-limit spikes and keeps output ordered
  const results: EvalResult[] = [];
  for (const scenario of toRun) {
    results.push(await runScenario(scenario));
  }

  const duration = Date.now() - start;

  if (formatParam === "json") {
    return NextResponse.json({ results, durationMs: duration });
  }

  return new NextResponse(formatReport(results, duration), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
