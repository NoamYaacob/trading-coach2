import Anthropic from "@anthropic-ai/sdk";

import type { ManualEventSignals } from "@/lib/rule-engine";
import { getToneVoiceGuidance, normalizeToneId } from "@/lib/coaching-tones";
import { deriveShortTermCoachingState } from "@/lib/coaching-state";
import { generateVoiceReply } from "@/lib/voice-writer";
import type { CoachingExchange, CoachingIntent, PersonalCue, VoiceWriterInput } from "@/lib/voice-writer";

const LANGUAGE_NAMES: Record<string, string> = {
  he: "Hebrew",
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  ru: "Russian",
  ar: "Arabic",
};

export type ConversationMode = "coaching" | "casual" | "clarification" | "meta";

export function detectConversationMode(params: {
  message: string;
  hasEmotionalAction: boolean;
  guardianLocked: boolean;
}): ConversationMode {
  // Hard account lockout is its own message — always coaching
  if (params.guardianLocked) return "coaching";

  // Emotional quick action = unambiguously coaching
  if (params.hasEmotionalAction) return "coaching";

  const msg = params.message.trim();
  if (!msg) return "casual";

  // META: user asking about bot's knowledge, memory, or stored profile
  // English + Hebrew patterns
  if (
    /what (do you|don'?t you) know|what you (know|remember|have)|your (context|memory|profile)|what('?s| is| are) (my|your) (rules?|profile|settings?|context|memory|limits?)/i.test(msg) ||
    /מה אתה יודע|מה יש לך עליי|מה הכללים שלי|מה הפרופיל שלי|מה אתה זוכר/.test(msg)
  ) {
    return "meta";
  }

  // CLARIFICATION: user questioning a previous reply
  // English + Hebrew patterns
  if (
    /(why|how) (did|do) you (say|tell|think|know)|what did you mean|what do you mean by|you (just |already )?said|based on what|explain (why|what that|what you)/i.test(msg) ||
    /למה אמרת|מה התכוונת|על סמך מה|מה זה אומר|למה כתבת|מה הכוונה/.test(msg)
  ) {
    return "clarification";
  }

  // COACHING: English trading / emotional / distress keywords
  if (
    /\b(trade|trading|market|loss|lost|profit|position|setup|entry|exit|fomo|revenge|tilt|hesitat|impulse|drawdown|pnl|stop.?loss|risk|short|long)\b/i.test(msg)
  ) {
    return "coaching";
  }
  // COACHING: English distress phrases (free-text distress signals)
  if (
    /\b(messed up|tilted|make it back|one more trade|recover this|don.?t care|going to blow|can.?t stop|need to win|making back|chasing|revenge|screwed up|out of control|losing it|losing control|breaking rules|broke my rules|breaking my rules|impulse trade|overtrad)\b/i.test(msg)
  ) {
    return "coaching";
  }

  // COACHING: Hebrew trading / emotional / distress terms
  if (
    /הפסד|מסחר|עסקה|שוק המניות|להיכנס לעסקה|לצאת מעסקה|רווח|פוזיציה|סטאפ|ריגוש|כועס על|מתוסכל|ירד לי|עלה לי|לא בשליטה|עוד עסקה|צריך להחזיר|עשיתי שטות|שברתי את הכללים|לא אכפת לי|הולך לפוצץ|אין לי שליטה/.test(msg)
  ) {
    return "coaching";
  }

  // COACHING: Arabic and Russian trading / distress terms
  if (/потер|торг|рынок|убыт|вышел из под контроля|ещё одну сделку|خسار|تداول|سوق|فقدت السيطرة/.test(msg)) {
    return "coaching";
  }

  return "casual";
}

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
  primaryChallenge: string | null;
  tiltTrigger: string | null;
  tiltThought: string | null;
  interruptionStyle: string | null;
  responseStyle: string | null;
  preferredAddress: string | null;
  disciplineBreakPattern: string | null;
  whatHelpsRefocus: string | null;
  reminderAnchors: string[];
  wantsGoalReminders: boolean;
  wantsToughInterventionWhenTilting: boolean;
  todayTradesCount: number;
  todayPnL: number;
  consecutiveLosses: number;
  conversationMode: ConversationMode;
  recentCoachingExchanges: CoachingExchange[];
};

// Coaching voice is in voice-writer.ts. Dead code below removed.

