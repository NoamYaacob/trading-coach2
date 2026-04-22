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

export async function generateReflectiveReply(input: CoachBrainInput): Promise<CoachBrainOutput> {
  const intent = deriveReflectiveIntent(input);

  const prompt =
    input.language === "he"
      ? buildHebrewReflectivePrompt(input, intent)
      : buildEnglishReflectivePrompt(input, intent);

  const client = new Anthropic();
  const response = await client.messages.create({
    model: REFLECTIVE_MODEL,
    max_tokens: REFLECTIVE_MAX_TOKENS,
    messages: [{ role: "user", content: prompt }],
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
