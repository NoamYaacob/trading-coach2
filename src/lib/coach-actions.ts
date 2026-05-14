import type { BotLocale } from "@/lib/i18n/types";

export type CoachActionGroupKey =
  | "premarket"
  | "distress"
  | "reset"
  | "review"
  | "rules";

export type CoachQuickAction = {
  id: string;
  label: string;
  message: string;
  group: CoachActionGroupKey;
  meaning: string;
  updatesState: boolean;
};

export const coachQuickActions: CoachQuickAction[] = [
  {
    id: "check-in",
    label: "צ'ק אין",
    message: "צ'ק אין",
    group: "premarket",
    meaning: "Premarket readiness and session focus",
    updatesState: true,
  },
  {
    id: "fomo",
    label: "יש לי FOMO",
    message: "יש לי FOMO",
    group: "distress",
    meaning: "Fast emotional impulse / fear of missing out",
    updatesState: true,
  },
  {
    id: "angry",
    label: "אני בעצבים",
    message: "אני בעצבים",
    group: "distress",
    meaning: "Tilt / anger state",
    updatesState: true,
  },
  {
    id: "out-of-control",
    label: "אני לא בשליטה",
    message: "אני לא בשליטה",
    group: "distress",
    meaning: "Loss of control / dysregulated state",
    updatesState: true,
  },
  {
    id: "dragged",
    label: "נגררתי",
    message: "נגררתי",
    group: "distress",
    meaning: "Got pulled into an impulsive trade without a setup",
    updatesState: true,
  },
  {
    id: "revenge",
    label: "אני רוצה להחזיר הפסד",
    message: "אני רוצה להחזיר הפסד",
    group: "distress",
    meaning: "Revenge-loss recovery impulse",
    updatesState: true,
  },
  {
    id: "stop-me",
    label: "עצור אותי",
    message: "עצור אותי",
    group: "reset",
    meaning: "Requesting a hard stop before doing something wrong",
    updatesState: true,
  },
  {
    id: "back-in-control",
    label: "חזרתי לשליטה",
    message: "חזרתי לשליטה",
    group: "reset",
    meaning: "Recovered composure",
    updatesState: true,
  },
  {
    id: "day-summary",
    label: "סכם לי את היום",
    message: "סכם לי את היום",
    group: "review",
    meaning: "Postmarket review",
    updatesState: false,
  },
  {
    id: "rule-limits",
    label: "מה המקסימום שלי היום?",
    message: "מה המקסימום שלי היום?",
    group: "rules",
    meaning: "Risk-rule boundary reminder",
    updatesState: false,
  },
  {
    id: "remaining",
    label: "כמה נשאר לי היום?",
    message: "כמה נשאר לי היום?",
    group: "rules",
    meaning: "Current usage vs. limits — how much room is left",
    updatesState: false,
  },
];

export const coachQuickActionGroups: Record<
  CoachActionGroupKey,
  { title: string; description: string }
> = {
  premarket: {
    title: "Premarket",
    description: "Prepare for session",
  },
  distress: {
    title: "Distress",
    description: "Hot-state interruption",
  },
  reset: {
    title: "Reset",
    description: "Recovery / regain control",
  },
  review: {
    title: "Review",
    description: "End-of-day reflection",
  },
  rules: {
    title: "Rules",
    description: "Risk boundaries",
  },
};

export function getCoachQuickActionsByGroup(group: CoachActionGroupKey) {
  return coachQuickActions.filter((action) => action.group === group);
}

export function getTelegramQuickActionKeyboard(locale: BotLocale) {
  const k = locale.keyboard;
  return [
    [{ text: k.checkIn }],
    [{ text: k.fomo }, { text: k.angry }, { text: k.outOfControl }],
    [{ text: k.dragged }, { text: k.revenge }],
    [{ text: k.stopMe }, { text: k.backInControl }, { text: k.daySummary }],
    [{ text: k.ruleLimits }, { text: k.remaining }],
  ];
}

const KEYBOARD_KEY_TO_ACTION_ID: Record<keyof BotLocale["keyboard"], string> = {
  checkIn: "check-in",
  fomo: "fomo",
  angry: "angry",
  outOfControl: "out-of-control",
  dragged: "dragged",
  revenge: "revenge",
  stopMe: "stop-me",
  backInControl: "back-in-control",
  daySummary: "day-summary",
  ruleLimits: "rule-limits",
  remaining: "remaining",
};

/**
 * Maps a localised keyboard button label to its corresponding quick action,
 * enabling the webhook to resolve canonical action data from any locale's text.
 */
export function findActionByLocaleText(
  text: string,
  locale: BotLocale,
): CoachQuickAction | null {
  const trimmed = text.trim();
  for (const [key, actionId] of Object.entries(KEYBOARD_KEY_TO_ACTION_ID)) {
    if (locale.keyboard[key as keyof BotLocale["keyboard"]] === trimmed) {
      return coachQuickActions.find((a) => a.id === actionId) ?? null;
    }
  }
  return null;
}

const ACTION_LOCALE_REPLY: Record<string, (l: BotLocale) => string> = {
  "check-in": (l) => l.prompts.checkIn,
  "fomo": (l) => l.coaching.fomo,
  "angry": (l) => l.coaching.anger,
  "out-of-control": (l) => l.coaching.anger,
  "dragged": (l) => l.coaching.fomo,
  "revenge": (l) => l.coaching.revenge,
  "stop-me": (l) => l.coaching.discipline,
  "back-in-control": (l) => l.coaching.discipline,
  "day-summary": (l) => l.prompts.review,
  "rule-limits": (l) => l.coaching.warning,
  "remaining": (l) => l.coaching.warning,
};

export function getLocaleReplyForQuickAction(
  actionId: string,
  locale: BotLocale,
): string | null {
  return ACTION_LOCALE_REPLY[actionId]?.(locale) ?? null;
}
