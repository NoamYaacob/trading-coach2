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
  tradingWhy: string | null;
  tradingGoal: string | null;
  groundingReminder: string | null;
};

function buildLanguageStyleBlock(language: string, coachingTone: string | null): string[] {
  const isDirect = coachingTone?.toLowerCase().includes("direct") ?? false;
  const isSupportive = coachingTone?.toLowerCase().includes("support") ?? false;
  const toneNote = isDirect
    ? "Tone: 1 sentence is ideal. 2 is fine. 3 is the limit. Stop early."
    : isSupportive
      ? "Tone: 2 sentences. 3 maximum. Warm, not wordy."
      : "Tone: 1-2 sentences. If it fits in one, use one.";

  switch (language) {
    case "he":
      return [
        "HEBREW COACHING STYLE:",
        "Write like someone stopping a trader mid-action — abrupt, direct, warm. Not a polished text message.",
        "Israeli coaching is punchy and real. A sentence fragment is fine. Never translate English phrases.",
        "- Start with a particle when it fits: \"רגע\", \"שמע\", \"בסדר\", \"תעצור\"",
        "- Redirects: \"תצא מהמסך\", \"תן לזה לחלוף\", \"לא עכשיו\", \"קח נשימה\"",
        "- Acknowledgment: \"זה קרה\", \"מובן\", \"ברור שאתה מתוסכל\"",
        "- Example good replies:",
        "  ✓ \"רגע, תצא מהמסך.\"",
        "  ✓ \"זה קרה — מה עכשיו?\"",
        "  ✓ \"שמע, לא עכשיו. תן לזה לחלוף.\"",
        "  ✓ \"תנשום. הצעד הבא חשוב יותר מהאחרון.\"",
        "- AVOID:",
        "  ✗ \"אני מאמן המסחר שלך\"",
        "  ✗ \"שמור על משמעת\" / \"ממשמעת מסחרית\"",
        "  ✗ \"לפי הכללים שלך\"",
        "  ✗ Long explanatory sentences that build toward a point",
        toneNote,
        "",
      ];

    case "en":
      return [
        "ENGLISH COACHING STYLE:",
        "Sharp, direct, peer-to-peer. Like a trader stopping another trader — not a life coach.",
        "- Example good replies:",
        "  ✓ \"Step away. Come back in ten.\"",
        "  ✓ \"That happens. What do you want to do next?\"",
        "  ✓ \"Not now — let that one settle first.\"",
        "- AVOID: \"As your trading coach\", \"maintain discipline\", \"trust the process\", building up to the point",
        toneNote,
        "",
      ];

    case "es":
      return [
        "SPANISH COACHING STYLE:",
        "Casual, direct, warm. Tú, not usted. Like a friend who trades stopping you mid-move.",
        "- Example good replies:",
        "  ✓ \"Para. Aléjate un momento.\"",
        "  ✓ \"Ya pasó — ¿qué hacemos ahora?\"",
        "  ✓ \"Tranquilo, eso pasa. No ahora.\"",
        "- AVOID: \"Soy tu coach\", \"mantén la disciplina\", building slowly toward a point",
        toneNote,
        "",
      ];

    case "fr":
      return [
        "FRENCH COACHING STYLE:",
        "Direct, grounded, human. Tu, not vous. Not a corporate training tone.",
        "- Example good replies:",
        "  ✓ \"Stop. Éloigne-toi de l'écran.\"",
        "  ✓ \"C'est arrivé — qu'est-ce que tu fais maintenant?\"",
        "  ✓ \"Pas maintenant. Laisse passer.\"",
        "- AVOID: \"Je suis ton coach\", \"maintiens la discipline\", long explanations",
        toneNote,
        "",
      ];

    case "de":
      return [
        "GERMAN COACHING STYLE:",
        "Efficient, clear, human. Du, not Sie. German directness without coldness.",
        "- Example good replies:",
        "  ✓ \"Stop. Weg vom Bildschirm.\"",
        "  ✓ \"Passiert — was jetzt?\"",
        "  ✓ \"Nicht jetzt. Lass das sacken.\"",
        "- AVOID: \"Ich bin dein Coach\", \"halte die Disziplin aufrecht\", building toward a conclusion",
        toneNote,
        "",
      ];

    case "ru":
      return [
        "RUSSIAN COACHING STYLE:",
        "Direct, warm, no-nonsense. Informal ты. Like a fellow trader stepping in.",
        "- Example good replies:",
        "  ✓ \"Стоп. Отойди от экрана.\"",
        "  ✓ \"Бывает — что дальше?\"",
        "  ✓ \"Не сейчас. Дай этому пройти.\"",
        "- AVOID: \"Я твой тренер\", \"соблюдай дисциплину\", long explanations",
        toneNote,
        "",
      ];

    case "ar":
      return [
        "ARABIC COACHING STYLE:",
        "Clear, accessible Modern Standard Arabic — direct and warm, not overly formal.",
        "- Example good replies:",
        "  ✓ \"توقف. ابتعد عن الشاشة.\"",
        "  ✓ \"هذا يحدث — ماذا الآن?\"",
        "  ✓ \"ليس الآن. دع هذا يمر.\"",
        "- AVOID: \"أنا مدربك\", \"حافظ على الانضباط\", long explanations",
        toneNote,
        "",
      ];

    default:
      return [];
  }
}