// Voice guidance for non-coaching modes (casual / meta / clarification).
// Each language gets its own natural-chat style note — more specific than one generic line.
function buildLanguageCasualNote(language: string): string[] {
  switch (language) {
    case "he":
      return [
        "HEBREW VOICE:",
        "Write like someone texting in Hebrew. Israeli, direct, short.",
        "Fragments are fine. No subject needed. Say the thing and stop.",
        "",
        "EXAMPLES:",
        '  "לא רע. אתה?"',
        '  "הממ, לא ממש הדבר שלי — אבל ספר."',
        '  "כן, בטח."',
        '  "מה פתאום."',
        '  "אין לי מושג — מה דעתך?"',
        "",
        '✗ "אני שמח לסייע" / "אכן" / "בהחלט" / "בוודאי"',
        '✗ "זה נשמע כמו" / "אני מבין" / "מעניין מאוד"',
        '✗ "אני חושב ש..." — say the thing directly',
        "",
      ];
    case "en":
      return [
        "ENGLISH VOICE: Short, natural, like texting. Not a formal assistant. 1-2 sentences max.",
        "",
      ];
    case "es":
      return [
        "SPANISH VOICE: Natural spoken Spanish, tú form. Short, casual. 1-2 sentences max.",
        "",
      ];
    case "fr":
      return [
        "FRENCH VOICE: Natural spoken French, tu form. Short, direct, not corporate. 1-2 sentences max.",
        "",
      ];
    case "de":
      return [
        "GERMAN VOICE: Natural spoken German, du form. Short, direct. 1-2 sentences max.",
        "",
      ];
    case "ru":
      return [
        "RUSSIAN VOICE: Natural spoken Russian, ты form. Short, warm, direct. 1-2 sentences max.",
        "",
      ];
    case "ar":
      return [
        "ARABIC VOICE: Clear accessible Arabic, warm and direct. Short. 1-2 sentences max.",
        "",
      ];
    default:
      return [
        `Write naturally in ${language}. Short, direct, like a real person in chat. 1-2 sentences max.`,
        "",
      ];
  }
}

function buildAddressGuidance(preferredAddress: string | null, language: string): string | null {
  if (!preferredAddress || preferredAddress === "NO_PREFERENCE" || preferredAddress === "") return null;

  switch (language) {
    case "he":
      if (preferredAddress === "MASCULINE") return "GRAMMATICAL GENDER: Use masculine Hebrew forms throughout (אתה, מוכן, עשית, יכול, הגעת).";
      if (preferredAddress === "FEMININE") return "GRAMMATICAL GENDER: Use feminine Hebrew forms throughout (את, מוכנה, עשית, יכולה, הגעת).";
      return "GRAMMATICAL GENDER: Prefer gender-neutral phrasing where possible in Hebrew.";
    case "ar":
      if (preferredAddress === "MASCULINE") return "GRAMMATICAL GENDER: Use masculine Arabic agreement forms throughout.";
      if (preferredAddress === "FEMININE") return "GRAMMATICAL GENDER: Use feminine Arabic agreement forms throughout.";
      return null;
    case "es":
      if (preferredAddress === "MASCULINE") return "GRAMMATICAL GENDER: Use masculine Spanish agreement forms (listo, preparado, cansado).";
      if (preferredAddress === "FEMININE") return "GRAMMATICAL GENDER: Use feminine Spanish agreement forms (lista, preparada, cansada).";
      return null;
    case "fr":
      if (preferredAddress === "MASCULINE") return "GRAMMATICAL GENDER: Use masculine French agreement forms throughout.";
      if (preferredAddress === "FEMININE") return "GRAMMATICAL GENDER: Use feminine French agreement forms throughout.";
      return null;
    case "de":
      if (preferredAddress === "MASCULINE") return "GRAMMATICAL GENDER: Use masculine German agreement forms where applicable.";
      if (preferredAddress === "FEMININE") return "GRAMMATICAL GENDER: Use feminine German agreement forms where applicable.";
      return null;
    default:
      return null;
  }
}

