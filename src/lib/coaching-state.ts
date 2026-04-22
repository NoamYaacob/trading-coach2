import type { CoachingIntent } from "@/lib/voice-writer";
import type { CoachingExchange } from "@/lib/session-log";

// ─── Move classification ─────────────────────────────────────────────────────

export type CoachingMove =
  | "interrupt"      // sharp named stop (stop_fomo, stop_revenge)
  | "grounding"      // physical anchor, breathe, acknowledge overwhelm
  | "step_away"      // explicit leave-the-screen instruction (cooldown, locked)
  | "space"          // acknowledged the loss, gave room
  | "reframe"        // forward anchor / different angle
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

// ─── Episode, arc, stabilization types ──────────────────────────────────────

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

/** How far the trader is from calm, right now. */
export type StabilizationLevel =
  | "acute"        // intensity ≥ 4, or ≥ 3 without stabilizing arc
  | "unstable"     // distress intensity 2-3, not yet improving
  | "stabilizing"  // intensity falling — on the way down
  | "settled";     // calm / neutral / recovered

/** Whether a specific coaching move helped, made no difference, or made things worse. */
export type MoveOutcome = {
  move: CoachingMove;
  result: "improved" | "unchanged" | "worsened";
};

// ─── Full short-term state type ──────────────────────────────────────────────

export type ShortTermCoachingState = {
  episode: EmotionalEpisode;
  arc: ArcDirection;
  stabilizationLevel: StabilizationLevel;
  /** True when the last exchange was < 30 min ago and the trader was in distress. */
  episodeActive: boolean;
  /** How many distress-level exchanges appear in the recent history. */
  repeatedDistressCount: number;
  /** Most recent coaching moves, most recent first, up to 3. */
  recentMoves: CoachingMove[];
  /** Outcome of each of the last 2 moves — did the trader's state improve? */
  moveOutcomes: MoveOutcome[];
  /** Last move that was followed by a state improvement, if any. */
  lastEffectiveMove: CoachingMove | null;
  groundingUsed: boolean;
  stepAwayUsed: boolean;
  sameStateRepeated: boolean;
  exchangeCount: number;
};

// ─── Derivation ──────────────────────────────────────────────────────────────

