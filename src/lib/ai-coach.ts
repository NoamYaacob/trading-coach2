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
    ? "Tone: 1-2 sentences only. Sharp, clear, no softening."
    : isSupportive
      ? "Tone: 2-3 sentences. Warm, steady, grounding."
      : "Tone: 2-3 sentences. Direct but human.";

  switch (language) {
    case "he":
      return [
        "HEBREW COACHING STYLE (you are responding in Hebrew):",
        "Write like a native Israeli speaking to a fellow trader — not a translated document.",
        "- Short sentences. Colloquial, grounded, warm when needed.",
        "- Natural openers: \"רגע\", \"שמע\", \"בסדר\", \"תעצור שנייה\", \"מה קורה כאן?\"",
        "- Natural redirects: \"תצא מהמסך\", \"תן לזה לחלוף\", \"לא עכשיו\", \"קח נשימה\"",
        "- Natural acknowledgment: \"זה קרה\", \"מובן\", \"ברור שאתה מתוסכל\", \"זה לא נעים\"",
        "- AVOID: \"אני מאמן המסחר שלך\", \"שמור על משמעת\", \"לפי הכללים שלך\",",
        "  \"אתה בתוך שתי הפסדים\", \"לשמור על ממשמעת וממש עכשיו\", \"ממשמעת מסחרית\"",
        "- Do not translate English coaching phrases into Hebrew literally.",
        toneNote,
        "",
      ];

    case "en":
      return [
        "ENGLISH COACHING STYLE:",
        "Sound like a sharp, experienced trader talking to a peer — not a life coach or chatbot.",
        "- Short, plain sentences. Skip the corporate-speak.",
        "- Natural openers: \"Okay\", \"Stop for a second\", \"That makes sense\", \"Take five\"",
        "- Natural redirects: \"Step away from the screen\", \"Let that pass\", \"Not right now\"",
        "- AVOID: \"As your trading coach\", \"maintain discipline\", \"trust the process\",",
        "  \"your rules exist for a reason\", \"this is how accounts blow up\"",
        toneNote,
        "",
      ];

    case "es":
      return [
        "SPANISH COACHING STYLE (you are responding in Spanish):",
        "Write like a real person talking to a fellow trader — casual, direct, warm. Use 'tú', not 'usted'.",
        "- Short sentences. Colloquial, not formal.",
        "- Natural openers: \"Para\", \"Tranquilo\", \"Un momento\", \"Oye\", \"¿Qué está pasando?\"",
        "- Natural redirects: \"Aléjate de la pantalla\", \"Deja que pase\", \"Ahora no\"",
        "- AVOID: \"Soy tu coach de trading\", \"mantén la disciplina\", \"confía en el proceso\"",
        "- Do not literally translate English phrases into Spanish.",
        toneNote,
        "",
      ];

    case "fr":
      return [
        "FRENCH COACHING STYLE (you are responding in French):",
        "Write like a grounded French-speaking mentor, not a corporate training manual.",
        "- Short, direct sentences. Use 'tu', not 'vous'.",
        "- Natural openers: \"Stop\", \"Ok\", \"Calme-toi\", \"Prends du recul\", \"C'est normal\"",
        "- Natural redirects: \"Éloigne-toi de l'écran\", \"Laisse passer ça\", \"Pas maintenant\"",
        "- AVOID: \"Je suis ton coach de trading\", \"maintiens la discipline\", \"fais confiance au processus\"",
        "- Do not translate English coaching phrases literally into French.",
        toneNote,
        "",
      ];

    case "de":
      return [
        "GERMAN COACHING STYLE (you are responding in German):",
        "Write like a direct, no-nonsense German-speaking mentor — efficient, clear, human.",
        "- Short sentences. Use 'du', not 'Sie'.",
        "- Natural openers: \"Stop\", \"Okay\", \"Kurz innehalten\", \"Was passiert gerade?\"",
        "- Natural redirects: \"Geh kurz weg vom Bildschirm\", \"Lass das sacken\", \"Nicht jetzt\"",
        "- AVOID: \"Ich bin dein Trading-Coach\", \"halte die Disziplin aufrecht\", \"vertrau dem Prozess\"",
        "- Do not literally translate English coaching phrases into German.",
        toneNote,
        "",
      ];

    case "ru":
      return [
        "RUSSIAN COACHING STYLE (you are responding in Russian):",
        "Write like a direct, warm Russian-speaking mentor — no-nonsense but not cold.",
        "- Short sentences. Use informal 'ты'.",
        "- Natural openers: \"Стоп\", \"Окей\", \"Подожди секунду\", \"Что происходит?\"",
        "- Natural redirects: \"Отойди от экрана\", \"Дай этому пройти\", \"Не сейчас\"",
        "- Natural acknowledgment: \"Это случается\", \"Понятно\", \"Всё нормально\"",
        "- AVOID: \"Я твой тренер по трейдингу\", \"соблюдай дисциплину\", \"доверяй процессу\"",
        "- Do not literally translate English coaching phrases into Russian.",
        toneNote,
        "",
      ];

    case "ar":
      return [
        "ARABIC COACHING STYLE (you are responding in Arabic):",
        "Write in clear, accessible Modern Standard Arabic — grounded and direct, not overly formal or classical.",
        "- Short sentences. Human and warm.",
        "- Natural openers: \"توقف\", \"خذ نفساً\", \"ماذا يحدث الآن؟\", \"هذا طبيعي\"",
        "- Natural redirects: \"ابتعد عن الشاشة\", \"دع هذا يمر\", \"ليس الآن\"",
        "- AVOID: \"أنا مدربك في التداول\", \"حافظ على الانضباط\", \"ثق في العملية\"",
        "- Do not literally translate English coaching phrases into Arabic.",
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