function buildSystemPrompt(input: AICoachInput): string {
  const langName = LANGUAGE_NAMES[input.language] ?? "English";
  const mode = input.conversationMode;
  const isCoaching = mode === "coaching";
  const isMeta = mode === "meta";
  const toneId = normalizeToneId(input.coachingTone);
  const isDirect = toneId === "direct" || toneId === "strict" || toneId === "tough_love";
  const isSupportive = toneId === "calm";

  const replyLengthLine = !isCoaching
    ? "- 1-2 sentences."
    : isDirect
      ? "- 1 sentence is ideal. 2 is fine. 3 is the hard maximum. Stop as soon as it is said."
      : isSupportive
        ? "- 2-3 sentences is natural. 4 is the hard maximum. No padding."
        : "- 1-2 sentences. If it fits in one, use one.";

  const modeInstruction: Record<ConversationMode, string> = {
    coaching: "Use the trader context below. Be short, grounded, human.",
    casual: "Just reply. Short. Don't try to sound human — react.",
    clarification: "Answer exactly what was asked. Specific and honest. Stop there.",
    meta: "Answer only what was asked. One sentence per fact. No framing, no transitions.",
  };

  const lines: string[] = [
    `You are a human coach who works with traders. Respond ONLY in ${langName}.`,
    "",
    `CONVERSATION MODE: ${mode.toUpperCase()}`,
    modeInstruction[mode],
    "",
  ];

  if (isMeta) {
    lines.push("REPLY STYLE:");
    lines.push("- Numbers and facts only. 1-2 short lines. Nothing else.");
    lines.push("- Start with the number or answer. Stop when it's stated.");
    lines.push("");
    lines.push("NEVER:");
    lines.push("- End with a question of any kind.");
    lines.push("- Add coaching, context, framing, or encouragement.");
    lines.push("- Invent facts not in FACTS below.");
    lines.push('- Open with "As your coach", "It sounds like", or any warm-up.');
    lines.push("");
  } else {
    lines.push("REPLY STYLE:");
    lines.push("- 1-2 sentences. If one does it, use one.");
    lines.push("- Start with the answer. No warm-up.");
    lines.push("");
    lines.push("NEVER:");
    lines.push('- Open with "As your coach", "I understand that", "It sounds like".');
    lines.push("- Use bullet points, lists, or headers.");
    lines.push("- Invent facts not explicitly in this prompt.");
    lines.push('- Sound like a chatbot or assistant.');
    lines.push("- Set up the answer — just give it.");
    lines.push("");
  }

  if (isCoaching) {
    lines.push("HOW TO RESPOND:");
    lines.push("Match the moment. Pain needs acknowledgment before direction. Calm needs forward, not review.");
    lines.push("");
    lines.push("Structures that work (pick one):");
    lines.push("  Acknowledge (one line) → one action OR one question. Stop.");
    lines.push("  One truth that reframes the moment. Stop.");
    lines.push("  One question that opens a different angle. Just that.");
    lines.push("");
    lines.push("What makes it feel human:");
    lines.push("  Name what's happening — don't ask them to confirm it. ('That one stings.' not 'Are you frustrated?')");
    lines.push("  Speak from the assumption they already know the theory. Don't teach it.");
    lines.push("  When they're spiraling: if you know their specific pattern (below), name it. They told you. Use it.");
    lines.push("  Their personal why/goal: one line, at the right moment. Not every reply.");
    lines.push("");
  }

  // Language voice: casual note for non-coaching (coaching voice is in voice-writer.ts)
  if (!isCoaching) {
    lines.push(...buildLanguageCasualNote(input.language));
  }

  // Form-of-address guidance (all modes where language agreement matters)
  const addressGuidance = buildAddressGuidance(input.preferredAddress, input.language);
  if (addressGuidance) {
    lines.push(addressGuidance);
    lines.push("");
  }

  // Coaching tone voice guidance — coaching only
  if (isCoaching) {
    const toneGuidance = getToneVoiceGuidance(input.coachingTone);
    if (toneGuidance) {
      lines.push(`COACHING TONE (trader's preference): ${toneGuidance}`);
      lines.push("");
    }
  }

  // Interruption style — coaching only
  if (isCoaching && input.interruptionStyle) {
    const interruptionGuides: Record<string, string> = {
      "Gentle pause":      "INTERRUPTION STYLE (trader's preference): Soft, non-confrontational — like a hand on the shoulder. Pause, don't jolt.",
      "Pattern interrupt": "INTERRUPTION STYLE (trader's preference): Break the pattern with contrast or brief surprise. Jarring enough to shift attention, not harsh.",
      "Ask a question":    "INTERRUPTION STYLE (trader's preference): Lead with a question — not an assertion. Make them think before acting.",
      "Hard stop reminder":"INTERRUPTION STYLE (trader's preference): Clear and direct. Name the limit or the rule. No softening.",
    };
    const interruptGuide = interruptionGuides[input.interruptionStyle];
    if (interruptGuide) {
      lines.push(interruptGuide);
      lines.push("");
    }
  }

  // Response format — coaching only
  if (isCoaching && input.responseStyle) {
    const responseFormatGuides: Record<string, string> = {
      "One-line prompts":       "RESPONSE FORMAT (trader's preference): One focused line — hit the key point and stop. No follow-up unless essential.",
      "Short bullets":          "RESPONSE FORMAT (trader's preference): 2-3 short fragments, each landing separately. Not full sentences.",
      "Reflective questions":   "RESPONSE FORMAT (trader's preference): Lead with a question. Open reflection — don't give the answer.",
      "Action checklist":       "RESPONSE FORMAT (trader's preference): 1-2 concrete next actions. Ordered only if sequence matters.",
    };
    const formatGuide = responseFormatGuides[input.responseStyle];
    if (formatGuide) {
      lines.push(formatGuide);
      lines.push("");
    }
  }

  // Personal coaching memory — coaching + meta only
  const personalParts: string[] = [];
  if (input.tradingWhy) personalParts.push(`Why they trade: ${input.tradingWhy}`);
  if (input.tradingGoal) personalParts.push(`Building toward: ${input.tradingGoal}`);
  if (input.groundingReminder) personalParts.push(`What grounds them: ${input.groundingReminder}`);
  if (input.reminderAnchors.length > 0) {
    personalParts.push(`Personal anchors: ${input.reminderAnchors.join(" / ")}`);
  }

  if (personalParts.length > 0 && isCoaching) {
    lines.push(isCoaching ? "PERSONAL COACHING MEMORY:" : "WHAT YOU KNOW:");
    lines.push(...personalParts.map((p) => `- ${p}`));
    if (isCoaching) {
      lines.push("Surface sparingly — only when it would feel genuinely grounding, not every reply:");
      lines.push("  • Why they trade → when they question purpose or feel lost");
      lines.push("  • Their goal → as a forward anchor after a loss or when they reset");
      lines.push("  • Grounding reminder → when tilted, revenge state, or overwhelmed");
      lines.push("  • Personal anchors → can echo verbatim, once, when it fits the moment");
      lines.push("Do not quote verbatim (except anchors). One line max. Never preachy.");
    }
    lines.push("");
  }

  // Profile facts — coaching + meta
  const profileParts: string[] = [];
  if (input.primaryMarket) profileParts.push(`market: ${input.primaryMarket}`);
  if (input.tradingStyle) profileParts.push(`style: ${input.tradingStyle}`);
  if (input.coachingTone) profileParts.push(`preferred tone: ${input.coachingTone}`);

  const ruleParts: string[] = [];
  if (input.maxDailyLoss) ruleParts.push(`max daily loss: ${input.maxDailyLoss}`);
  if (input.maxTradesPerDay) ruleParts.push(`max trades/day: ${input.maxTradesPerDay}`);
  if (input.stopAfterLosses) ruleParts.push(`stop after ${input.stopAfterLosses} consecutive losses`);

  const usageParts: string[] = [];
  if (isMeta) {
    if (input.todayPnL !== 0) usageParts.push(`P&L today: ${input.todayPnL > 0 ? "+" : ""}${input.todayPnL}`);
    if (input.todayTradesCount > 0) usageParts.push(`trades taken today: ${input.todayTradesCount}`);
    if (input.consecutiveLosses > 0) usageParts.push(`consecutive losses: ${input.consecutiveLosses}`);
  }

  if ((isCoaching || isMeta) && (profileParts.length > 0 || ruleParts.length > 0 || usageParts.length > 0)) {
    if (isMeta) {
      lines.push("FACTS (answer only from these):");
      if (ruleParts.length > 0) lines.push(`- Limits: ${ruleParts.join(", ")}`);
      if (usageParts.length > 0) lines.push(`- Current: ${usageParts.join(", ")}`);
      lines.push("");
    } else {
      lines.push("TRADER PROFILE:");
      if (profileParts.length > 0) lines.push(`- ${profileParts.join(", ")}`);
      if (ruleParts.length > 0) lines.push(`- Rules: ${ruleParts.join(", ")}`);
      lines.push("");
    }
  }

  // Known trader patterns — coaching only
  if (isCoaching) {
    const patternParts: string[] = [];
    if (input.primaryChallenge) patternParts.push(`Main challenge (their own words): ${input.primaryChallenge}`);
    if (input.tiltTrigger) patternParts.push(`What triggers their tilt: ${input.tiltTrigger}`);
    if (input.tiltThought) patternParts.push(`The thought that runs when they spiral: "${input.tiltThought}"`);
    if (input.disciplineBreakPattern) patternParts.push(`How their discipline breaks: ${input.disciplineBreakPattern}`);
    if (input.whatHelpsRefocus) patternParts.push(`What helps them refocus: ${input.whatHelpsRefocus}`);

    if (patternParts.length > 0) {
      lines.push("KNOWN PATTERNS (trader told you this about themselves):");
      lines.push(...patternParts.map((p) => `- ${p}`));
      lines.push("When the moment matches one of these, name it accurately — not as a judgment.");
      lines.push("They know it about themselves. Reflect it, don't explain it.");
      if (input.whatHelpsRefocus) {
        lines.push("If they're stuck or in a bad state, you can suggest what they said helps them refocus — once, without lecturing.");
      }
      lines.push("");
    }
  }

  // Session and live state — coaching only
  if (isCoaching) {
    const sessionState = input.sessionEnded ? "ended" : input.sessionStarted ? "active" : "not started";
    const sessionParts: string[] = [`Session: ${sessionState}`];

    if (input.currentState && input.currentState !== "NONE") {
      sessionParts.push(`Trader state: ${input.currentState}`);
    }
    if (input.recentLossStreak > 0) {
      sessionParts.push(`Self-reported loss streak: ${input.recentLossStreak} (not broker-verified)`);
    }

    const m = input.manualSignals;
    if (m && (m.tradeCount > 0 || m.hasRuleBreach)) {
      const parts: string[] = [];
      if (m.tradeCount > 0) parts.push(`${m.tradeCount} trades (self-reported)`);
      if (m.consecutiveLosses > 0) parts.push(`${m.consecutiveLosses} consecutive losses (self-reported)`);
      if (m.hasRuleBreach) parts.push("rule breach logged");
      sessionParts.push(`Manual log: ${parts.join(", ")}`);
    }

    lines.push("SESSION:");
    lines.push(...sessionParts.map((p) => `- ${p}`));
    lines.push("");

    if (input.warningMessages.length > 0) {
      lines.push(`Proximity warnings: ${input.warningMessages.slice(0, 2).join("; ")}`);
      lines.push("");
    }

    // Scenario-specific response patterns
    const state = input.currentState?.toLowerCase() ?? "";
    if (state.includes("fomo")) {
      lines.push("SCENARIO — FOMO:");
      lines.push("  1. Validate the pull without judging it. ('That move was real.')");
      lines.push("  2. Name what's missing or not aligned. ('Your setup isn't there.')");
      lines.push("  3. Redirect to waiting. One line. Not a lecture.");
      lines.push("  Avoid: debating whether they should have taken it.");
    } else if (state.includes("revenge")) {
      lines.push("SCENARIO — REVENGE IMPULSE:");
      lines.push("  1. Name the state directly. One sentence — no hedging.");
      lines.push("  2. One redirect: step away. Not a negotiation.");
      lines.push("  Avoid: explaining why revenge trading is bad. They know.");
    } else if (state.includes("tilt") || state.includes("out_of_control")) {
      lines.push("SCENARIO — TILTED:");
      lines.push("  1. Acknowledge the overwhelm. Short.");
      lines.push("  2. One concrete, physical thing. ('Breathe. Walk away.')");
      lines.push("  3. No trading advice. They need to step away, period.");
    } else if (state.includes("just_took_two_loss")) {
      lines.push("SCENARIO — MULTIPLE LOSSES:");
      lines.push("  1. Acknowledge the weight. Do not minimize.");
      lines.push("  2. Give them permission to stop without making them feel weak.");
      lines.push("  3. One grounding question if it fits. ('What do you need right now?')");
      lines.push("  Avoid: counting losses, planning the next trade, or silver-lining.");
    } else if (state.includes("just_took_loss")) {
      lines.push("SCENARIO — FRESH LOSS:");
      lines.push("  1. Acknowledge it simply. Not dramatically.");
      lines.push("  2. Give them space. Let them decide what's next.");
      lines.push("  3. Optional: one question if it moves them forward.");
      lines.push("  Avoid: immediately redirecting to the next trade.");
    } else if (state.includes("confused")) {
      lines.push("SCENARIO — QUESTIONING PURPOSE:");
      lines.push("  1. Hold the question with them — don't answer it for them.");
      lines.push("  2. Surface their why if available (see personal memory above).");
      lines.push("  3. One forward question to reconnect them to what matters.");
    } else if (state.includes("reset") || state.includes("calm")) {
      lines.push("SCENARIO — RECOVERING / CALM:");
      lines.push("  1. Acknowledge the recovery briefly. One line.");
      lines.push("  2. One forward anchor — what's next, not what was.");
      lines.push("  Avoid: overpraise ('well done for stepping away!')");
    } else if (state.includes("premarket")) {
      lines.push("SCENARIO — PREMARKET / MORNING:");
      lines.push("  1. Warm and grounded. No pressure.");
      lines.push("  2. One anchor to intention or their why.");
      lines.push("  3. Optional: one question to set intention for the day.");
      lines.push("  Avoid: reviewing rules, hyping them up, or using 'ready to trade?'");
    }
  }

  // Hard lockout always surfaces — even in casual/meta/clarification modes.
  // Soft constraints (cooldown, rule violations, news window) only surface in coaching mode.
  const constraints: string[] = [];

  if (input.guardianLocked) {
    const reason = input.lockoutReason ?? "daily limit reached";
    constraints.push(`Account locked for today (${reason}). One sentence — matter-of-fact.`);
  }

  if (isCoaching) {
    if (input.cooldownActive) {
      constraints.push("Trader is in a cooldown period. Stepping away is the right move — say this plainly.");
    }
    if (input.stopAfterLosses && input.recentLossStreak >= input.stopAfterLosses) {
      constraints.push(`Consecutive-loss limit hit (${input.recentLossStreak} of ${input.stopAfterLosses}). Trading stops here — say this clearly, without drama.`);
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
  }

  if (constraints.length > 0) {
    lines.push("");
    lines.push("ACTIVE CONSTRAINTS (always — weave in naturally, do not list or announce):");
    lines.push(...constraints.map((c) => `- ${c}`));
  }

  // Recent session for continuity + anti-repetition.
  // Casual/meta: omit entirely — no stale trading context should bleed through.
  // Clarification: include text only, no state labels.
  // Coaching: include with state labels for full context.
  if (mode !== "casual" && mode !== "meta" && input.recentMessages.length > 0) {
    lines.push("");
    lines.push("Recent session (oldest first) — do not repeat what was already addressed:");
    for (const msg of input.recentMessages) {
      const stateLabel = isCoaching && msg.traderState && msg.traderState !== "NONE"
        ? ` [${msg.traderState}]`
        : "";
      lines.push(`- ${msg.message}${stateLabel}`);
    }
  }

  return lines.join("\n");
}

// ─── Brain helpers — decide intent/cues before writing ──────────────────────

export function deriveCoachingIntent(input: AICoachInput): CoachingIntent {
  // Explicit structured action IDs override state-derived intents
  if (input.actionId === "check-in") return "pre_session_checkin";
  if (input.actionId === "day-summary") return "end_of_day_review";
  if (input.actionId === "rule-limits" || input.actionId === "remaining") return "rule_limits_summary";

  if (input.guardianLocked) return "account_locked";
  if (input.cooldownActive) return "cooldown_active";
  if (input.stopAfterLosses && input.recentLossStreak >= input.stopAfterLosses) return "rule_limit_hit";
  if (input.hasBlockingViolation) return "rule_limit_hit";
  if (input.isPreNewsWindow) return "news_warning";

  const state = input.currentState?.toLowerCase() ?? "";
  if (state.includes("fomo")) return "stop_fomo";
  if (state.includes("revenge")) return "stop_revenge";
  if (state.includes("tilt") || state.includes("out_of_control")) return "ground_tilt";
  if (state.includes("just_took_two_loss")) return "acknowledge_multiple_losses";
  if (state.includes("just_took_loss")) return "acknowledge_loss";
  if (state.includes("confused")) return "surface_purpose";
  if (state.includes("reset") || state.includes("calm")) return "forward_anchor";
  if (state.includes("premarket")) return "morning_anchor";
  if (input.sessionEnded) return "end_of_day";
  return "general_coaching";
}

function derivePersonalCue(intent: CoachingIntent, input: AICoachInput): PersonalCue | null {
  const goalOk = input.wantsGoalReminders;
  switch (intent) {
    case "surface_purpose":
      if (goalOk && input.tradingWhy) return { type: "why", text: input.tradingWhy };
      if (goalOk && input.tradingGoal) return { type: "goal", text: input.tradingGoal };
      return null;
    case "acknowledge_loss":
    case "acknowledge_multiple_losses":
      if (goalOk && input.tradingGoal) return { type: "goal", text: input.tradingGoal };
      if (goalOk && input.tradingWhy) return { type: "why", text: input.tradingWhy };
      return null;
    case "ground_tilt":
    case "stop_revenge":
      if (input.groundingReminder) return { type: "grounding", text: input.groundingReminder };
      if (goalOk && input.tradingGoal) return { type: "goal", text: input.tradingGoal };
      return null;
    case "morning_anchor":
    case "pre_session_checkin":
      if (goalOk && input.tradingWhy) return { type: "why", text: input.tradingWhy };
      if (goalOk && input.tradingGoal) return { type: "goal", text: input.tradingGoal };
      if (input.groundingReminder) return { type: "grounding", text: input.groundingReminder };
      return null;
    case "forward_anchor":
    case "end_of_day":
    case "end_of_day_review":
      if (goalOk && input.tradingGoal) return { type: "goal", text: input.tradingGoal };
      if (goalOk && input.tradingWhy) return { type: "why", text: input.tradingWhy };
      return null;
    default:
      return null;
  }
}

function deriveKnownPattern(input: AICoachInput): string | null {
  const state = input.currentState?.toLowerCase() ?? "";
  const hasTiltOrRevenge =
    state.includes("tilt") || state.includes("out_of_control") || state.includes("revenge");
  const hasLoss = state.includes("just_took_loss") || state.includes("fomo");

  const parts: string[] = [];
  if (input.primaryChallenge) parts.push(input.primaryChallenge);
  if (input.tiltTrigger && hasTiltOrRevenge) parts.push(`Trigger: ${input.tiltTrigger}`);
  if (input.tiltThought && hasTiltOrRevenge) parts.push(`They think: "${input.tiltThought}"`);
  // disciplineBreakPattern: only show for tilt/revenge/loss states — not in calm/premarket
  if (input.disciplineBreakPattern && (hasTiltOrRevenge || hasLoss)) {
    parts.push(`Discipline break pattern: ${input.disciplineBreakPattern}`);
  }
  return parts.length > 0 ? parts.join(" | ") : null;
}

function buildConstraintMessage(input: AICoachInput, intent: CoachingIntent): string | null {
  // Structured flows get context-specific constraint messages
  if (intent === "pre_session_checkin") {
    const parts: string[] = [];
    if (input.maxDailyLoss) parts.push(`max daily loss: $${input.maxDailyLoss}`);
    if (input.maxTradesPerDay) parts.push(`max ${input.maxTradesPerDay} trades`);
    if (input.stopAfterLosses) parts.push(`stop after ${input.stopAfterLosses} consecutive losses`);
    return parts.length > 0 ? `Today's rules: ${parts.join(", ")}` : null;
  }

  if (intent === "rule_limits_summary") {
    const parts: string[] = [];
    if (input.maxDailyLoss) {
      const used = Math.abs(Math.min(input.todayPnL, 0));
      if (used > 0) {
        const pctUsed = Math.round((used / input.maxDailyLoss) * 100);
        const remaining = Math.max(0, input.maxDailyLoss - used);
        parts.push(`Daily loss: $${used.toFixed(2)} used of $${input.maxDailyLoss} limit ($${remaining.toFixed(2)} remaining, ${pctUsed}% used)`);
      } else {
        parts.push(`Daily loss limit: $${input.maxDailyLoss} (none used yet)`);
      }
    }
    if (input.maxTradesPerDay) {
      parts.push(`Trades: ${input.todayTradesCount} of ${input.maxTradesPerDay} taken today`);
    }
    if (input.stopAfterLosses) {
      parts.push(`Consecutive losses: ${input.consecutiveLosses} of ${input.stopAfterLosses} limit`);
    }
    if (parts.length === 0) return "No specific limits configured.";
    return parts.join(". ");
  }

  if (input.guardianLocked) {
    const reason = input.lockoutReason ?? "daily limit reached";
    return `Account locked for today (${reason}).`;
  }
  if (input.cooldownActive) return "Trader is in a cooldown period.";
  if (input.stopAfterLosses && input.recentLossStreak >= input.stopAfterLosses) {
    return `Consecutive-loss limit reached (${input.recentLossStreak} of ${input.stopAfterLosses}).`;
  }
  if (input.hasBlockingViolation && input.violationMessage) return input.violationMessage;
  if (input.isPreNewsWindow && input.preNewsMessage) return input.preNewsMessage;
  if (input.alertContext) return input.alertContext;
  return null;
}

function shouldAskQuestion(intent: CoachingIntent, responseStyle: string | null): boolean {
  if (responseStyle === "Reflective questions") return true;
  if (responseStyle === "One-line prompts") return false;
  const askIntents = new Set<CoachingIntent>([
    "surface_purpose", "acknowledge_loss", "acknowledge_multiple_losses",
    "stop_fomo", "ground_tilt",
    "morning_anchor", "general_coaching", "forward_anchor",
    "pre_session_checkin",  // ends with intention-setting question
    "end_of_day_review",    // structured review always asks questions
  ]);
  return askIntents.has(intent);
}

function buildVoiceWriterInputFromCoachInput(input: AICoachInput): VoiceWriterInput {
  const intent = deriveCoachingIntent(input);
  // Tone override: when wantsToughInterventionWhenTilting and in a critical tilt/revenge state
  const state = input.currentState?.toLowerCase() ?? "";
  const isCriticalState = state.includes("revenge") || state.includes("tilt") || state.includes("out_of_control");
  const effectiveTone = (input.wantsToughInterventionWhenTilting && isCriticalState)
    ? "tough_love"
    : input.coachingTone;

  return {
    intent,
    traderMessage: input.message,
    constraintMessage: buildConstraintMessage(input, intent),
    personalCue: derivePersonalCue(intent, input),
    knownPattern: deriveKnownPattern(input),
    askQuestion: shouldAskQuestion(intent, input.responseStyle),
    language: input.language,
    coachingTone: effectiveTone,
    interruptionStyle: input.interruptionStyle,
    responseStyle: input.responseStyle,
    preferredAddress: input.preferredAddress,
    recentMessages: input.recentMessages,
    recentCoachingExchanges: input.recentCoachingExchanges,
    shortTermCoachingState: deriveShortTermCoachingState(input.recentCoachingExchanges),
    reminderAnchors: input.reminderAnchors,
    disciplineBreakPattern: input.disciplineBreakPattern,
    whatHelpsRefocus: input.whatHelpsRefocus,
    wantsToughIntervention: input.wantsToughInterventionWhenTilting,
  };
}

export function isAICoachEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Emotional quick actions — state-updating, conversationMode → "coaching"
export const EMOTIONAL_ACTION_IDS = new Set([
  "fomo",
  "angry",
  "out-of-control",
  "dragged",
  "revenge",
  "stop-me",
  "back-in-control",
  // Structured flows that want coaching mode
  "check-in",
  "day-summary",
]);

// Structured flows that need AI but use "meta" mode (factual, not emotional)
export const STRUCTURED_COACHING_ACTION_IDS = new Set([
  "rule-limits",
  "remaining",
]);

export function shouldUseAICoach(params: {
  actionId: string | null;
  isFreeText: boolean;
  guardianLocked: boolean;
  hasBlockingViolation: boolean;
  cooldownActive: boolean;
}): boolean {
  if (!isAICoachEnabled()) return false;
  if (params.isFreeText) return true;
  if (params.actionId && (EMOTIONAL_ACTION_IDS.has(params.actionId) || STRUCTURED_COACHING_ACTION_IDS.has(params.actionId))) return true;
  if (params.guardianLocked || params.hasBlockingViolation || params.cooldownActive) return true;
  return false;
}

function buildDirectFactualReply(input: AICoachInput): string | null {
  const intent = deriveCoachingIntent(input);
  if (intent !== "rule_limits_summary") return null;

  const isRemaining = input.actionId === "remaining";

  if (input.language === "he") {
    const parts: string[] = [];

    if (isRemaining) {
      if (input.maxDailyLoss != null) {
        const used = Math.abs(Math.min(input.todayPnL, 0));
        const remaining = Math.max(0, input.maxDailyLoss - used);
        if (used > 0) {
          parts.push(`נשאר לך ${remaining.toFixed(0)}$ להפסד יומי.`);
        } else {
          parts.push(`לא הפסדת עדיין. יש לך ${input.maxDailyLoss}$ מלאים.`);
        }
      }
      if (input.maxTradesPerDay != null) {
        parts.push(`עסקאות: ${input.todayTradesCount} מתוך ${input.maxTradesPerDay}.`);
      }
      if (input.stopAfterLosses != null && input.consecutiveLosses > 0) {
        parts.push(`הפסדות ברצף: ${input.consecutiveLosses} מתוך ${input.stopAfterLosses}.`);
      }
    } else {
      if (input.maxDailyLoss != null) parts.push(`גבול הפסד יומי: ${input.maxDailyLoss}$.`);
      if (input.maxTradesPerDay != null) parts.push(`מקסימום עסקאות: ${input.maxTradesPerDay}.`);
      if (input.stopAfterLosses != null) parts.push(`עצירה אחרי ${input.stopAfterLosses} הפסדות ברצף.`);
    }

    return parts.length > 0 ? parts.join(" ") : "לא הוגדרו גבולות.";
  }

  if (input.language === "en") {
    const parts: string[] = [];

    if (isRemaining) {
      if (input.maxDailyLoss != null) {
        const used = Math.abs(Math.min(input.todayPnL, 0));
        const remaining = Math.max(0, input.maxDailyLoss - used);
        parts.push(used > 0 ? `$${remaining.toFixed(0)} left on daily loss.` : `Full $${input.maxDailyLoss} available — no losses yet.`);
      }
      if (input.maxTradesPerDay != null) {
        parts.push(`Trades: ${input.todayTradesCount} of ${input.maxTradesPerDay}.`);
      }
      if (input.stopAfterLosses != null && input.consecutiveLosses > 0) {
        parts.push(`Consecutive losses: ${input.consecutiveLosses} of ${input.stopAfterLosses}.`);
      }
    } else {
      if (input.maxDailyLoss != null) parts.push(`Daily loss limit: $${input.maxDailyLoss}.`);
      if (input.maxTradesPerDay != null) parts.push(`Max trades: ${input.maxTradesPerDay}.`);
      if (input.stopAfterLosses != null) parts.push(`Stop after ${input.stopAfterLosses} consecutive losses.`);
    }

    return parts.length > 0 ? parts.join(" ") : "No limits configured.";
  }

  // Other languages: fall through to AI
  return null;
}

export async function generateAICoachReply(
  input: AICoachInput,
): Promise<string | null> {
  if (!isAICoachEnabled()) return null;

  // Coaching mode → dedicated voice writer (brain/voice split)
  if (input.conversationMode === "coaching") {
    return generateVoiceReply(buildVoiceWriterInputFromCoachInput(input));
  }

  // Meta mode (rule-limits / remaining) → bypass AI; format directly in TypeScript
  if (input.conversationMode === "meta") {
    const direct = buildDirectFactualReply(input);
    if (direct) return direct;
  }

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

// ─── Morning check-in system ────────────────────────────────────────────────

export type MorningCheckInInput = {
  language: string;
  coachingTone: string | null;
  preferredAddress: string | null;
  tradingWhy: string | null;
  tradingGoal: string | null;
  groundingReminder: string | null;
  primaryChallenge: string | null;
  primaryMarket: string | null;
  tradingStyle: string | null;
  yesterdayHadSession: boolean;
  yesterdayFinalState: string | null;
  checkinFormat: string | null;
};

function buildYesterdayStateContext(state: string | null): string | null {
  if (!state || state === "NONE") return null;
  const s = state.toLowerCase();
  if (s.includes("revenge") || s.includes("tilt")) return "Trader finished yesterday in a difficult emotional state.";
  if (s.includes("just_took_two_loss")) return "Trader ended yesterday after multiple losses.";
  if (s.includes("just_took_loss")) return "Trader ended yesterday after a loss.";
  if (s.includes("fomo")) return "Trader was feeling FOMO at end of yesterday's session.";
  if (s.includes("calm") || s.includes("reset")) return "Trader ended yesterday in a calm, recovered state.";
  return null;
}

function buildMorningCheckInPrompt(input: MorningCheckInInput): string {
  const langName = LANGUAGE_NAMES[input.language] ?? "English";
  const isDirect = input.coachingTone?.toLowerCase().includes("direct") ?? false;
  const isSupportive = input.coachingTone?.toLowerCase().includes("support") ?? false;

  const lines: string[] = [
    `You are a human coach who works with traders. Write ONLY in ${langName}.`,
    "",
    "TASK: Write a short proactive morning message to a trader starting their day.",
    "",
    "FORMAT:",
    isDirect
      ? "- 1-2 sentences. Direct. Lead with energy or a sharp grounding anchor."
      : isSupportive
        ? "- 2-3 sentences. Warm but grounded. Not sentimental."
        : "- 1-2 sentences. Human. Like a friend checking in before the session.",
    "- Optional: one brief open question to anchor their intention for today.",
    "- Do NOT use exclamation marks unless the language naturally requires them.",
    "- Do NOT open with 'Good morning' or any formulaic greeting.",
    "- Do NOT coach or give advice. This is a check-in, not a lecture.",
    "- Never mention rules, limits, risk, or discipline.",
    "- Sound like a human, not a bot.",
    "",
  ];

  const addressGuidance = buildAddressGuidance(input.preferredAddress, input.language);
  if (addressGuidance) {
    lines.push(addressGuidance);
    lines.push("");
  }

  if (input.yesterdayHadSession) {
    const stateContext = buildYesterdayStateContext(input.yesterdayFinalState);
    if (stateContext) {
      lines.push(`YESTERDAY'S CONTEXT: ${stateContext}`);
      lines.push("Reference this briefly only if it would feel natural and grounding — never force it.");
      lines.push("");
    }
  }

  const personalParts: string[] = [];
  if (input.tradingWhy) personalParts.push(`Why they trade: ${input.tradingWhy}`);
  if (input.tradingGoal) personalParts.push(`Building toward: ${input.tradingGoal}`);
  if (input.groundingReminder) personalParts.push(`What grounds them: ${input.groundingReminder}`);

  if (personalParts.length > 0) {
    lines.push("PERSONAL COACHING MEMORY (weave in naturally only if it would feel genuine):");
    lines.push(...personalParts.map((p) => `- ${p}`));
    lines.push("Do not quote verbatim. One line max.");
    lines.push("");
  }

  lines.push(...buildLanguageCasualNote(input.language));

  lines.push("NEVER:");
  lines.push('- "Good morning, [name]" or any formulaic greeting');
  lines.push('- "Are you ready to trade today?" — too generic');
  lines.push("- Mention of rules, limits, risk, or discipline");
  lines.push("- Bullet points, lists, or headers");
  lines.push('- "As your coach..."');
  lines.push("");

  lines.push("SCENARIO PATTERN — MORNING CHECK-IN:");
  lines.push("  1. Brief warm opener (optional, not always needed)");
  lines.push("  2. One anchor to their intention, their why, or yesterday's context");
  lines.push("  3. One open question to set intention (optional)");

  return lines.join("\n");
}

export async function generateMorningCheckIn(input: MorningCheckInInput): Promise<string | null> {
  if (!isAICoachEnabled()) return null;

  const client = new Anthropic();

  try {
    const response = await client.messages.create(
      {
        model: "claude-haiku-4-5",
        max_tokens: 100,
        system: [
          {
            type: "text",
            text: buildMorningCheckInPrompt(input),
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: "Send the morning message." }],
      },
      { timeout: 12_000 },
    );

    const block = response.content[0];
    return block?.type === "text" ? block.text.trim() : null;
  } catch (err) {
    console.error("[ai-coach] generateMorningCheckIn failed:", err);
    return null;
  }
}
