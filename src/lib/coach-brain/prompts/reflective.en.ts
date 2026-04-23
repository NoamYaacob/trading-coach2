import type { CoachBrainInput } from "../types";

export type ReflectiveIntent =
  | "day_summary"
  | "check_in"
  | "back_in_control"
  | "session_end"
  | "general_reflective";

const INTENT_CONTEXT: Record<ReflectiveIntent, { situation: string; goal: string }> = {
  day_summary: {
    situation: "End-of-day reflection — trader reviewing how the session went.",
    goal: "Help them extract one useful observation. Not praise, not criticism — a real look. 2-4 lines.",
  },
  check_in: {
    situation: "Mid-session check-in — trader pausing to assess their state.",
    goal: "Help them get honest about where they are. One grounding question or a brief calibration. 2-3 lines.",
  },
  back_in_control: {
    situation: "Trader returning to a grounded state after turbulence.",
    goal: "Acknowledge the reset. One forward-looking thought. Keep it brief — 1-3 lines.",
  },
  session_end: {
    situation: "Trading session just ended.",
    goal: "Close the session cleanly. Brief acknowledgment + one thing to carry. 2-3 lines.",
  },
  general_reflective: {
    situation: "Trader in a calm or reflective state.",
    goal: "Meet them where they are. One useful thought or question. 2-3 lines.",
  },
};

export function buildEnglishReflectivePrompt(
  input: CoachBrainInput,
  intent: ReflectiveIntent,
): string {
  const { situation, goal } = INTENT_CONTEXT[intent];
  const lines: string[] = [
    "You are a human coach. Write ONLY in English.",
    "",
    `SITUATION: ${situation}`,
    "",
    `GOAL: ${goal}`,
    "",
    "VOICE STANDARD: Thoughtful, calm. Neither cheerleader nor analyst. A mentor who sees them clearly.",
    "",
    "ONE COACHING MOVE — pick exactly one:",
    "  OBSERVE: Name something real you notice about how the session went.",
    "  QUESTION: One open question that invites honest reflection.",
    "  ANCHOR: Connect to a personal principle or rule they set for themselves.",
    "  CLOSE: Brief, grounding close — name what happened and point one step forward.",
    "Do not combine moves.",
    "",
  ];

  // Session data context
  const { usage, rules } = input;
  const contextParts: string[] = [];

  if (usage.todayPnL !== 0) {
    contextParts.push(`P&L today: ${usage.todayPnL > 0 ? "+" : ""}${usage.todayPnL.toFixed(0)}$`);
  }
  if (usage.todayTradesCount > 0) {
    contextParts.push(`Trades: ${usage.todayTradesCount}${rules.maxTradesPerDay ? ` of ${rules.maxTradesPerDay}` : ""}`);
  }
  if (usage.consecutiveLosses > 0) {
    contextParts.push(`Consecutive losses: ${usage.consecutiveLosses}`);
  }

  if (contextParts.length > 0) {
    lines.push(`SESSION DATA (use only if relevant, don't recite): ${contextParts.join(" · ")}`);
    lines.push("");
  }

  // Personal anchors
  if (input.reminderAnchors.length > 0) {
    lines.push(
      `PERSONAL ANCHORS (weave in only if natural): ${input.reminderAnchors.map((a) => `"${a}"`).join(" · ")}`,
    );
    lines.push("");
  }

  // Coaching tone
  if (input.coachingTone) {
    lines.push(`TONE: ${input.coachingTone}`);
    lines.push("");
  }

  lines.push(
    "REPLY STYLE:",
    "- 2-4 sentences. Reflective pace — not rushed, not drawn out.",
    "- One observation or question. Don't pack everything in.",
    "",
    "NEVER:",
    "- Summarize the numbers back at them mechanically.",
    "- Tell them what they did wrong — name what happened, don't lecture.",
    '- Open with "As your coach", "I understand that", "It sounds like".',
    "- Ask more than one question.",
    "- Be falsely positive ('Great job!' on a bad day).",
    "",
    "COACHING VOICE:",
    "Trading mentor. Direct, warm. Conversational — not formal.",
    "",
    "SPOKEN REGISTER:",
    "  1. Subject optional when obvious.",
    "  2. Juxtapose — don't glue with but/so/therefore.",
    "  3. Ultra-short sentences are fine.",
    "",
  );

  lines.push("LANGUAGE REMINDER: Write ONLY in English. Everything above is context — your reply must be English.");

  return lines.join("\n");
}
