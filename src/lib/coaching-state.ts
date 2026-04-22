import type { CoachingIntent } from "@/lib/voice-writer";
import type { CoachingExchange } from "@/lib/session-log";

// ─── Move classification ─────────────────────────────────────────────────────

export type CoachingMove =
  | "interrupt"      // sharp named stop (stop_fomo, stop_revenge)
  | "grounding"      // physical anchor, breathe, acknowledge overwhelm
  | "step_away"      // explicit leave-the-screen instruction (cooldown, locked)
  | "space"          // acknowledged the loss, gave room
  | "reframe"        // forward anchor / different angle (forward_anchor, general)
  | "reflective"     // question-led, surface purpose, end of day
  | "rule_reminder"  // named a limit or rule
  | "check_in"       // premarket check-in
  | "general";       // catch-all

export function mapIntentToMove(intent: CoachingIntent): CoachingMove {
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
    case "forward_anchor":
    case "general_coaching":
    case "morning_anchor":
      return "reframe";
    case "surface_purpose":
    case "end_of_day":
    case "end_of_day_review":
      return "reflective";
    case "rule_limit_hit":
    case "rule_limits_summary":
    case "news_warning":
      return "rule_reminder";
    case "pre_session_checkin":
      return "check_in";
    default:
      return "general";
  }
}

// ─── Episode and arc types ───────────────────────────────────────────────────

export type EmotionalEpisode =
  | "acute_distress"  // REVENGE, TILTED
  | "fomo"
  | "loss"            // JUST_TOOK_LOSS, JUST_TOOK_TWO_LOSSES
  | "recovery"        // RESETTING, CALM
  | "premarket"
  | "reflective"
  | "neutral";

export type ArcDirection =
  | "escalating"   // state intensity rising
  | "stabilizing"  // state intensity falling
  | "unresolved"   // same distress state repeated
  | "stable";      // no notable trajectory

// ─── Short-term state type ───────────────────────────────────────────────────

export type ShortTermCoachingState = {
  episode: EmotionalEpisode;
  arc: ArcDirection;
  recentMoves: CoachingMove[];  // most recent first, up to 3
  groundingUsed: boolean;
  stepAwayUsed: boolean;
  sameStateRepeated: boolean;
  exchangeCount: number;
};

// ─── Derivation ──────────────────────────────────────────────────────────────

const STATE_INTENSITY: Record<string, number> = {
  NONE: 0,
  PREMARKET_READY: 0,
  CALM: 1,
  RESETTING: 1,
  JUST_TOOK_LOSS: 2,
  FOMO: 2,
  JUST_TOOK_TWO_LOSSES: 3,
  REVENGE: 4,
  TILTED: 5,
};

function deriveEpisode(exchanges: CoachingExchange[]): EmotionalEpisode {
  if (exchanges.length === 0) return "neutral";
  const state = exchanges[exchanges.length - 1].traderState;
  if (state === "REVENGE" || state === "TILTED") return "acute_distress";
  if (state === "FOMO") return "fomo";
  if (state === "JUST_TOOK_LOSS" || state === "JUST_TOOK_TWO_LOSSES") return "loss";
  if (state === "CALM" || state === "RESETTING") return "recovery";
  if (state === "PREMARKET_READY") return "premarket";
  return "neutral";
}

function deriveArc(exchanges: CoachingExchange[]): ArcDirection {
  if (exchanges.length < 2) return "stable";
  const last = exchanges[exchanges.length - 1];
  const prev = exchanges[exchanges.length - 2];
  const lastI = STATE_INTENSITY[last.traderState] ?? 2;
  const prevI = STATE_INTENSITY[prev.traderState] ?? 2;
  if (lastI > prevI) return "escalating";
  if (lastI < prevI) return "stabilizing";
  if (last.traderState === prev.traderState && lastI > 1) return "unresolved";
  return "stable";
}

export function deriveShortTermCoachingState(
  exchanges: CoachingExchange[],
): ShortTermCoachingState {
  const recentMoves = exchanges
    .slice()
    .reverse()
    .slice(0, 3)
    .map((e) => (e.coachingMove ?? "general") as CoachingMove);

  const groundingUsed = exchanges.some(
    (e) => e.coachingMove === "grounding" || e.coachingMove === "step_away",
  );
  const stepAwayUsed = exchanges.some((e) => e.coachingMove === "step_away");
  const sameStateRepeated =
    exchanges.length >= 2 &&
    exchanges[exchanges.length - 1].traderState ===
      exchanges[exchanges.length - 2].traderState &&
    (STATE_INTENSITY[exchanges[exchanges.length - 1].traderState] ?? 0) > 1;

  return {
    episode: deriveEpisode(exchanges),
    arc: deriveArc(exchanges),
    recentMoves,
    groundingUsed,
    stepAwayUsed,
    sameStateRepeated,
    exchangeCount: exchanges.length,
  };
}

// ─── Prompt block ────────────────────────────────────────────────────────────

const EPISODE_LABELS: Record<EmotionalEpisode, string> = {
  acute_distress: "acute distress (tilt / revenge)",
  fomo: "FOMO / impulse state",
  loss: "processing a loss",
  recovery: "de-escalating / recovering",
  premarket: "premarket / session start",
  reflective: "end of day / reflective",
  neutral: "neutral",
};

const ARC_LABELS: Record<ArcDirection, string> = {
  escalating: "escalating — trader is getting more activated",
  stabilizing: "stabilizing — trader is calming down",
  unresolved: "unresolved — same distress pattern is repeating",
  stable: "stable",
};

const MOVE_LABELS: Record<CoachingMove, string> = {
  interrupt: "interrupt (sharp named stop)",
  grounding: "grounding (breathe / physical anchor)",
  step_away: "step-away instruction",
  space: "space (acknowledged, gave room)",
  reframe: "reframe (forward anchor)",
  reflective: "reflective question",
  rule_reminder: "rule / limit reminder",
  check_in: "check-in",
  general: "general coaching",
};

export function buildCoachingStateBlock(state: ShortTermCoachingState): string[] {
  if (state.exchangeCount === 0) return [];

  const lines: string[] = ["LIVE COACHING STATE:"];
  lines.push(`- Episode: ${EPISODE_LABELS[state.episode]}`);
  lines.push(`- Arc: ${ARC_LABELS[state.arc]}`);

  if (state.recentMoves.length > 0) {
    const moveStr = state.recentMoves.map((m) => MOVE_LABELS[m]).join(" → ");
    lines.push(`- Recent moves (most recent first): ${moveStr}`);
  }
  if (state.groundingUsed) {
    lines.push("- Physical grounding or step-away already given this session.");
  }
  if (state.sameStateRepeated) {
    lines.push("- Trader repeated the same distress state — previous approach did not resolve it.");
  }

  lines.push("");
  return lines;
}
