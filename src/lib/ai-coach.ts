import Anthropic from "@anthropic-ai/sdk";

import type { ManualEventSignals } from "@/lib/rule-engine";

const LANGUAGE_NAMES: Record<string, string> = {
  he: "Hebrew",
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  ru: "Russian",
  ar: "Arabic",
};

export type RecentMessage = {
  message: string;
  traderState: string;
};

export type AICoachInput = {
  message: string;
  language: string;
  source: "telegram" | "broker_alert";
  alertContext?: string | null;
  actionId: string | null;
  primaryMarket: string | null;
  tradingStyle: string | null;
  coachingTone: string | null;
  maxDailyLoss: number | null;
  maxTradesPerDay: number | null;
  stopAfterLosses: number | null;
  riskPerTrade: number | null;
  currentState: string;
  cooldownActive: boolean;
  recentLossStreak: number;
  guardianLocked: boolean;
  lockoutReason: string | null;
  sessionStarted: boolean;
  sessionEnded: boolean;
  todaySessionStateKind: string;
  hasBlockingViolation: boolean;
  violationMessage: string | null;
  warningMessages: string[];
  isPreNewsWindow: boolean;
  preNewsMessage: string | null;
  manualSignals: ManualEventSignals | null;
  recentMessages: RecentMessage[];
};

function buildHebrewStyleBlock(coachingTone: string | null): string[] {
  const isDirectTone = coachingTone?.toLowerCase().includes("direct") ?? false;

  const block: string[] = [
    "HEBREW COACHING STYLE (you are responding in Hebrew — apply these):",
    "Write like a native Israeli speaking to a fellow trader, not like a translated document.",
    "- Short sentences. Colloquial, grounded, human.",
    "- Natural openers: \"רגע\", \"שמע\", \"בסדר\", \"תעצור שנייה\", \"מה קורה כאן?\"",
    "- Natural redirects: \"תצא מהמסך\", \"תן לזה לחלוף\", \"לא עכשיו\", \"קח נשימה\"",
    "- Natural acknowledgment: \"זה קרה\", \"מובן\", \"זה לא נעים\", \"ברור שאתה מתוסכל\"",
    "- AVOID these unnatural translated phrases:",
    "  × \"אני מאמן המסחר שלך\"",
    "  × \"שמור על משמעת\" / \"ממשמעת מסחרית\"",
    "  × \"לפי הכללים שלך\"",
    "  × \"אתה בתוך שתי הפסדים\"",
    "  × \"זה איך שחשבונות מתרסקים\"",
    "  × \"לשמור על ממשמעת וממש עכשיו\"",
    "- Do not literally translate English coaching phrases into Hebrew.",
  ];

  if (isDirectTone) {
    block.push(
      "Direct tone in Hebrew: 1-2 sentences only. Sharp, warm, no softening. One thing to notice, one thing to do.",
    );
  }

  block.push("");
  return block;
}

