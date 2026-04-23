import type { CoachBrainInput } from "../types";
import { buildHebrewSlangBlock } from "./hebrew-slang";
import { buildSlangMappingBlock } from "./slang-mapping";

// ─── Day breakdown ────────────────────────────────────────────────────────────

type DayGrade = "disciplined" | "rough" | "mixed" | "no_trades";

type DayBreakdown = {
  grade: DayGrade;
  lossUsed: number;
  lossUsedPct: number;
  tiltTriggered: boolean;
  dailyLimitHit: boolean;
  maxTradesHit: boolean;
  wasLocked: boolean;
};

function breakdownDay(input: CoachBrainInput): DayBreakdown {
  const { usage, rules } = input;
  const lossUsed = Math.max(0, -usage.todayPnL);
  const lossUsedPct =
    rules.maxDailyLoss && lossUsed > 0
      ? Math.round((lossUsed / rules.maxDailyLoss) * 100)
      : 0;

  const tiltTriggered =
    (rules.stopAfterLosses != null && usage.consecutiveLosses >= rules.stopAfterLosses) ||
    input.lockoutReason === "CONSECUTIVE_LOSSES";

  const dailyLimitHit =
    (rules.maxDailyLoss != null && lossUsed >= rules.maxDailyLoss) ||
    input.lockoutReason === "MAX_DAILY_LOSS";

  const maxTradesHit =
    (rules.maxTradesPerDay != null && usage.todayTradesCount >= rules.maxTradesPerDay) ||
    input.lockoutReason === "MAX_TRADES_PER_DAY";

  const wasLocked = input.guardianLocked || input.lockoutReason != null;

  if (usage.todayTradesCount === 0 && usage.todayPnL === 0) {
    return {
      grade: "no_trades",
      lossUsed, lossUsedPct, tiltTriggered, dailyLimitHit, maxTradesHit, wasLocked,
    };
  }

  const anyRuleBroken = tiltTriggered || dailyLimitHit || maxTradesHit;
  const isGreen = usage.todayPnL > 0;
  const isRed = usage.todayPnL < 0;

  let grade: DayGrade;
  if (!anyRuleBroken && isGreen) {
    grade = "disciplined";
  } else if (anyRuleBroken || (isRed && lossUsedPct >= 75)) {
    grade = "rough";
  } else {
    grade = "mixed";
  }

  return { grade, lossUsed, lossUsedPct, tiltTriggered, dailyLimitHit, maxTradesHit, wasLocked };
}

// ─── Hard data block ──────────────────────────────────────────────────────────

function buildHardDataBlock(input: CoachBrainInput, bd: DayBreakdown): string[] {
  const { usage, rules } = input;
  const lines: string[] = ["HARD DATA — ground the 3-part summary in these facts:"];

  if (usage.todayTradesCount === 0 && usage.todayPnL === 0) {
    lines.push("  No trades today.");
    return lines;
  }

  if (usage.todayPnL > 0) {
    lines.push(`  P&L: +$${usage.todayPnL.toFixed(0)}  ✓ green`);
  } else if (usage.todayPnL < 0) {
    lines.push(`  P&L: -$${Math.abs(usage.todayPnL).toFixed(0)}  ✗ red`);
  } else {
    lines.push("  P&L: $0 (breakeven)");
  }

  if (usage.todayTradesCount > 0) {
    const cap = rules.maxTradesPerDay ? ` / ${rules.maxTradesPerDay} limit` : "";
    const flag = bd.maxTradesHit ? " ⚠ LIMIT HIT" : "";
    lines.push(`  Trades: ${usage.todayTradesCount}${cap}${flag}`);
  }

  if (rules.maxDailyLoss && bd.lossUsed > 0) {
    const flag = bd.dailyLimitHit
      ? " ⚠ LIMIT HIT"
      : bd.lossUsedPct >= 75
        ? " ⚠ CLOSE TO LIMIT"
        : "";
    lines.push(
      `  Daily loss: $${bd.lossUsed.toFixed(0)} of $${rules.maxDailyLoss.toFixed(0)} (${bd.lossUsedPct}%)${flag}`,
    );
  }

  if (usage.consecutiveLosses > 0) {
    const cap = rules.stopAfterLosses ? ` / ${rules.stopAfterLosses} limit` : "";
    const flag = bd.tiltTriggered ? " ⚠ TILT TRIGGER HIT" : "";
    lines.push(`  Consecutive losses: ${usage.consecutiveLosses}${cap}${flag}`);
  }

  if (bd.wasLocked && input.lockoutReason) {
    lines.push(
      `  Guardian lock: YES — ${input.lockoutReason.replace(/_/g, " ").toLowerCase()}`,
    );
  }

  if (input.violationMessage && !bd.wasLocked) {
    lines.push(`  Active violation: ${input.violationMessage}`);
  }

  lines.push(`  Day grade: ${bd.grade.toUpperCase()}`);

  return lines;
}