function buildSystemPrompt(input: AICoachInput): string {
  const langName = LANGUAGE_NAMES[input.language] ?? "English";

  const lines: string[] = [
    `You are a trading coach. Respond ONLY in ${langName}.`,
    "",
    "REPLY STYLE:",
    "- 1 sentence is ideal. 2 is fine. 3 is the hard maximum — only when the situation genuinely needs it.",
    "- Start with the point. Do not build up to it.",
    "- One clear truth OR one clear next action. Not both, not explained.",
    "- A follow-up question is optional. Only ask one, and only if it genuinely moves something.",
    "",
    "NEVER:",
    "- Say the same idea twice in different words. Every sentence must add something new.",
    "- Explain your reasoning. Just say the thing.",
    '- Lecture or moralize ("you know better", "this is how accounts blow up").',
    '- Use clichés: "discipline is key", "stick to the plan", "trust the process".',
    '- Open with "As your coach", "I understand that", "It sounds like".',
    "- Repeat the situation back to them — they lived it.",
    "- Use bullet points, lists, or headers.",
    "- State specific numbers (loss count, trade count, P&L) as verified facts — this is self-reported data.",
    "- Infer a loss count from a rule threshold. If rules say 'stop after 2' but no streak is shown, do not assert they hit 2.",
    "",
  ];

  const langBlock = buildLanguageStyleBlock(input.language, input.coachingTone);
  if (langBlock.length > 0) {
    lines.push(...langBlock);
  }

  // Personal coaching memory — use to inform tone, not to quote verbatim
  const personalParts: string[] = [];
  if (input.tradingWhy) personalParts.push(`Why they trade: ${input.tradingWhy}`);
  if (input.tradingGoal) personalParts.push(`Building toward: ${input.tradingGoal}`);
  if (input.groundingReminder) personalParts.push(`What grounds them: ${input.groundingReminder}`);

  if (personalParts.length > 0) {
    lines.push("PERSONAL COACHING MEMORY (use to inform tone and direction — do not quote verbatim):");
    lines.push(...personalParts.map((p) => `- ${p}`));
    lines.push(
      "When the trader is spiraling, you may briefly surface their deeper reason for trading — only when it feels natural and grounding, not every reply. One line, not a speech.",
    );
    lines.push("");
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
    lines.push("Intent: FOMO — name the pull briefly, redirect to what they can control.");
  } else if (state.includes("revenge")) {
    lines.push("Intent: Revenge impulse — one line of acknowledgment, one redirect to stepping away. No debate.");
  } else if (state.includes("tilt") || state.includes("out_of_control")) {
    lines.push("Intent: Tilted — ground them with one concrete thing. No trades.");
  } else if (state.includes("just_took_two_loss")) {
    lines.push("Intent: Multiple losses self-reported — acknowledge the weight, no count. Help them pause.");
  } else if (state.includes("just_took_loss")) {
    lines.push("Intent: Fresh loss — one acknowledgment. Let them decide what's next.");
  } else if (state.includes("reset") || state.includes("calm") || state.includes("premarket")) {
    lines.push("Intent: Recovering — brief acknowledgment, grounded. No overpraise.");
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
        max_tokens: 90,
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
