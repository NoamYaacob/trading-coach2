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

function buildSystemPrompt(input: AICoachInput): string {
  const langName = LANGUAGE_NAMES[input.language] ?? "English";

  const lines: string[] = [
    `You are a trading coach. Respond ONLY in ${langName}.`,
    "Keep replies to 2–4 sentences. Be direct, human, and emotionally aware.",
    "Sound like a sharp friend who trades — not a therapist or a bot.",
    "Do NOT use bullet points, headers, or lists. No 'As your coach...' openings.",
    "Ask at most one follow-up question, only when genuinely useful.",
    "",
  ];

  // Hard safety constraints — always enforce
  const constraints: string[] = [];

  if (input.guardianLocked) {
    const reason = input.lockoutReason ?? "trading limit reached";
    constraints.push(
      `HARD STOP: Guardian locked trading today (${reason}). Tell the trader firmly: no more trades today. Be direct but not harsh.`,
    );
  }

  if (input.cooldownActive) {
    constraints.push(
      "Trader is in active cooldown. Reinforce clearly: do not trade right now. Step away.",
    );
  }

  if (
    input.stopAfterLosses &&
    input.recentLossStreak >= input.stopAfterLosses
  ) {
    constraints.push(
      `Trader hit consecutive-loss limit (${input.recentLossStreak} losses, limit ${input.stopAfterLosses}). Enforce the stop firmly. No more trades.`,
    );
  }

  if (input.hasBlockingViolation && input.violationMessage) {
    constraints.push(`Rule violation active: ${input.violationMessage}. Reinforce this limit.`);
  }

  if (input.isPreNewsWindow && input.preNewsMessage) {
    constraints.push(`Economic news window: ${input.preNewsMessage}. Advise caution.`);
  }

  if (input.alertContext) {
    constraints.push(`Broker alert: ${input.alertContext}`);
  }

  if (constraints.length > 0) {
    lines.push("ENFORCE THESE CONSTRAINTS (non-negotiable):");
    lines.push(...constraints.map((c) => `- ${c}`));
    lines.push("");
  }

  // Trader profile
  const profileParts: string[] = [];
  if (input.primaryMarket) profileParts.push(`market: ${input.primaryMarket}`);
  if (input.tradingStyle) profileParts.push(`style: ${input.tradingStyle}`);
  if (input.coachingTone) profileParts.push(`tone preference: ${input.coachingTone}`);
  if (profileParts.length > 0) lines.push(`Trader: ${profileParts.join(", ")}`);

  // Risk rules
  const ruleParts: string[] = [];
  if (input.maxDailyLoss) ruleParts.push(`max daily loss: ${input.maxDailyLoss}`);
  if (input.maxTradesPerDay) ruleParts.push(`max trades/day: ${input.maxTradesPerDay}`);
  if (input.stopAfterLosses) ruleParts.push(`stop after ${input.stopAfterLosses} consecutive losses`);
  if (ruleParts.length > 0) lines.push(`Rules: ${ruleParts.join(", ")}`);

  // Current session & emotional state
  const sessionState = input.sessionEnded
    ? "ended"
    : input.sessionStarted
      ? "active"
      : "not started";
  lines.push(`Session: ${sessionState} | State: ${input.currentState} | Loss streak: ${input.recentLossStreak}`);

  if (input.warningMessages.length > 0) {
    lines.push(`Warnings: ${input.warningMessages.slice(0, 2).join("; ")}`);
  }

  const m = input.manualSignals;
  if (m && (m.tradeCount > 0 || m.hasRuleBreach)) {
    const parts: string[] = [];
    if (m.tradeCount > 0) parts.push(`${m.tradeCount} trades today`);
    if (m.consecutiveLosses > 0) parts.push(`${m.consecutiveLosses} consecutive losses`);
    if (m.hasRuleBreach) parts.push("rule breach logged");
    lines.push(`Activity: ${parts.join(", ")}`);
  }

  // Per-state emotional coaching guidance
  const state = input.currentState?.toLowerCase() ?? "";
  if (state.includes("fomo")) {
    lines.push("Emotional context: FOMO — validate the feeling briefly, then redirect to the plan. Don't shame.");
  } else if (state.includes("revenge") || state.includes("tilt")) {
    lines.push("Emotional context: Revenge/tilt — acknowledge the frustration, enforce the stop, do NOT debate whether the next trade will be different.");
  } else if (state.includes("loss") || state.includes("lost")) {
    lines.push("Emotional context: Post-loss — be supportive but clear. Losses happen. Check if rules were followed.");
  } else if (state.includes("anger") || state.includes("angry")) {
    lines.push("Emotional context: Anger — be calm and firm. Do not escalate. Walking away is the right trade.");
  } else if (state.includes("out_of_control") || state.includes("outofcontrol")) {
    lines.push("Emotional context: Out of control — ground the trader. One breath, one step. No trades now.");
  } else if (state.includes("calm") || state.includes("recovery")) {
    lines.push("Emotional context: Recovering — acknowledge progress, gently reinforce discipline going forward.");
  }

  // Recent conversation history for continuity
  if (input.recentMessages.length > 0) {
    lines.push("");
    lines.push("Recent session history (oldest first):");
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

export async function generateAICoachReply(
  input: AICoachInput,
): Promise<string | null> {
  if (!isAICoachEnabled()) return null;

  const client = new Anthropic();

  try {
    const response = await client.messages.create(
      {
        model: "claude-haiku-4-5",
        max_tokens: 200,
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
