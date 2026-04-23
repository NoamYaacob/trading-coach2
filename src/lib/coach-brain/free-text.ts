import Anthropic from "@anthropic-ai/sdk";
import type { CoachBrainInput, CoachBrainOutput } from "./types";

// Upgrade to "claude-opus-4-7" for higher quality
const FREE_TEXT_MODEL = "claude-haiku-4-5";
const FREE_TEXT_MAX_TOKENS = 200;

const LANGUAGE_NAMES: Record<string, string> = {
  he: "Hebrew",
  en: "English",
};

function buildFreeTextPrompt(input: CoachBrainInput): string {
  const langName = LANGUAGE_NAMES[input.language] ?? "English";
  const lines: string[] = [
    `You are a human coach. Write ONLY in ${langName}.`,
    "",
    "SITUATION: General coaching conversation — trader is calm or in a neutral state.",
    "",
    "YOUR JOB: Respond to the trader's message naturally. One clean move: observe, question, anchor, or point forward.",
    "",
    "VOICE: Direct, grounded mentor. Not a therapist. Not a chatbot. Short sentences.",
    "",
  ];

  // Alert context (rule-engine / broker alert)
  if (input.alertContext) {
    lines.push(`CONTEXT (use if relevant, don't announce): ${input.alertContext}`);
    lines.push("");
  }

  // Blocking constraint
  const constraint =
    input.lockoutReason ??
    (input.hasBlockingViolation ? input.violationMessage : null) ??
    (input.cooldownActive ? "Trader is in a cooldown." : null);
  if (constraint) {
    lines.push(`CONSTRAINT (weave in naturally, do not list): ${constraint}`);
    lines.push("");
  }

  // Personal anchors
  if (input.reminderAnchors.length > 0) {
    lines.push(
      `PERSONAL ANCHORS (echo verbatim once, only when it genuinely fits): ${input.reminderAnchors.map((a) => `"${a}"`).join(" · ")}`,
    );
    lines.push("");
  }

  // Coaching tone
  if (input.coachingTone) {
    lines.push(`TONE: ${input.coachingTone}`);
    lines.push("CRITICAL: The user may change their preferred tone over time. ALWAYS follow the CURRENT profile settings above, even if your past responses in the conversation history used a different tone.");
    lines.push("");
  }

  lines.push(
    "REPLY STYLE:",
    "- 1-2 sentences. 3 is the hard maximum.",
    "- Lead with the point. Nothing before it.",
    "",
    "NEVER:",
    "- Explain your reasoning — just say the thing.",
    '- Open with "As your coach", "I understand that", "It sounds like".',
    '- Close with "You\'ve got this", "Keep going", or any generic encouragement.',
    "- Bullet points or lists.",
    "- Ask more than one question.",
    "",
  );

  // Hebrew spoken register
  if (input.language === "he") {
    lines.push(
      "HEBREW VOICE:",
      "Israeli mentor. Spoken, not written. Short. Direct.",
      "",
      "SPOKEN REGISTER:",
      "  1. Drop the subject when obvious.",
      "  2. Juxtapose — no אבל/לכן.",
      "  3. Don't explain the mechanism. State the consequence.",
      "  4. Ultra-short is fine.",
      "",
    );
  }

  lines.push(
    `LANGUAGE REMINDER: Write ONLY in ${langName}. Context above may be in English — your reply must be in ${langName}.`,
  );

  return lines.join("\n");
}

export async function generateFreeTextReply(input: CoachBrainInput): Promise<CoachBrainOutput> {
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (const ex of input.recentContext) {
    messages.push({ role: "user", content: ex.userMessage });
    messages.push({ role: "assistant", content: ex.coachReply });
  }
  messages.push({ role: "user", content: input.message });

  const client = new Anthropic();
  const response = await client.messages.create({
    model: FREE_TEXT_MODEL,
    max_tokens: FREE_TEXT_MAX_TOKENS,
    system: buildFreeTextPrompt(input),
    messages,
  });

  const reply =
    response.content[0]?.type === "text" ? response.content[0].text.trim() : "";

  return {
    reply,
    mode: "free_text",
    language: input.language,
    source: "model",
    model: FREE_TEXT_MODEL,
    coachingMove: "general",
  };
}
