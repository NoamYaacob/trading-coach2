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
    id: "revenge",
    label: "אני רוצה להחזיר הפסד",
    message: "אני רוצה להחזיר הפסד",
    group: "distress",
    meaning: "Revenge-loss recovery impulse",
    updatesState: true,
  },
  {
    id: "just-lost",
    label: "הפסדתי עכשיו",
    message: "הפסדתי עכשיו",
    group: "distress",
    meaning: "Fresh loss reported",
    updatesState: true,
  },
  {
    id: "lost-twice",
    label: "הפסדתי פעמיים",
    message: "הפסדתי פעמיים",
    group: "distress",
    meaning: "Two-loss streak / likely stop-rule event",
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
    id: "calming-down",
    label: "נרגעתי",
    message: "נרגעתי",
    group: "reset",
    meaning: "Resetting / decompression",
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

export function getTelegramQuickActionKeyboard() {
  return [
    getCoachQuickActionsByGroup("premarket").map((action) => ({ text: action.message })),
    getCoachQuickActionsByGroup("distress")
      .slice(0, 3)
      .map((action) => ({ text: action.message })),
    getCoachQuickActionsByGroup("distress")
      .slice(3)
      .map((action) => ({ text: action.message })),
    getCoachQuickActionsByGroup("reset").map((action) => ({ text: action.message })),
    [
      ...getCoachQuickActionsByGroup("review").map((action) => ({ text: action.message })),
      ...getCoachQuickActionsByGroup("rules").map((action) => ({ text: action.message })),
    ],
  ];
}
