import Anthropic from "@anthropic-ai/sdk";
import type { CoachBrainInput, CoachBrainOutput } from "./types";
import { buildHebrewReflectivePrompt, type ReflectiveIntent } from "./prompts/reflective.he";
import { buildEnglishReflectivePrompt } from "./prompts/reflective.en";

// Upgrade to "claude-opus-4-7" for higher quality
const REFLECTIVE_MODEL = "claude-haiku-4-5";
const REFLECTIVE_MAX_TOKENS = 200;

function deriveReflectiveIntent(input: CoachBrainInput): ReflectiveIntent {
  const { actionId, sessionEnded } = input;

  switch (actionId) {
    case "day-summary":
      return "day_summary";
    case "check-in":
      return "check_in";
    case "back-in-control":
      return "back_in_control";
  }

  if (sessionEnded) return "session_end";

  return "general_reflective";
}

function buildReflectivePrompt(input: CoachBrainInput): string {
  const intent = deriveReflectiveIntent(input);
  return input.language === "he"
    ? buildHebrewReflectivePrompt(input, intent)
    : buildEnglishReflectivePrompt(input, intent);
}

export async function generateReflectiveReply(input: CoachBrainInput): Promise<CoachBrainOutput> {
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (const ex of input.recentContext) {
    messages.push({ role: "user", content: ex.userMessage });
    messages.push({ role: "assistant", content: ex.coachReply });
  }
  messages.push({ role: "user", content: input.message });

  const client = new Anthropic();
  const response = await client.messages.create({
    model: REFLECTIVE_MODEL,
    max_tokens: REFLECTIVE_MAX_TOKENS,
    system: buildReflectivePrompt(input),
    messages,
  });

  const reply =
    response.content[0]?.type === "text" ? response.content[0].text.trim() : "";

  return {
    reply,
    mode: "reflective",
    language: input.language,
    source: "model",
    model: REFLECTIVE_MODEL,
    coachingMove: "reflective",
  };
}