export const STATE_INTENSITY: Record<string, number> = {
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

const EPISODE_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

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

function deriveStabilizationLevel(
  exchanges: CoachingExchange[],
  arc: ArcDirection,
): StabilizationLevel {
  if (exchanges.length === 0) return "settled";
  const intensity = STATE_INTENSITY[exchanges[exchanges.length - 1].traderState] ?? 0;
  if (intensity >= 4) return "acute";
  if (intensity >= 3 && arc !== "stabilizing") return "acute";
  if (intensity >= 2 && arc === "stabilizing") return "stabilizing";
  if (intensity >= 2) return "unstable";
  if (intensity >= 1 && arc === "stabilizing") return "stabilizing";
  return "settled";
}

function deriveMoveOutcomes(exchanges: CoachingExchange[]): MoveOutcome[] {
  if (exchanges.length < 2) return [];
  const outcomes: MoveOutcome[] = [];
  for (let i = 0; i < exchanges.length - 1; i++) {
    const move = (exchanges[i].coachingMove ?? "general") as CoachingMove;
    const before = STATE_INTENSITY[exchanges[i].traderState] ?? 0;
    const after = STATE_INTENSITY[exchanges[i + 1].traderState] ?? 0;
    const result: MoveOutcome["result"] =
      after < before ? "improved" : after > before ? "worsened" : "unchanged";
    outcomes.push({ move, result });
  }
  return outcomes.slice(-2);
}

function deriveLastEffectiveMove(outcomes: MoveOutcome[]): CoachingMove | null {
  for (let i = outcomes.length - 1; i >= 0; i--) {
    if (outcomes[i].result === "improved") return outcomes[i].move;
  }
  return null;
}

export function deriveShortTermCoachingState(
  exchanges: CoachingExchange[],
  now: Date = new Date(),
): ShortTermCoachingState {
  const arc = deriveArc(exchanges);
  const moveOutcomes = deriveMoveOutcomes(exchanges);

  const recentMoves = exchanges
    .slice()
    .reverse()
    .slice(0, 3)
    .map((e) => (e.coachingMove ?? "general") as CoachingMove);

  const groundingUsed = exchanges.some(
    (e) => e.coachingMove === "grounding" || e.coachingMove === "step_away",
  );
  const stepAwayUsed = exchanges.some((e) => e.coachingMove === "step_away");

  const last = exchanges[exchanges.length - 1];
  const prev = exchanges[exchanges.length - 2];
  const sameStateRepeated =
    !!last && !!prev &&
    last.traderState === prev.traderState &&
    (STATE_INTENSITY[last.traderState] ?? 0) > 1;

  const episodeActive =
    !!last &&
    now.getTime() - last.createdAt.getTime() < EPISODE_WINDOW_MS &&
    (STATE_INTENSITY[last.traderState] ?? 0) >= 2;

  const repeatedDistressCount = exchanges.filter(
    (e) => (STATE_INTENSITY[e.traderState] ?? 0) >= 2,
  ).length;

  return {
    episode: deriveEpisode(exchanges),
    arc,
    stabilizationLevel: deriveStabilizationLevel(exchanges, arc),
    episodeActive,
    repeatedDistressCount,
    recentMoves,
    moveOutcomes,
    lastEffectiveMove: deriveLastEffectiveMove(moveOutcomes),
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

const STABILIZATION_LABELS: Record<StabilizationLevel, string> = {
  acute: "acute — spiraling or unresolved",
  unstable: "unstable — distress is present",
  stabilizing: "stabilizing — intensity is falling",
  settled: "settled — calm / recovered",
};

const ARC_SUFFIX: Record<ArcDirection, string> = {
  escalating: ", escalating",
  stabilizing: ", de-escalating",
  unresolved: ", same state repeating",
  stable: "",
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

  // Episode + stabilization + arc in one line
  const arcSuffix = ARC_SUFFIX[state.arc];
  lines.push(
    `- Status: ${STABILIZATION_LABELS[state.stabilizationLevel]}${arcSuffix}`,
  );
  lines.push(`- Episode type: ${EPISODE_LABELS[state.episode]}`);

  if (state.repeatedDistressCount > 1) {
    lines.push(
      `- Distress has repeated ${state.repeatedDistressCount}× this session`,
    );
  }

  // Moves used and their outcomes
  if (state.recentMoves.length > 0) {
    const moveStr = state.recentMoves.map((m) => MOVE_LABELS[m]).join(" → ");
    lines.push(`- Recent moves (most recent first): ${moveStr}`);
  }
  if (state.moveOutcomes.length > 0) {
    const resultStr = state.moveOutcomes
      .map((o) => `${MOVE_LABELS[o.move]}: ${o.result}`)
      .join(" | ");
    lines.push(`- Move outcomes: ${resultStr}`);
  }
  if (state.lastEffectiveMove) {
    lines.push(
      `- ${MOVE_LABELS[state.lastEffectiveMove]} was followed by improvement — preserve if it fits`,
    );
  }

  // Flags
  const failedGrounding =
    state.groundingUsed &&
    (state.stabilizationLevel === "acute" || state.stabilizationLevel === "unstable");
  if (failedGrounding) {
    lines.push(
      "- Grounding or step-away already used and trader is still in distress — do not repeat it",
    );
  }
  if (state.sameStateRepeated) {
    lines.push(
      "- Same distress state is repeating — previous coaching approach did not move it",
    );
  }
  if (!state.episodeActive && state.exchangeCount > 0) {
    lines.push(
      "- Last exchange was > 30 min ago — treat this as a fresh context, not an active continuation",
    );
  }

  // Phase guidance — the core of session orchestration
  lines.push("");
  lines.push("COACHING PHASE GUIDANCE:");

  switch (state.stabilizationLevel) {
    case "acute":
      lines.push("You are in CONTAIN mode. The trader is still in acute distress.");
      if (failedGrounding && state.sameStateRepeated) {
        lines.push(
          "  → Grounding already tried and failed. Switch move category completely.",
        );
        lines.push(
          "  → Options: name the consequence directly, use a sharp reframe, or ask one specific question that breaks the loop.",
        );
      } else if (failedGrounding) {
        lines.push(
          "  → Grounding already used. Try a sharper interrupt or name what is happening plainly.",
        );
      } else {
        lines.push("  → Physical anchor or sharp stop. Direct and short.");
      }
      lines.push("  → No abstract questions. No teaching. Interrupt the spiral.");
      break;

    case "unstable":
      lines.push("You are in HOLD mode. Trader is in distress but not fully spiraling.");
      lines.push("  → Acknowledge briefly. One concrete anchor or one short question.");
      lines.push("  → No lectures. Not yet the moment for reflection or planning.");
      if (state.arc === "escalating") {
        lines.push("  → Arc is escalating — move toward containment, not expansion.");
      }
      break;

    case "stabilizing":
      lines.push("You are in TRANSITION mode. Trader is starting to come down.");
      lines.push("  → Reduce intensity. Lighter touch. Short, forward-pointing.");
      lines.push("  → Do not re-open the distress or revisit what just happened.");
      lines.push("  → A soft question or one forward anchor is now appropriate.");
      break;

    case "settled":
      lines.push("You are in REFLECT mode. Trader is calm or settled.");
      lines.push("  → Full reflective mode available. One honest question or forward anchor.");
      lines.push("  → Light touch. No urgency. Space for actual thinking.");
      break;
  }

  lines.push("");
  return lines;
}
