import Anthropic from "@anthropic-ai/sdk";
import type { CoachBrainInput, CoachBrainOutput, CoachingMove } from "./types";
import { buildHebrewDistressPrompt, type DistressIntent } from "./prompts/distress.he";
import { buildEnglishDistressPrompt } from "./prompts/distress.en";

// Upgrade to "claude-opus-4-7" for higher quality
const DISTRESS_MODEL = "claude-haiku-4-5";
const DISTRESS_MAX_TOKENS = 150;

function deriveDistressIntent(input: CoachBrainInput): DistressIntent {
  const { actionId, traderState, guardianLocked, cooldownActive, hasBlockingViolation } = input;
  const state = traderState.toLowerCase();

  if (guardianLocked) return "account_locked";
  if (cooldownActive) return "cooldown_active";
  if (hasBlockingViolation) return "acknowledge_loss";

  switch (actionId) {
    case "fomo":
      return "stop_fomo";
    case "revenge":
      return "stop_revenge";
    case "angry":
    case "out-of-control":
    case "stop-me":
      return "ground_tilt";
    case "dragged":
      return "acknowledge_multiple_losses";
  }

  if (state.includes("fomo")) return "stop_fomo";
  if (state.includes("revenge")) return "stop_revenge";
  if (state.includes("tilt") || state.includes("out_of_control")) return "ground_tilt";
  if (state.includes("just_took_loss")) {
    return input.usage.consecutiveLosses > 1
      ? "acknowledge_multiple_losses"
      : "acknowledge_loss";
  }

  return "general_distress";
}

function intentToMove(intent: DistressIntent): CoachingMove {
  switch (intent) {
    case "stop_fomo":
    case "stop_revenge":
      return "interrupt";
    case "ground_tilt":
    case "acknowledge_multiple_losses":
      return "grounding";
    case "cooldown_active":
    case "account_locked":
      return "step_away";
    case "acknowledge_loss":
      return "space";
    default:
      return "general";
  }
}

function buildDistressPrompt(input: CoachBrainInput): string {
  const intent = deriveDistressIntent(input);
  return input.language === "he"
    ? buildHebrewDistressPrompt(input, intent)
    : buildEnglishDistressPrompt(input, intent);
}

export async function generateDistressReply(input: CoachBrainInput): Promise<CoachBrainOutput> {
  const intent = deriveDistressIntent(input);
  const coachingMove = intentToMove(intent);

  const client = new Anthropic();
  const response = await client.messages.create({
    model: DISTRESS_MODEL,
    max_tokens: DISTRESS_MAX_TOKENS,
    system: buildDistressPrompt(input),
    messages: [{ role: "user", content: input.message }],
  });

  const reply =
    response.content[0]?.type === "text" ? response.content[0].text.trim() : "";

  return {
    reply,
    mode: "distress",
    language: input.language,
    source: "model",
    model: DISTRESS_MODEL,
    coachingMove,
  };
}