function buildSystemPrompt(input: AICoachInput): string {
  const langName = LANGUAGE_NAMES[input.language] ?? "English";

  const lines: string[] = [
    `You are a trading coach. Respond ONLY in ${langName}.`,
    "",
    "REPLY STYLE:",
    "- 2 to 3 sentences maximum. Short is better than thorough.",
    "- First sentence: acknowledge what they're feeling, plainly and without judgment.",
    "- Second sentence: one specific, grounded next step or reflection.",
    "- Third sentence: one follow-up question — only if it genuinely moves something forward. Skip it otherwise.",
    "",
    "NEVER:",
    '- Lecture or moralize. No "you know better", "you already know this."',
    '- Use clichés: "discipline is key", "stick to the plan", "trust the process", "your rules exist for a reason."',
    '- Catastrophize: "this is how accounts blow up", "revenge trading destroys accounts."',
    '- Open with "As your coach", "I understand that", "It sounds like", or "I can see that."',
    "- Repeat the situation back to them — they lived it.",
    "- Use bullet points, lists, or headers in the reply.",
    "- State specific numbers (loss count, trade count, P&L) as verified facts. This data is self-reported by the trader, not broker-verified. Acknowledge the emotional state — do not echo the number back as a fact.",
    "- Infer a loss count from a rule threshold alone. If the rules say 'stop after 2 losses' but no actual streak is shown, do not say they hit 2 losses.",
    "",
  ];

  if (input.language === "he") {
    lines.push(...buildHebrewStyleBlock(input.coachingTone));
  }

  // Situation facts — context for the AI, not instructions to announce
  const situationParts: string[] = [];

  const sessionState = input.sessionEnded
    ? "ended"
    : input.sessionStarted
      ? "active"
      : "not started";
  situationParts.push(`Session: ${sessionState}`);

  if (input.currentState && input.currentState !== "NONE") {
    situationParts.push(`Trader state: ${input.currentState}`);
  }
  if (input.recentLossStreak > 0) {
    situationParts.push(`Self-reported loss streak: ${input.recentLossStreak} (not broker-verified)`);
  }

  const profileParts: string[] = [];
  if (input.primaryMarket) profileParts.push(`market: ${input.primaryMarket}`);
  if (input.tradingStyle) profileParts.push(`style: ${input.tradingStyle}`);
  if (input.coachingTone) profileParts.push(`preferred tone: ${input.coachingTone}`);
  if (profileParts.length > 0) situationParts.push(`Trader: ${profileParts.join(", ")}`);

  const ruleParts: string[] = [];
  if (input.maxDailyLoss) ruleParts.push(`max daily loss: ${input.maxDailyLoss}`);
  if (input.maxTradesPerDay) ruleParts.push(`max trades/day: ${input.maxTradesPerDay}`);
  if (input.stopAfterLosses) ruleParts.push(`stop after ${input.stopAfterLosses} consecutive losses`);
  if (ruleParts.length > 0) situationParts.push(`Rules: ${ruleParts.join(", ")}`);

  const m = input.manualSignals;
  if (m && (m.tradeCount > 0 || m.hasRuleBreach)) {
    const parts: string[] = [];
    if (m.tradeCount > 0) parts.push(`${m.tradeCount} trades (self-reported)`);
    if (m.consecutiveLosses > 0) parts.push(`${m.consecutiveLosses} consecutive losses (self-reported)`);
    if (m.hasRuleBreach) parts.push("rule breach logged");
    situationParts.push(`Manual log: ${parts.join(", ")}`);
  }

  if (situationParts.length > 0) {
    lines.push("SITUATION:");
    lines.push(...situationParts.map((p) => `- ${p}`));
    lines.push("");
  }

  if (input.warningMessages.length > 0) {
    lines.push(`Proximity warnings: ${input.warningMessages.slice(0, 2).join("; ")}`);
    lines.push("");
  }

  // Per-state coaching intent — gives the AI latitude to be natural
  const state = input.currentState?.toLowerCase() ?? "";
  if (state.includes("fomo")) {
    lines.push("Coaching intent: The trader is feeling FOMO. Acknowledge the pull without judging it. One grounding thought — what they can actually control right now.");
  } else if (state.includes("revenge")) {
    lines.push("Coaching intent: The trader wants to revenge trade. Acknowledge the frustration. Redirect to stepping away — no debate about whether the next trade will be different.");
  } else if (state.includes("tilt") || state.includes("out_of_control")) {
    lines.push("Coaching intent: The trader is tilted. Ground them first. One small concrete thing they can do. No trades right now.");
  } else if (state.includes("just_took_two_loss")) {
    lines.push("Coaching intent: The trader self-reported multiple consecutive losses. Acknowledge the emotional weight without repeating the count. Help them pause and check if they're still clear-headed.");
  } else if (state.includes("just_took_loss")) {
    lines.push("Coaching intent: The trader self-reported a fresh loss. Acknowledge it — one sentence. Ask if they want to keep going or step back.");
  } else if (state.includes("reset") || state.includes("calm") || state.includes("premarket")) {
    lines.push("Coaching intent: The trader is in a good or recovering state. Keep it grounded — brief acknowledgment, no overpraise.");
  }

  // Hard safety constraints — framed as situational facts, not enforcement language
  const constraints: string[] = [];

  if (input.guardianLocked) {
    const reason = input.lockoutReason ?? "daily limit reached";
    constraints.push(`The account is locked for today (${reason}). One sentence — matter-of-fact. No drama.`);
  }

  if (input.cooldownActive) {
    constraints.push("The trader is in a cooldown period. Stepping away is the right move right now — say this plainly.");
  }

  if (
    input.stopAfterLosses &&
    input.recentLossStreak >= input.stopAfterLosses
  ) {
    constraints.push(`The trader hit their consecutive-loss limit (${input.recentLossStreak} of ${input.stopAfterLosses}). Trading stops here — say this clearly, without drama or moralizing.`);
  }

  if (input.hasBlockingViolation && input.violationMessage) {
    constraints.push(`Active rule limit: ${input.violationMessage}. Mention it plainly, once.`);
  }

  if (input.isPreNewsWindow && input.preNewsMessage) {
    constraints.push(`News window: ${input.preNewsMessage}. Flag the timing briefly.`);
  }

  if (input.alertContext) {
    constraints.push(`Broker context: ${input.alertContext}`);
  }

  if (constraints.length > 0) {
    lines.push("");
    lines.push("CONSTRAINTS (weave these in naturally — do not list or announce them):");
    lines.push(...constraints.map((c) => `- ${c}`));
  }

  // Recent session history for conversational continuity
  if (input.recentMessages.length > 0) {
    lines.push("");
    lines.push("Recent session (oldest first):");
    for (const msg of input.recentMessages) {
      const stateLabel = msg.traderState && msg.traderState !== "NONE" ? ` [${msg.traderState}]` : "";
      lines.push(`- ${msg.message}${stateLabel}`);
    }
  }

  return lines.join("\n");
}