// ─── Mental grade instructions ────────────────────────────────────────────────

function buildMentalGradeBlock(input: CoachBrainInput, bd: DayBreakdown): string[] {
  const lines: string[] = [
    "PART 2 — THE MENTAL GRADE (2-3 sentences):",
    "  Reflect on their discipline today. Base it on the hard data above and the chat history.",
  ];

  if (bd.grade === "disciplined") {
    lines.push(
      "  They had a disciplined session. Validate their control — specifically.",
      "  Name WHAT they did right: stayed within limits, followed the plan, respected their rules.",
      "  Not a generic 'great job' — name the actual behavior. Warm but grounded.",
    );
  } else if (bd.grade === "rough") {
    lines.push("  They had a rough session. Name exactly what happened, without lecturing:");
    if (bd.tiltTriggered) {
      const triggerDetail = input.tiltTrigger
        ? ` (their known trigger: "${input.tiltTrigger}")`
        : "";
      lines.push(
        `  → Tilt trigger hit: ${input.usage.consecutiveLosses} consecutive losses${triggerDetail}.`,
      );
    }
    if (bd.dailyLimitHit) {
      lines.push(`  → Daily loss limit reached ($${bd.lossUsed.toFixed(0)}).`);
    }
    if (bd.maxTradesHit) {
      lines.push(`  → Trade count limit hit (${input.usage.todayTradesCount} trades).`);
    }
    lines.push(
      "  One sentence: what happened factually.",
      "  One sentence: what they can take from it. Don't soften — don't dramatize.",
    );
  } else if (bd.grade === "mixed") {
    lines.push(
      "  Mixed session. One honest observation — no praise, no blame.",
      "  If they took losses but stayed within limits: acknowledge the discipline.",
      "  If they came close to a limit: note it plainly.",
    );
  } else {
    lines.push(
      "  No trades today. A pass day — valid decision.",
      "  Acknowledge it in one sentence and move on.",
    );
  }

  return lines;
}

// ─── Big picture instructions ─────────────────────────────────────────────────

function buildBigPictureBlock(input: CoachBrainInput, bd: DayBreakdown): string[] {
  const lines: string[] = ["PART 3 — THE BIG PICTURE (1-2 sentences):"];

  if (input.tradingWhy) {
    if (bd.grade === "disciplined") {
      lines.push(
        `  Reinforce the link to why they trade: "${input.tradingWhy}".`,
        "  This kind of disciplined day is exactly what builds toward that goal. Say it concretely.",
      );
    } else if (bd.grade === "rough") {
      lines.push(
        `  Remind them of why they trade: "${input.tradingWhy}". Make it personal, not generic.`,
        "  One bad day is one data point — the goal doesn't disappear. Frame it, don't preach it.",
      );
    } else {
      lines.push(
        `  Connect briefly to their motivation: "${input.tradingWhy}".`,
        "  Keep it real — not a pep talk. One grounding sentence.",
      );
    }
  } else {
    lines.push(
      "  One grounding forward-looking thought.",
      "  Concrete. Not 'you've got this'. Something real a mentor would say.",
    );
  }

  return lines;
}

