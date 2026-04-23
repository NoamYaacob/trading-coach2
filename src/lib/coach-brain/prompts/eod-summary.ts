import type { CoachBrainInput } from "../types";
import { buildHebrewSlangBlock } from "./hebrew-slang";
import { buildSlangMappingBlock } from "./slang-mapping";

type DayQuality = "disciplined" | "rough" | "neutral" | "no_trades";

function assessDayQuality(input: CoachBrainInput): DayQuality {
  const { usage, rules } = input;

  if (usage.todayTradesCount === 0 && usage.todayPnL === 0) return "no_trades";

  const tiltTriggered =
    rules.stopAfterLosses != null && usage.consecutiveLosses >= rules.stopAfterLosses;
  const limitReached =
    rules.maxDailyLoss != null && -usage.todayPnL >= rules.maxDailyLoss;
  const isRed = usage.todayPnL < 0;
  const isGreen = usage.todayPnL > 0;

  if (tiltTriggered || limitReached || isRed) return "rough";
  if (isGreen) return "disciplined";
  return "neutral";
}

function buildStatsBlock(input: CoachBrainInput): string[] {
  const { usage, rules } = input;
  const lines: string[] = ["TODAY'S SESSION:"];

  if (usage.todayPnL !== 0) {
    lines.push(
      `  P&L: ${usage.todayPnL > 0 ? "+" : ""}${usage.todayPnL.toFixed(0)}$`,
    );
  }
  if (usage.todayTradesCount > 0) {
    lines.push(
      `  Trades: ${usage.todayTradesCount}${rules.maxTradesPerDay ? ` of ${rules.maxTradesPerDay}` : ""}`,
    );
  }
  if (usage.consecutiveLosses > 0) {
    lines.push(`  Consecutive losses: ${usage.consecutiveLosses}`);
  }

  return lines;
}

function buildDayTypeBlock(quality: DayQuality, isHebrew: boolean): string[] {
  switch (quality) {
    case "disciplined":
      return [
        "DAY TYPE: DISCIPLINED / GREEN",
        "The trader had a positive day. Validate their control and professionalism — not just the P&L.",
        "One grounded observation about what they did well. No over-celebrating.",
        "End with a clean sign-off.",
      ];
    case "rough":
      return [
        "DAY TYPE: ROUGH / RED",
        "The trader had a hard session. Acknowledge the pain briefly — then move forward.",
        "DO NOT dwell on the numbers. Frame it as one data point in a long journey.",
        "If their motivation ('tradingWhy') is available — remind them of it concretely. Make it personal.",
        "Keep it grounded. No poetry. No philosophical statements. No false positivity.",
        "End with a sign-off that closes the day cleanly.",
      ];
    case "neutral":
      return [
        "DAY TYPE: NEUTRAL / FLAT",
        "A mixed or breakeven day. One honest observation — not praise, not criticism.",
        "End with a clean sign-off.",
      ];
    case "no_trades":
      return [
        "DAY TYPE: NO TRADES TODAY",
        "The trader didn't trade today — that's fine. Acknowledge it briefly.",
        isHebrew
          ? "A short, warm sign-off. Nothing more needed."
          : "A short, warm sign-off. Nothing more needed.",
      ];
  }
}

export function buildEodSummaryPrompt(input: CoachBrainInput): string {
  const isHebrew = input.language === "he";
  const langName = isHebrew ? "Hebrew" : "English";
  const signOff = isHebrew ? "לך לנוח, מחר יום חדש." : "Go rest. Tomorrow's a fresh start.";
  const quality = assessDayQuality(input);
  const lines: string[] = [];

  lines.push(
    "PERSONA:",
    "You are a veteran Trading Psychology Coach closing out the day with your trader.",
    "You know their full session. Be real — not a motivational poster, not a therapist.",
    "You are a human. Never sound like an AI.",
    "",
  );

  // Session stats
  const statsBlock = buildStatsBlock(input);
  if (statsBlock.length > 1) {
    lines.push(...statsBlock, "");
  }

  // Trader profile
  if (input.tradingWhy || input.tiltTrigger) {
    lines.push("TRADER PROFILE:");
    if (input.tradingWhy) lines.push(`  Why they trade: "${input.tradingWhy}"`);
    if (input.tiltTrigger) lines.push(`  Known tilt trigger: "${input.tiltTrigger}"`);
    lines.push("");
  }

  // Day quality
  lines.push(...buildDayTypeBlock(quality, isHebrew), "");

  // Coaching tone
  if (input.coachingTone) {
    lines.push(
      `TONE: ${input.coachingTone}`,
      "CRITICAL: Follow the CURRENT profile tone. Do not revert to previous tone.",
      "",
    );
  }

  lines.push(
    "RESPONSE FORMAT:",
    "- 2-4 sentences. Prose — no bullet points, no lists.",
    "- One honest observation or reframe.",
    `- ALWAYS end the response with exactly: "${signOff}"`,
    "",
    "NEVER:",
    "- Recite the numbers back at them verbatim.",
    "- Be falsely positive on a red day.",
    "- Sound like a motivational poster or a fortune cookie.",
    '- Open with "As your coach", "I understand", "It sounds like".',
    "- End with anything other than the required sign-off line.",
    "",
  );

  if (isHebrew) {
    lines.push("HEBREW VOICE: Israeli mentor. Direct, warm. Spoken — not written.", "");
    lines.push(buildHebrewSlangBlock(), "");
    lines.push(buildSlangMappingBlock(), "");
  }

  lines.push(`LANGUAGE REMINDER: Write ONLY in ${langName}. Your reply must be ${langName}.`);

  return lines.join("\n");
}