export function isAICoachEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Quick-action IDs where emotional coaching adds real value
export const EMOTIONAL_ACTION_IDS = new Set([
  "fomo",
  "revenge",
  "just-lost",
  "lost-twice",
  "angry",
  "out-of-control",
  "calming-down",
  "back-in-control",
]);

export function shouldUseAICoach(params: {
  actionId: string | null;
  isFreeText: boolean;
  guardianLocked: boolean;
  hasBlockingViolation: boolean;
  cooldownActive: boolean;
}): boolean {
  if (!isAICoachEnabled()) return false;
  // User typed something — always worth a human-feeling reply
  if (params.isFreeText) return true;
  // Emotional quick actions benefit from contextual coaching
  if (params.actionId && EMOTIONAL_ACTION_IDS.has(params.actionId)) return true;
  // Hard safety enforcement should feel human, not robotic
  if (params.guardianLocked || params.hasBlockingViolation || params.cooldownActive) return true;
  // Lightweight button taps (check-in, day-summary, rule-limits) → skip AI
  return false;
}

export async function generateAICoachReply(
  input: AICoachInput,
): Promise<string | null> {
  if (!isAICoachEnabled()) return null;

  const client = new Anthropic();

  try {
    const response = await client.messages.create(
      {
        model: "claude-haiku-4-5",
        max_tokens: 120,
        system: [
          {
            type: "text",
            text: buildSystemPrompt(input),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: input.message }],
      },
      { timeout: 10_000 },
    );

    const block = response.content[0];
    return block?.type === "text" ? block.text.trim() : null;
  } catch (err) {
    console.error("[ai-coach] generateAICoachReply failed:", err);
    return null;
  }
}
