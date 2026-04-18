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

export type AICoachInput = {
  message: string;
  language: string;
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
};

function buildSystemPrompt(input: AICoachInput): string {
  const langName = LANGUAGE_NAMES[input.language] ?? "English";

  const lines: string[] = [
    `You are a trading coach. Respond ONLY in ${langName}. Maximum 2-3 sentences. Sound human, direct, empathetic — not robotic. No bullet points. No "As your coach..." openings.`,
    "",
  ];

  const constraints: string[] = [];

  if (input.guardianLocked) {
    const reason = input.lockoutReason ?? "trading limit reached";
    constraints.push(
      `HARD STOP: Guardian locked trading today (${reason}). Tell the trader firmly: no more trades today. Be direct but not harsh.`,
    );
  }

  if (input.cooldownActive) {
    constraints.push(
      "Trader is in an active cooldown. Reinforce: do not trade right now.",
    );
  }

  if (
    input.stopAfterLosses &&
    input.recentLossStreak >= input.stopAfterLosses
  ) {
    constraints.push(
      `Trader hit their consecutive-loss rule (${input.recentLossStreak} losses, limit ${input.stopAfterLosses}). Enforce the stop firmly.`,
    );
  }

  if (input.hasBlockingViolation && input.violationMessage) {
    constraints.push(`Active rule violation: ${input.violationMessage}`);
  }

  if (input.isPreNewsWindow && input.preNewsMessage) {
    constraints.push(`Economic event warning active: ${input.preNewsMessage}`);
  }

  if (constraints.length > 0) {
    lines.push("ENFORCE THESE CONSTRAINTS:");
    lines.push(...constraints.map((c) => `- ${c}`));
    lines.push("");
  }

  const sessionState = input.sessionEnded
    ? "ended"
    : input.sessionStarted
      ? "active"
      : "not started";
  lines.push(`Session: ${sessionState} (${input.todaySessionStateKind})`);

  const profileParts: string[] = [];
  if (input.primaryMarket) profileParts.push(`market: ${input.primaryMarket}`);
  if (input.tradingStyle) profileParts.push(`style: ${input.tradingStyle}`);
  if (input.coachingTone) profileParts.push(`tone: ${input.coachingTone}`);
  if (profileParts.length > 0) lines.push(`Trader: ${profileParts.join(", ")}`);

  const ruleParts: string[] = [];
  if (input.maxDailyLoss) ruleParts.push(`max daily loss: ${input.maxDailyLoss}`);
  if (input.maxTradesPerDay) ruleParts.push(`max trades/day: ${input.maxTradesPerDay}`);
  if (input.stopAfterLosses) ruleParts.push(`stop after: ${input.stopAfterLosses} losses`);
  if (ruleParts.length > 0) lines.push(`Rules: ${ruleParts.join(", ")}`);

  lines.push(`State: ${input.currentState}, loss streak: ${input.recentLossStreak}`);

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

  return lines.join("\n");
}

const client = new Anthropic();

export async function generateAICoachReply(
  input: AICoachInput,
): Promise<string | null> {
  try {
    const response = await client.messages.create(
      {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 150,
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
  } catch {
    return null;
  }
}