// ─── Main prompt builder ──────────────────────────────────────────────────────

export function buildEodSummaryPrompt(input: CoachBrainInput): string {
  const isHebrew = input.language === "he";
  const langName = isHebrew ? "Hebrew" : "English";
  const signOffOptions = isHebrew
    ? '"לך לנוח, מחר יום חדש." or "לילה טוב אחי."'
    : '"Go rest. Tomorrow\'s a fresh start." or "Good night."';
  const isBullets = input.responseStyle === "Short bullets";

  const bd = breakdownDay(input);
  const lines: string[] = [];

  lines.push(
    "PERSONA:",
    "Veteran Trading Psychology Coach. End-of-day wrap-up with your trader.",
    "You've seen their whole session and chat history. Be real, grounded, and human.",
    "Not a motivational poster. Not a bank statement. A mentor who tells the truth.",
    "",
  );

  lines.push(...buildHardDataBlock(input, bd), "");

  if (input.tradingWhy || input.tiltTrigger) {
    lines.push("TRADER PROFILE:");
    if (input.tradingWhy) lines.push(`  Why they trade: "${input.tradingWhy}"`);
    if (input.tiltTrigger) lines.push(`  Known tilt trigger: "${input.tiltTrigger}"`);
    lines.push("");
  }

  lines.push("LANGUAGE & TONE:");
  if (input.coachingTone) {
    lines.push(`• Coaching tone: ${input.coachingTone}`);
  }
  lines.push(
    "• CRITICAL: The user may change their preferred tone over time. ALWAYS follow the CURRENT profile settings above, even if your past responses in the conversation history used a different tone.",
  );
  if (input.preferredAddress) {
    lines.push(`• Address them as: "${input.preferredAddress}"`);
  }
  if (input.responseStyle) {
    lines.push(`• Response style: ${input.responseStyle}`);
    if (isBullets) {
      lines.push("  → For Short bullets: open with one sharp line, then 2-3 punchy bullet points (•), close with one forward-looking line.");
    }
  }
  lines.push("");

  if (input.reminderAnchors.length > 0) {
    lines.push(
      `PERSONAL ANCHORS (echo once if it fits naturally): ${input.reminderAnchors.map((a) => `"${a}"`).join(" · ")}`,
      "",
    );
  }

  lines.push(
    "YOUR TASK — write one flowing message with 3 parts (no headers, no bullets in the reply):",
    "",
    "PART 1 — THE NUMBERS (1-2 sentences, casual):",
    "  State the hard facts in plain, natural language. NOT a bank statement.",
    isHebrew
      ? '  Example: "סיימת עם 4 עסקאות היום, יצא +$120." or "שלושה הפסדים ברצף, -$200 על היום."'
      : '  Example: "Four trades today, ended +$120." or "Three losses back to back, -$200."',
    "",
    ...buildMentalGradeBlock(input, bd),
    "",
    ...buildBigPictureBlock(input, bd),
    "",
    `SIGN-OFF — close with exactly one of: ${signOffOptions}`,
    "",
    "FORMAT:",
    "- Flowing prose. The 3 parts blend naturally — do NOT write headers like 'Part 1' or 'The Numbers'.",
    "- Under 120 words total.",
    "",
    "NEVER:",
    "- Recite the raw numbers robotically like a statement.",
    isHebrew
      ? '- Say "כל הכבוד!" on a rough day.'
      : '- Say "Great job!" on a rough day.',
    "- Sound like a motivational poster or a translated fortune cookie.",
    '- Open with "As your coach", "I understand", "It sounds like".',
    "- End with anything other than the required sign-off.",
    "",
  );

  if (isHebrew) {
    lines.push("HEBREW VOICE: Israeli mentor. Direct, warm. Spoken — not written.", "");
    lines.push(buildHebrewSlangBlock(), "");
    lines.push(buildSlangMappingBlock(), "");
  }

  lines.push(`LANGUAGE REMINDER: Write ONLY in ${langName}.`);

  return lines.join("\n");
}
