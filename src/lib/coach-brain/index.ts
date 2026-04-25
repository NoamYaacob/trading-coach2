import type { CoachBrainInput, CoachBrainOutput } from "./types";
import { routeToMode } from "./router";
import { buildFactualReply, buildMarketHoursReply } from "./factual";
import { generateDistressReply } from "./distress";
import { generateReflectiveReply } from "./reflective";
import { generateFreeTextReply } from "./free-text";
import { postprocess } from "./postprocess";

export type { CoachBrainInput, CoachBrainOutput } from "./types";

export async function generateCoachReply(input: CoachBrainInput): Promise<CoachBrainOutput> {
  const mode = routeToMode(input);

  let output: CoachBrainOutput;

  switch (mode) {
    case "factual": {
      const reply = buildFactualReply(input);
      output = {
        reply,
        mode: "factual",
        language: input.language,
        source: "code",
        coachingMove: "rule_reminder",
      };
      break;
    }
    case "market_hours": {
      const reply = buildMarketHoursReply(input);
      output = {
        reply,
        mode: "market_hours",
        language: input.language,
        source: "code",
        coachingMove: "rule_reminder",
      };
      break;
    }
    case "distress":
      output = await generateDistressReply(input);
      break;
    case "reflective":
      output = await generateReflectiveReply(input);
      break;
    default:
      output = await generateFreeTextReply(input);
  }

  return {
    ...output,
    reply: postprocess(output.reply, mode),
  };
}
