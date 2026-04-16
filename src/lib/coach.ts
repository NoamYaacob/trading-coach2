import { TraderCurrentState, type Prisma } from "@prisma/client";
import { coachPlaybook, type CoachMode } from "@/lib/coach-playbook";
import type { TodaySessionSummary } from "@/lib/session-log";
import type {
  EconomicEvent,
  EconomicPreNewsPolicyStatus,
} from "@/lib/economic-calendar";

export type CoachIntent =
  | "check_in"
  | "day_summary"
  | "emotional_distress"
  | "rule_question"
  | "generic_coaching";

/**
 * Manual trade-event signals from today's manually logged entries.
 * Structurally mirrors ManualEventSignals from rule-engine; defined locally
 * to keep the coach layer independent of the rule engine import graph.
 */
type ManualActivitySignals = {
  tradeCount: number;
  winCount: number;
  lossCount: number;
  consecutiveLosses: number;
  netPnL: number | null;
  hasRuleBreach: boolean;
  tradeActivityLogged: boolean;
};

type CoachContextInput = {
  traderProfile: {
    primaryMarket: string | null;
    tradingStyle: string | null;
  } | null;
  riskRules: {
    accountSize: Prisma.Decimal | null;
    maxDailyLoss: Prisma.Decimal | null;
    riskPerTrade: Prisma.Decimal | null;
    maxTradesPerDay: number | null;
    stopAfterLosses: number | null;
  } | null;
  mentalProfile: {
    primaryChallenge: string | null;
    tiltTrigger: string | null;
    tiltThought: string | null;
    coachingTone: string | null;
    interruptionStyle: string | null;
    responseStyle: string | null;
  } | null;
  coachingPreferences: {
    premarketCheckinEnabled: boolean;
    postmarketReviewEnabled: boolean;
    checkinFormat: string | null;
    reviewFocus: string | null;
    newsAlertsEnabled: boolean;
    preNewsMinutes: number | null;
    highImpactOnly: boolean;
  } | null;
  traderState?: {
    currentState: TraderCurrentState;
    stateNotes: string | null;
    recentLossStreak: number | null;
    needsCooldown: boolean;
    cooldownUntil: Date | null;
  } | null;
  todaySessionSummary?: TodaySessionSummary | null;
  recentSessionEvents?: Array<{
    message: string;
    detectedIntent: string | null;
    traderState: TraderCurrentState;
    createdAt: Date;
  }> | null;
  guardian?: {
    guardianEnabled: boolean;
    currentLockoutActive: boolean;
    primaryReason: string;
    primaryReasonLabel: string;
    triggeredRules: string[];
    triggeredRuleLabels: string[];
    actionGuidance: string[];
    resetMode: string;
    resetTimezone: string;
    nextAllowedResetAt: Date | null;
    lastResetAt: Date | null;
    resetAllowedNow: boolean;
  } | null;
  sessionLifecycle?: {
    todaySessionStateKind:
      | "ONBOARDING_REQUIRED"
      | "READY_TO_TRADE"
      | "LOCKED_BY_GUARDIAN"
      | "RESET_PENDING"
      | "GUARDIAN_DISABLED";
    sessionStarted: boolean;
    sessionStartedAt: Date | null;
    sessionEnded: boolean;
    sessionEndedAt: Date | null;
    resetTimezone: string | null;
  } | null;
  economicCalendar?: {
    nextHighImpactEvent: EconomicEvent | null;
    hasUpcomingHighImpactEvent: boolean;
    isInsidePreNewsWarningWindow: boolean;
    preNewsPolicy?: EconomicPreNewsPolicyStatus | null;
  } | null;
  manualActivity?: ManualActivitySignals | null;
};

export type CoachContext = {
  primaryMarket: string | null;
  tradingStyle: string | null;
  accountSize: string | null;
  maxDailyLoss: string | null;
  riskPerTrade: string | null;
  maxTradesPerDay: number | null;
  stopAfterLosses: number | null;
  primaryChallenge: string | null;
  tiltTrigger: string | null;
  tiltThought: string | null;
  coachingTone: string | null;
  interruptionStyle: string | null;
  responseStyle: string | null;
  premarketCheckinEnabled: boolean;
  postmarketReviewEnabled: boolean;
  checkinFormat: string | null;
  reviewFocus: string | null;
  newsAlertsEnabled: boolean;
  preNewsMinutes: number | null;
  highImpactOnly: boolean;
  currentState: TraderCurrentState;
  stateNotes: string | null;
  recentLossStreak: number;
  needsCooldown: boolean;
  cooldownUntil: Date | null;
  cooldownActive: boolean;
  shouldInterruptHard: boolean;
  shouldStopTrading: boolean;
  resetInProgress: boolean;
  calmRecovered: boolean;
  todaySessionSummary: TodaySessionSummary;
  recentSessionEvents: Array<{
    message: string;
    detectedIntent: string | null;
    traderState: TraderCurrentState;
    createdAt: Date;
  }>;
  guardianEnabled: boolean;
  currentLockoutActive: boolean;
  primaryGuardianReason: string | null;
  primaryGuardianReasonLabel: string | null;
  triggeredGuardianRules: string[];
  triggeredGuardianRuleLabels: string[];
  guardianActionGuidance: string[];
  guardianResetMode: string | null;
  guardianResetTimezone: string | null;
  guardianNextAllowedResetAt: Date | null;
  guardianLastResetAt: Date | null;
  guardianResetAllowedNow: boolean;
  todaySessionStateKind:
    | "ONBOARDING_REQUIRED"
    | "READY_TO_TRADE"
    | "LOCKED_BY_GUARDIAN"
    | "RESET_PENDING"
    | "GUARDIAN_DISABLED";
  sessionLifecycleState: "NOT_STARTED" | "ACTIVE" | "ENDED";
  sessionStarted: boolean;
  sessionStartedAt: Date | null;
  sessionEnded: boolean;
  sessionEndedAt: Date | null;
  sessionLifecycleTimezone: string | null;
  economicCalendar: {
    nextHighImpactEvent: EconomicEvent | null;
    hasUpcomingHighImpactEvent: boolean;
    isInsidePreNewsWarningWindow: boolean;
    preNewsPolicy: EconomicPreNewsPolicyStatus | null;
  };
  manualActivity: ManualActivitySignals | null;
};

type NormalizedTone = "TOUGH" | "CALM_SHARP" | "DIRECT" | "SUPPORTIVE";
type NormalizedInterruptionStyle =
  | "HARD_STOP"
  | "PATTERN_INTERRUPT"
  | "QUESTION"
  | "PAUSE";
type NormalizedResponseStyle = "SHORT" | "REFLECTIVE" | "ACTION" | "BULLET";
type ReplyBehavior =
  | "STANDARD"
  | "RESET_SUPPORT"
  | "RETURN_TO_PROCESS"
  | "HARD_STOP_POST_LOSS"
  | "GUARDIAN_LOCKOUT"
  | "SESSION_LIFECYCLE";

function decimalToString(value: Prisma.Decimal | null | undefined) {
  return value ? value.toString() : null;
}

function splitStoredList(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  return value
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeMessage(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[׳']/g, "")
    .replace(/\s+/g, " ");
}

function localizeTerm(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return value
    .replace(/overtrading/gi, "מסחר יתר")
    .replace(/\bfomo\b/gi, "פחד לפספס")
    .replace(/pattern/gi, "דפוס")
    .replace(/trigger/gi, "טריגר");
}

function normalizeTone(tone: string | null) {
  const value = (tone ?? "").toLowerCase();

  if (value.includes("tough")) {
    return "TOUGH" as const;
  }

  if (value.includes("calm_sharp") || (value.includes("calm") && value.includes("sharp"))) {
    return "CALM_SHARP" as const;
  }

  if (value.includes("direct")) {
    return "DIRECT" as const;
  }

  if (value.includes("supportive")) {
    return "SUPPORTIVE" as const;
  }

  if (value.includes("calm")) {
    return "CALM_SHARP" as const;
  }

  return "DIRECT" as const;
}

function normalizeInterruptionStyle(style: string | null) {
  const value = (style ?? "").toLowerCase();

  if (value.includes("hard stop")) {
    return "HARD_STOP" as const;
  }

  if (value.includes("pattern")) {
    return "PATTERN_INTERRUPT" as const;
  }

  if (value.includes("question")) {
    return "QUESTION" as const;
  }

  return "PAUSE" as const;
}

function normalizeResponseStyle(style: string | null) {
  const value = (style ?? "").toLowerCase();

  if (value.includes("one-line") || value.includes("short")) {
    return "SHORT" as const;
  }

  if (value.includes("reflective")) {
    return "REFLECTIVE" as const;
  }

  if (value.includes("action")) {
    return "ACTION" as const;
  }

  if (value.includes("bullet")) {
    return "BULLET" as const;
  }

  return "BULLET" as const;
}

function formatList(lines: string[]) {
  return lines.map((line) => `- ${line}`).join("\n");
}

function shapeLines(lines: string[], responseStyle: string | null) {
  const style: NormalizedResponseStyle = normalizeResponseStyle(responseStyle);

  if (style === "SHORT") {
    return lines.slice(0, 2).join(" ");
  }

  if (style === "REFLECTIVE") {
    return `${formatList(lines)}\n- מה הבחירה הממושמעת שלך בצעד הבא?`;
  }

  if (style === "ACTION") {
    return `${formatList(lines)}\n- פעולה עכשיו: רק הצעד הבא שעומד בחוקים.`;
  }

  return formatList(lines);
}

function humanizeMarket(value: string | null) {
  if (!value) {
    return null;
  }

  const labels: Record<string, string> = {
    FUTURES: "חוזים",
    US_EQUITIES: "מניות ארה\"ב",
    FOREX: "פורקס",
    CRYPTO: "קריפטו",
  };

  return labels[value] ?? value.replaceAll("_", " ").toLowerCase();
}

function localizeGuardianReason(reason: string | null | undefined) {
  switch (reason) {
    case "MAX_TRADES_PER_DAY":
      return "הגעת למקסימום העסקאות היומי.";
    case "MAX_DAILY_LOSS":
      return "הגעת למקסימום ההפסד היומי.";
    case "CONSECUTIVE_LOSSES":
      return "הגעת לגבול ההפסדים הרצופים.";
    case "DAILY_PROFIT_TARGET":
      return "הגעת ליעד הרווח היומי.";
    default:
      return "הגנת Guardian פעילה.";
  }
}

function localizeGuardianRuleLabel(reason: string) {
  switch (reason) {
    case "MAX_TRADES_PER_DAY":
      return "מקסימום עסקאות יומי";
    case "MAX_DAILY_LOSS":
      return "מקסימום הפסד יומי";
    case "CONSECUTIVE_LOSSES":
      return "גבול הפסדים רצופים";
    case "DAILY_PROFIT_TARGET":
      return "יעד רווח יומי";
    default:
      return reason;
  }
}

function formatGuardianResetAt(date: Date | null, timeZone: string | null) {
  if (!date || !timeZone) {
    return null;
  }

  return `${new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(date)} (${timeZone})`;
}

function formatSessionLifecycleAt(date: Date | null, timeZone: string | null) {
  if (!date) {
    return null;
  }

  const resolvedTimeZone = timeZone ?? "Asia/Jerusalem";

  return `${new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: resolvedTimeZone,
  }).format(date)} (${resolvedTimeZone})`;
}

function buildOpeningLine(context: CoachContext) {
  const market = humanizeMarket(context.primaryMarket);

  return market
    ? `לפני שאתה נכנס, תסחור את ${market} כמו מקצוען ממושמע.`
    : "לפני שאתה נכנס, תסחור את התוכנית ולא את הרגש.";
}

function buildRuleLine(context: CoachContext) {
  const parts = [
    context.riskPerTrade ? `סיכון לעסקה ${context.riskPerTrade}` : null,
    context.maxTradesPerDay ? `עד ${context.maxTradesPerDay} עסקאות` : null,
    context.stopAfterLosses ? `עוצר אחרי ${context.stopAfterLosses} הפסדים` : null,
    context.maxDailyLoss ? `מקסימום הפסד יומי ${context.maxDailyLoss}` : null,
  ].filter(Boolean);

  return parts.length > 0
    ? `היום זה פשוט: ${parts.join(", ")}.`
    : "היום זה פשוט: בלי עסקאות בכוח ובלי חריגה מהחוקים.";
}

function formatEconomicEventTime(value: Date) {
  return new Intl.DateTimeFormat("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(value);
}

function buildEconomicCalendarAwarenessLine(context: CoachContext) {
  const event = context.economicCalendar.nextHighImpactEvent;
  const policy = context.economicCalendar.preNewsPolicy;

  if (!event) {
    return null;
  }

  if (policy?.isActive) {
    const formattedTime = formatEconomicEventTime(event.startTime);

    if (policy.policy.mode === "HARD_BLOCK_MAJOR") {
      return `אירוע חד-השפעה משמעותי מתרחש עכשיו. אל תפתח את הסשן עד שהחלון יעבור.`;
    }

    if (policy.policy.mode === "SOFT_CAUTION") {
      return `חדשות חד-השפעה מתקרבות: ${event.title} ב-${formattedTime} UTC. אפשר להתחיל, אבל רק עם תוכנית ברורה.`;
    }

    if (policy.policy.mode === "WARNING_ONLY") {
      return `אירוע חד-השפעה מתקרב: ${event.title} ב-${formattedTime} UTC. שמור על התהליך והחלטות נקיות.`;
    }
  }

  if (
    context.economicCalendar.isInsidePreNewsWarningWindow ||
    context.newsAlertsEnabled
  ) {
    const formattedTime = formatEconomicEventTime(event.startTime);

    if (context.economicCalendar.isInsidePreNewsWarningWindow) {
      return `אירוע חד-השפעה חשוב מתקרב: ${event.title} ב-${formattedTime} UTC. שמור על החוקים, לא על הרעש.`;
    }

    return `אירוע חד-השפעה מתקרב: ${event.title} ב-${formattedTime} UTC. אל תיתן לו לשנות את התהליך שלך.`;
  }

  return null;
}

function buildPreNewsSessionAdvice(context: CoachContext) {
  const line = buildEconomicCalendarAwarenessLine(context);
  if (!line) {
    return "תפתח את הסשן מהדשבורד, ואז נמשיך כאן.";
  }

  return `${line} תפתח את הסשן מהדשבורד, ואז נמשיך כאן.`;
}

function buildModeOpening(mode: CoachMode, context: CoachContext, tone: NormalizedTone) {
  const playbook = coachPlaybook[mode];
  const fragment = playbook.samplePhrasingFragments[0];

  if (mode === "PREMARKET_COACH") {
    return tone === "SUPPORTIVE"
      ? "תתייצב. היום לא צריך להיות דרמטי כדי להיות יום טוב."
      : `${buildOpeningLine(context)} ${fragment}`;
  }

  if (mode === "POSTMARKET_REVIEWER") {
    return "בוא נבדוק את איכות היום שלך, לא רק את התוצאה.";
  }

  if (mode === "RULE_ENFORCER") {
    return "אלה הגבולות שלך להיום.";
  }

  if (mode === "GUARDIAN_LOCKOUT_ENFORCER") {
    return "Guardian נעל את המסחר כרגע.";
  }

  if (tone === "TOUGH") {
    return "עצור. הרגש לא נכנס לעסקה הבאה.";
  }

  if (tone === "CALM_SHARP") {
    return "עצור רגע. תירגע, ואז תתחדד.";
  }

  if (tone === "SUPPORTIVE") {
    return "נשימה אחת. לא עושים כלום לפני שחוזרים לשליטה.";
  }

  return "עצור. תגיד לעצמך את האמת על מה שקורה עכשיו.";
}

function buildInterruptionLine(context: CoachContext, mode: CoachMode) {
  const style: NormalizedInterruptionStyle = normalizeInterruptionStyle(
    context.interruptionStyle,
  );

  if (style === "HARD_STOP") {
    return mode === "POST_LOSS_INTERRUPT"
      ? "אין עסקה הבאה עד שהמצב שלך חוזר לשליטה."
      : "אין עסקה הבאה עד שאתה חוזר לחוקים בצורה נקייה.";
  }

  if (style === "PATTERN_INTERRUPT") {
    return "שבור עכשיו את הרצף: קום, תתאפס, ורק אז תחזור לתוכנית.";
  }

  if (style === "QUESTION") {
    return "מה אתה עומד לעשות עכשיו שהגרסה הממושמעת שלך לא תכבד בעוד עשר דקות?";
  }

  return "קח צעד אחורה ותעשה איפוס נקי לפני ההחלטה הבאה.";
}

function shapeRuleAnswer(label: string, value: string | number | null, fallback: string) {
  return value ? `${label}: ${value}` : `${label}: ${fallback}`;
}

function hasLossLanguage(message: string) {
  const normalized = normalizeMessage(message);

  return [
    "loss",
    "losing",
    "הפסד",
    "להחזיר הפסד",
    "להחזיר את ההפסד",
    "אני רוצה להחזיר",
    "אני חייב להחזיר",
    "revenge",
    "make it back",
    "down today",
  ].some((pattern) => normalized.includes(pattern));
}

function isRevengeLossMessage(message: string) {
  const normalized = normalizeMessage(message);

  return [
    "אני רוצה להחזיר את ההפסד",
    "אני רוצה להחזיר",
    "אני חייב להחזיר את זה",
    "אני חייב להחזיר",
    "אני רוצה להחזיר עכשיו",
    "אני צריך להחזיר את זה",
    "להחזיר את ההפסד",
  ].some((pattern) => normalized.includes(pattern));
}

function resolveCoachMode(
  intent: CoachIntent,
  message: string,
  context: CoachContext,
): CoachMode {
  if (context.currentLockoutActive) {
    return "GUARDIAN_LOCKOUT_ENFORCER";
  }

  if (intent === "day_summary") {
    return "POSTMARKET_REVIEWER";
  }

  if (intent === "rule_question") {
    return "RULE_ENFORCER";
  }

  if (intent === "check_in" && context.currentState === TraderCurrentState.PREMARKET_READY) {
    return "PREMARKET_COACH";
  }

  if (context.currentState === TraderCurrentState.PREMARKET_READY) {
    return "PREMARKET_COACH";
  }

  if (context.currentState === TraderCurrentState.RESETTING) {
    return "IN_TRADE_INTERRUPT";
  }

  if (context.currentState === TraderCurrentState.CALM) {
    return "RULE_ENFORCER";
  }

  if (context.currentState === TraderCurrentState.JUST_TOOK_TWO_LOSSES) {
    return "POST_LOSS_INTERRUPT";
  }

  if (context.currentState === TraderCurrentState.JUST_TOOK_LOSS) {
    return "POST_LOSS_INTERRUPT";
  }

  if (context.currentState === TraderCurrentState.REVENGE) {
    return "POST_LOSS_INTERRUPT";
  }

  if (
    context.currentState === TraderCurrentState.FOMO ||
    context.currentState === TraderCurrentState.TILTED
  ) {
    return "IN_TRADE_INTERRUPT";
  }

  if (intent === "check_in") {
    return "PREMARKET_COACH";
  }

  if (intent === "emotional_distress") {
    return hasLossLanguage(message) ? "POST_LOSS_INTERRUPT" : "IN_TRADE_INTERRUPT";
  }

  return "PREMARKET_COACH";
}

function resolveReplyBehavior(intent: CoachIntent, context: CoachContext): ReplyBehavior {
  if (context.currentLockoutActive) {
    return "GUARDIAN_LOCKOUT";
  }

  if (context.sessionLifecycleState !== "ACTIVE") {
    return "SESSION_LIFECYCLE";
  }

  if (intent === "day_summary" || intent === "rule_question" || intent === "check_in") {
    return "STANDARD";
  }

  if (context.currentState === TraderCurrentState.RESETTING) {
    return "RESET_SUPPORT";
  }

  if (context.currentState === TraderCurrentState.CALM) {
    return "RETURN_TO_PROCESS";
  }

  if (context.currentState === TraderCurrentState.JUST_TOOK_TWO_LOSSES) {
    return "HARD_STOP_POST_LOSS";
  }

  return "STANDARD";
}

function emptySessionSummary(): TodaySessionSummary {
  return {
    eventCount: 0,
    distressCount: 0,
    fomoCount: 0,
    revengeCount: 0,
    tiltCount: 0,
    lossCount: 0,
    twoLossCount: 0,
    resetCount: 0,
    calmCount: 0,
    cooldownCount: 0,
    hasRecoveryToday: false,
    stayedUnstable: false,
  };
}

function getStateAwareMomentLines(message: string, context: CoachContext) {
  const normalized = normalizeMessage(message);

  if (isRevengeLossMessage(message) || context.currentState === TraderCurrentState.REVENGE) {
    return {
      openingLine: "עצור רגע.",
      mirrorLine:
        "אתה לא מחפש עכשיו עסקה טובה, אתה מחפש להרגיש שהחזרת שליטה.",
      internalLine:
        "זה הרגע שבו אתה עובר מתהליך לדחף, והגוף כבר רוצה לתקן את הכאב מהר.",
      restoreLine: "קודם תחזיר שליטה, אחר כך תחזור לגרף.",
      nextStepLine:
        "הצעד הבא: תתרחק מהמסך לשתי דקות ותבדוק אם בכלל מותר לך לקחת עוד סיכון היום.",
    };
  }

  if (
    normalized.includes("הפסדתי פעמיים") ||
    context.currentState === TraderCurrentState.JUST_TOOK_TWO_LOSSES ||
    context.shouldStopTrading
  ) {
    return {
      openingLine: "זה עצירה, לא התלבטות.",
      mirrorLine: "שני הפסדים ברצף זה בדיוק הרגע שבו הראש רוצה להילחם בחוקים.",
      internalLine:
        "עכשיו כבר קשה להבדיל בין ניתוח אמיתי לבין ניסיון להציל את היום.",
      restoreLine:
        "כאן המשמעת נכנסת. החוקים כבר החליטו בשבילך מה הצעד הבא.",
      nextStepLine: "הצעד הבא: סוגרים מסך, נושמים, ולא פותחים עוד עסקה.",
    };
  }

  if (
    normalized.includes("הפסדתי עכשיו") ||
    context.currentState === TraderCurrentState.JUST_TOOK_LOSS
  ) {
    return {
      openingLine: "רגע.",
      mirrorLine: "כרגע קיבלת מכה, והמערכת שלך רוצה להגיב מהר לפני שהיא נרגעת.",
      internalLine:
        "אחרי הפסד אחד הראש מחפש להסביר, לתקן או להחזיר מיד. זה בדיוק הרגע להאט.",
      restoreLine: "אל תענה להפסד עם עסקה חדשה. קודם תחזיר יציבות.",
      nextStepLine:
        "הצעד הבא: תתרחק לדקה, תנשום, ותבדוק אם הסטאפ הבא באמת קיים או שזה רק צורך להגיב.",
    };
  }

  if (
    normalized.includes("יש לי fomo") ||
    normalized.includes("יש לי פומו") ||
    context.currentState === TraderCurrentState.FOMO
  ) {
    return {
      openingLine: "אל תרדוף עכשיו.",
      mirrorLine: "כרגע אתה מרגיש שהשוק זז בלעדיך ושאתה חייב להגיב עכשיו.",
      internalLine:
        "הראש ממהר, הגוף כבר נכנס ללחץ, ועכשיו אסור לתת לזה לנהל את ההחלטה הבאה.",
      restoreLine: "תחזור לקצב שלך לפני שאתה חוזר לכפתור.",
      nextStepLine:
        "הצעד הבא: תכתוב לעצמך מה הסטאפ, מה הפסילה, ומה הסיבה לא להיכנס אם זה לא נקי.",
    };
  }

  if (
    normalized.includes("אני לא בשליטה")
  ) {
    return {
      openingLine: "עצור עכשיו.",
      mirrorLine: "כרגע אתה לא מחזיק את עצמך מבפנים, ולכן אי אפשר לסמוך על ההחלטה הבאה.",
      internalLine:
        "הראש, הרגש והגוף כבר לא עובדים יחד. במצב כזה כל קליק נוסף הוא מסוכן.",
      restoreLine: "קודם מחזירים שליטה לעצמך. מסחר לא קיים כרגע.",
      nextStepLine: "הצעד הבא: תתרחק מהמסך, תקום, ורק כשתחזור לעצמך תחשוב אם בכלל חוזרים היום.",
    };
  }

  if (
    normalized.includes("אני בעצבים") ||
    context.currentState === TraderCurrentState.TILTED
  ) {
    return {
      openingLine: "רואים שאתה כבר מוצף.",
      mirrorLine: "כרגע העצבים כבר נכנסו לגוף, וההחלטות מתחילות לצאת מהצפה ולא משיקול דעת.",
      internalLine:
        "במצב כזה גם מחשבה שנשמעת הגיונית יכולה להיות רק פריקה של מתח.",
      restoreLine: "תוריד קודם את העוצמה לפני שאתה נוגע בעוד החלטה.",
      nextStepLine: "הצעד הבא: בלי קליק נוסף עד שהנשימה, הקצב והגוף יורדים הילוך.",
    };
  }

  if (
    normalized.includes("נרגעתי") ||
    normalized.includes("אני נרגע") ||
    context.resetInProgress
  ) {
    return {
      openingLine: "טוב.",
      mirrorLine: "טוב. משהו אצלך כבר ירד בעוצמה.",
      internalLine:
        "אבל זה עדיין שלב עדין. לפעמים הראש נרגע לפני שהגוף באמת יוצא מהלחץ.",
      restoreLine: "אל תמהר לקרוא לזה חזרה מלאה.",
      nextStepLine:
        "הצעד הבא: תישאר עוד רגע באיפוס ותבדוק אם אתה באמת שקט או רק פחות מוצף.",
    };
  }

  if (
    normalized.includes("חזרתי לשליטה") ||
    normalized.includes("חזרתי") ||
    context.calmRecovered
  ) {
    return {
      openingLine: "טוב.",
      mirrorLine: "טוב. חזרת לעצמך.",
      internalLine:
        "עכשיו המבחן הוא לא להוכיח כלום, אלא לשמור על הראש נקי ועל הקצב שלך.",
      restoreLine: "תעבור חזרה לתהליך, לא למהירות.",
      nextStepLine:
        "הצעד הבא: תחזור רק לסטאפ ברור, עם סיכון מוגדר מראש ובלי ניסיון להציל את היום.",
    };
  }

  return {
    openingLine: "עצור רגע.",
    mirrorLine: "משהו אצלך מתחיל לצאת משליטה, וזה בדיוק הרגע לעצור.",
    internalLine:
      "כשהראש ממהר והגוף מתוח, קל מאוד לקרוא לדחף בשם של הזדמנות.",
    restoreLine: "תחזיר קודם שליטה, אחר כך תחזור להחלטה.",
    nextStepLine: "הצעד הבא: הפסקה קצרה, נשימה, ואז חזרה רק אם אתה שוב נקי.",
  };
}

export function buildCoachContext(input: CoachContextInput): CoachContext {
  const cooldownActive = Boolean(
    input.traderState?.needsCooldown &&
      input.traderState.cooldownUntil &&
      input.traderState.cooldownUntil > new Date(),
  );
  const sessionStarted = input.sessionLifecycle?.sessionStarted ?? false;
  const sessionEnded = input.sessionLifecycle?.sessionEnded ?? false;
  const sessionLifecycleState = sessionEnded
    ? "ENDED"
    : sessionStarted
      ? "ACTIVE"
      : "NOT_STARTED";

  return {
    primaryMarket: input.traderProfile?.primaryMarket ?? null,
    tradingStyle: input.traderProfile?.tradingStyle ?? null,
    accountSize: decimalToString(input.riskRules?.accountSize),
    maxDailyLoss: decimalToString(input.riskRules?.maxDailyLoss),
    riskPerTrade: decimalToString(input.riskRules?.riskPerTrade),
    maxTradesPerDay: input.riskRules?.maxTradesPerDay ?? null,
    stopAfterLosses: input.riskRules?.stopAfterLosses ?? null,
    primaryChallenge: input.mentalProfile?.primaryChallenge ?? null,
    tiltTrigger: input.mentalProfile?.tiltTrigger ?? null,
    tiltThought: input.mentalProfile?.tiltThought ?? null,
    coachingTone: input.mentalProfile?.coachingTone ?? null,
    interruptionStyle: input.mentalProfile?.interruptionStyle ?? null,
    responseStyle: input.mentalProfile?.responseStyle ?? null,
    premarketCheckinEnabled:
      input.coachingPreferences?.premarketCheckinEnabled ?? false,
    postmarketReviewEnabled:
      input.coachingPreferences?.postmarketReviewEnabled ?? false,
    checkinFormat: input.coachingPreferences?.checkinFormat ?? null,
    reviewFocus: input.coachingPreferences?.reviewFocus ?? null,
    newsAlertsEnabled: input.coachingPreferences?.newsAlertsEnabled ?? false,
    preNewsMinutes: input.coachingPreferences?.preNewsMinutes ?? null,
    highImpactOnly: input.coachingPreferences?.highImpactOnly ?? false,
    currentState: input.traderState?.currentState ?? TraderCurrentState.NONE,
    stateNotes: input.traderState?.stateNotes ?? null,
    recentLossStreak: input.traderState?.recentLossStreak ?? 0,
    needsCooldown: input.traderState?.needsCooldown ?? false,
    cooldownUntil: input.traderState?.cooldownUntil ?? null,
    cooldownActive,
    shouldInterruptHard:
      input.traderState?.currentState === TraderCurrentState.REVENGE ||
      input.traderState?.currentState === TraderCurrentState.TILTED ||
      cooldownActive,
    shouldStopTrading:
      (input.traderState?.recentLossStreak ?? 0) >= 2 ||
      input.traderState?.currentState === TraderCurrentState.JUST_TOOK_TWO_LOSSES,
    resetInProgress: input.traderState?.currentState === TraderCurrentState.RESETTING,
    calmRecovered: input.traderState?.currentState === TraderCurrentState.CALM,
    todaySessionSummary: input.todaySessionSummary ?? emptySessionSummary(),
    recentSessionEvents: input.recentSessionEvents ?? [],
    guardianEnabled: input.guardian?.guardianEnabled ?? false,
    currentLockoutActive: input.guardian?.currentLockoutActive ?? false,
    primaryGuardianReason: input.guardian?.primaryReason ?? null,
    primaryGuardianReasonLabel: input.guardian?.primaryReasonLabel ?? null,
    triggeredGuardianRules: input.guardian?.triggeredRules ?? [],
    triggeredGuardianRuleLabels: input.guardian?.triggeredRuleLabels ?? [],
    guardianActionGuidance: input.guardian?.actionGuidance ?? [],
    guardianResetMode: input.guardian?.resetMode ?? null,
    guardianResetTimezone: input.guardian?.resetTimezone ?? null,
    guardianNextAllowedResetAt: input.guardian?.nextAllowedResetAt ?? null,
    guardianLastResetAt: input.guardian?.lastResetAt ?? null,
    guardianResetAllowedNow: input.guardian?.resetAllowedNow ?? false,
    todaySessionStateKind: input.sessionLifecycle?.todaySessionStateKind ?? "READY_TO_TRADE",
    sessionLifecycleState,
    sessionStarted,
    sessionStartedAt: input.sessionLifecycle?.sessionStartedAt ?? null,
    sessionEnded,
    sessionEndedAt: input.sessionLifecycle?.sessionEndedAt ?? null,
    sessionLifecycleTimezone:
      input.sessionLifecycle?.resetTimezone ?? input.guardian?.resetTimezone ?? null,
    economicCalendar: {
      nextHighImpactEvent: input.economicCalendar?.nextHighImpactEvent ?? null,
      hasUpcomingHighImpactEvent:
        input.economicCalendar?.hasUpcomingHighImpactEvent ?? false,
      isInsidePreNewsWarningWindow:
        input.economicCalendar?.isInsidePreNewsWarningWindow ?? false,
      preNewsPolicy: input.economicCalendar?.preNewsPolicy ?? null,
    },
    manualActivity: input.manualActivity ?? null,
  };
}

export function detectCoachIntent(message: string): CoachIntent {
  const normalized = normalizeMessage(message);

  if (
    ["צק אין", "check in", "אני עומד לסחור", "premarket", "אני לפני מסחר"].some((pattern) =>
      normalized.includes(pattern.toLowerCase()),
    )
  ) {
    return "check_in";
  }

  if (
    ["סכם לי את היום", "review my day", "day summary", "סיכום יום"].some((pattern) =>
      normalized.includes(pattern.toLowerCase()),
    )
  ) {
    return "day_summary";
  }

  if (
    [
      "יש לי fomo",
      "אני בעצבים",
      "אני רוצה להחזיר את ההפסד",
      "אני רוצה להחזיר הפסד",
      "אני רוצה להחזיר",
      "אני חייב להחזיר את זה",
      "אני חייב להחזיר",
      "הפסדתי עכשיו",
      "הפסדתי פעמיים",
      "revenge",
      "tilted",
      "אני לא בשליטה",
    ].some((pattern) => normalized.includes(pattern.toLowerCase()))
  ) {
    return "emotional_distress";
  }

  if (
    [
      "כמה אני יכול לסכן",
      "מה המקסימום שלי היום",
      "מה ההפסד המקסימלי שלי",
      "מותר לי עוד עסקה",
      "how many trades can i take",
      "what is my daily loss limit",
    ].some((pattern) => normalized.includes(pattern.toLowerCase()))
  ) {
    return "rule_question";
  }

  return "generic_coaching";
}

/**
 * Produce 0-3 operational lines about today's manual trade activity.
 * Surfaces breach, consecutive loss streak, and PnL pressure.
 * Used in check-in, rule-question, and generic reply paths.
 */
function buildManualActivityStatusLines(
  context: CoachContext,
  options?: { include1LossStreak?: boolean },
): string[] {
  const m = context.manualActivity;
  if (!m) return [];

  const lines: string[] = [];

  if (m.hasRuleBreach) {
    lines.push("יש breach ידני שנרשם לסשן הזה.");
  }

  if (m.consecutiveLosses >= 2) {
    lines.push(`נרשמו ${m.consecutiveLosses} הפסדים ידניים ברצף היום.`);
  } else if (m.consecutiveLosses === 1 && options?.include1LossStreak) {
    lines.push("הפסד ידני אחד ברצף כרגע.");
  }

  if (m.netPnL !== null && m.netPnL < 0) {
    const maxLoss = context.maxDailyLoss ? parseFloat(context.maxDailyLoss) : null;
    if (maxLoss && Math.abs(m.netPnL) >= maxLoss * 0.6) {
      lines.push(`ה-PnL הידני מקרב אותך לגבול היומי (${m.netPnL}).`);
    }
  }

  return lines;
}

/**
 * Produce a compact win/loss/PnL/breach summary for the day-summary reply.
 * Only emits lines when manual trade activity was actually logged.
 */
function buildManualActivityDaySummaryLines(context: CoachContext): string[] {
  const m = context.manualActivity;
  if (!m || !m.tradeActivityLogged) return [];

  const lines: string[] = [];
  const parts: string[] = [];
  if (m.winCount > 0) parts.push(`${m.winCount} ניצחונות`);
  if (m.lossCount > 0) parts.push(`${m.lossCount} הפסדים`);
  if (parts.length > 0) {
    lines.push(`יומן ידני: ${parts.join(", ")}.`);
  }
  if (m.netPnL !== null) {
    lines.push(`PnL ידני: ${m.netPnL}.`);
  }
  if (m.hasRuleBreach) {
    lines.push("הפרת חוק ידנית נרשמה.");
  }
  return lines;
}

function buildCheckInReply(context: CoachContext) {
  const challenge = localizeTerm(context.primaryChallenge)?.toLowerCase();
  const prompts = context.checkinFormat?.toLowerCase().includes("conversation")
    ? [
        "מה הסטאפ שבאמת ראוי לתשומת הלב שלך היום?",
        "מה יגרום לך לשבת על הידיים במקום לכפות עסקה?",
        "איך תדע שאתה סוחר את התהליך ולא את מצב הרוח שלך?",
      ]
    : context.checkinFormat?.toLowerCase().includes("checklist")
      ? [
          "תגדיר את הסטאפ A+ ואת הפסילה שלו.",
          "תגדיר מראש מה גורם ליום ללא מסחר.",
          "תגיד בקול מה סוגר לך את היום אם המשמעת נשברת.",
        ]
      : [
          "למה אתה מחכה היום, בצורה מדויקת?",
          challenge
            ? `איפה ${challenge} הכי עלול להופיע היום?`
            : "איפה המשמעת הכי עלולה להישבר היום?",
          "מה האיפוס שלך אם העסקה הראשונה נגדך?",
        ];

  const economicEventLine = buildEconomicCalendarAwarenessLine(context);
  const lines = [
    buildModeOpening("PREMARKET_COACH", context, normalizeTone(context.coachingTone)),
    buildRuleLine(context),
    context.cooldownActive
      ? "לפני מסחר נוסף, אתה צריך להשלים איפוס. לא נכנסים רגשית."
      : "תקבל את הסיכון לפני הלחיצה, לא אחרי.",
    economicEventLine,
    context.shouldStopTrading
      ? "יש כבר רצף הפסדים חי. תכבד את חוק העצירה לפני כל מחשבה על עוד עסקה."
      : null,
    ...buildManualActivityStatusLines(context),
    ...prompts.slice(0, 3),
  ].filter(Boolean) as string[];

  return shapeLines(lines, context.responseStyle);
}

function buildDaySummaryReply(
  context: CoachContext,
  options?: { openingOverride?: string | null },
) {
  const summary = context.todaySessionSummary;
  const orderedEvents = [...context.recentSessionEvents].sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
  );
  const recentStates = orderedEvents.map((event) => event.traderState);
  const focusAreas = splitStoredList(context.reviewFocus);
  const prompts =
    focusAreas.length > 0
      ? focusAreas
          .slice(0, 3)
          .map((focus) => `איך ${localizeTerm(focus)?.toLowerCase()} נראה בפועל בהחלטות שלך היום?`)
      : [
          "איפה היום באמת סחרת נכון לפי התהליך?",
          "איפה עברת מתהליך לרגש?",
          "מה שווה לשחזר גם מחר?",
        ];

  const firstDistress = orderedEvents.find((event) =>
    event.traderState === TraderCurrentState.FOMO ||
      event.traderState === TraderCurrentState.REVENGE ||
      event.traderState === TraderCurrentState.TILTED ||
      event.traderState === TraderCurrentState.JUST_TOOK_LOSS ||
      event.traderState === TraderCurrentState.JUST_TOOK_TWO_LOSSES,
  );
  const hasFomo = recentStates.includes(TraderCurrentState.FOMO);
  const hasRevenge = recentStates.includes(TraderCurrentState.REVENGE);
  const hasReset = recentStates.includes(TraderCurrentState.RESETTING);
  const hasCalm = recentStates.includes(TraderCurrentState.CALM);
  const hasTwoLoss = recentStates.includes(TraderCurrentState.JUST_TOOK_TWO_LOSSES);
  const hasSingleLoss = recentStates.includes(TraderCurrentState.JUST_TOOK_LOSS);

  const summaryLine =
    firstDistress?.traderState === TraderCurrentState.FOMO
      ? "היום התחלת מפומו."
      : firstDistress?.traderState === TraderCurrentState.REVENGE
        ? "היום התחלת כבר מתוך ניסיון להחזיר הפסד."
        : firstDistress?.traderState === TraderCurrentState.JUST_TOOK_LOSS
          ? "היום קיבלת מכה, ומשם היה צריך להחזיר יציבות."
          : firstDistress?.traderState === TraderCurrentState.JUST_TOOK_TWO_LOSSES
            ? "היום הגעת מהר למצב שבו החוקים כבר דרשו עצירה."
            : firstDistress?.traderState === TraderCurrentState.TILTED
              ? "היום היה רגע שבו הרגש התחיל להוביל את ההחלטות."
              : summary.eventCount > 0
                ? "היום היה יחסית נקי, בלי החלקה משמעותית."
                : "היום כמעט לא נרשמו רגעים משמעותיים לשקף.";

  const escalationLine =
    hasFomo && hasRevenge
      ? "אחר כך זה כבר גלש לניסיון להחזיר הפסד."
      : hasSingleLoss && hasRevenge
        ? "אחרי ההפסד הראשון עוד היה חלון לעצור, אבל משם זה גלש לרדיפה."
        : hasTwoLoss
          ? "אחר כך כבר הגעת למצב שבו החוקים קבעו עצירה מלאה."
          : null;

  const recoveryLine =
    hasReset && hasCalm
      ? "בהמשך הצלחת להוריד עוצמה, להירגע, ולחזור לעצמך."
      : hasReset
        ? "בהמשך כן התחלת להוריד עוצמה, וזה היה חשוב."
        : summary.stayedUnstable
          ? "היום לא באמת חזרת לאיזון, וזה הדבר החשוב לראות."
          : null;
  const progressionLine =
    hasReset && hasCalm && summary.distressCount > 0
      ? "זה חשוב, כי לא נשארת כל היום בהחלקה."
      : null;

  const lines = [
    options?.openingOverride ??
      buildModeOpening("POSTMARKET_REVIEWER", context, normalizeTone(context.coachingTone)),
    summaryLine,
    escalationLine,
    recoveryLine,
    progressionLine,
    ...buildManualActivityDaySummaryLines(context),
    summary.distressCount > 0
      ? "מחר המטרה היא לזהות את הרגע שבו אתה מתחיל לרדוף, לפני שאתה כבר בפנים."
      : "מחר המטרה היא להישאר קרוב לתהליך גם כשהקצב עולה.",
    prompts[0] ?? "מה הדבר האחד שאתה לוקח עליו אחריות למחר?",
  ].filter(Boolean) as string[];

  return shapeLines(lines, context.responseStyle);
}

function buildEmotionalDistressReply(
  message: string,
  context: CoachContext,
  mode: CoachMode,
) {
  const tone: NormalizedTone = normalizeTone(context.coachingTone);
  const isRevengeLoss = isRevengeLossMessage(message);
  const behavior = resolveReplyBehavior("emotional_distress", context);
  const trigger = localizeTerm(context.tiltTrigger)?.toLowerCase();
  const thought = localizeTerm(context.tiltThought);
  const moment = getStateAwareMomentLines(message, context);
  const triggerLine =
    !isRevengeLoss && trigger
      ? `אתה מכיר את הנקודה הזאת: ${trigger}.`
      : moment.internalLine;
  const thoughtLine =
    !isRevengeLoss && thought && context.currentState !== TraderCurrentState.CALM
      ? `שים לב למחשבה "${thought}" ואל תיתן לה להוביל את ההחלטה הבאה.`
      : moment.restoreLine;
  const interruptionLine = buildInterruptionLine(context, mode);
  const cooldownLine = context.cooldownActive
    ? "כרגע יש לך קירור פעיל. אתה לא אמור לחפש כניסה, אתה אמור להוריד דופק."
    : null;
  const stopRuleLine = context.shouldStopTrading
    ? "יש לך כבר רצף הפסדים שמחייב עצירה. מבחינת חוקים, היום הזה לא נפתח לעוד ניסיון."
    : null;

  const economicEventLine = buildEconomicCalendarAwarenessLine(context);
  const lines = (
    tone === "TOUGH"
      ? [
          moment.openingLine,
          moment.mirrorLine,
          triggerLine,
          thoughtLine,
          economicEventLine,
          behavior === "HARD_STOP_POST_LOSS"
            ? "אין כאן עוד שאלה. החוקים כבר סגרו את המסחר להיום."
            : mode === "POST_LOSS_INTERRUPT"
            ? "אם אתה מנסה להחזיר עכשיו, זה כבר לא מסחר."
            : "זה הרגע שבו אסור לתת לדחף להתחפש לסטאפ.",
          cooldownLine,
          stopRuleLine,
          behavior === "HARD_STOP_POST_LOSS"
            ? "הצעד הבא: סוגרים מסך עכשיו. שום עסקה נוספת לא נפתחת."
            : mode === "POST_LOSS_INTERRUPT"
            ? moment.nextStepLine
            : interruptionLine,
        ]
      : tone === "CALM_SHARP"
        ? [
            moment.openingLine,
            moment.mirrorLine,
            triggerLine,
            thoughtLine,
            behavior === "HARD_STOP_POST_LOSS"
              ? "מכאן כבר לא מחפשים איך לחזור. מחפשים איך לעצור נכון."
              : mode === "POST_LOSS_INTERRUPT"
              ? "אתה לא צריך לתקן את היום הזה עכשיו."
              : "אתה לא צריך לפתור את הרגע הזה. אתה צריך לחזור לשליטה.",
            cooldownLine,
            stopRuleLine,
            behavior === "HARD_STOP_POST_LOSS"
              ? "החוקים כבר החליטו בשבילך שהיום נגמר."
              : mode === "POST_LOSS_INTERRUPT"
              ? moment.restoreLine
              : "קודם תחזיר שליטה, אחר כך תחזור לגרף.",
            behavior === "HARD_STOP_POST_LOSS"
              ? "הצעד הבא: סוגרים את הפלטפורמה ולא חוזרים היום."
              : mode === "POST_LOSS_INTERRUPT"
              ? moment.nextStepLine
              : interruptionLine,
          ]
        : tone === "SUPPORTIVE"
          ? [
              moment.openingLine,
              moment.mirrorLine,
              triggerLine,
              behavior === "HARD_STOP_POST_LOSS"
                ? "אתה לא צריך להילחם ביום הזה יותר."
                : mode === "POST_LOSS_INTERRUPT"
                ? "אתה לא צריך לתקן את היום הזה עכשיו."
                : "אתה לא חייב לפתור את ההרגשה הזאת עם עוד עסקה.",
              thoughtLine,
              economicEventLine,
              cooldownLine,
              stopRuleLine,
              behavior === "HARD_STOP_POST_LOSS"
                ? "הדבר הנכון עכשיו הוא לעצור, לא לנסות להציל."
                : mode === "POST_LOSS_INTERRUPT"
                ? moment.restoreLine
                : "תחזור רגע לנשימה ולקצב שלך.",
              behavior === "HARD_STOP_POST_LOSS"
                ? "הצעד הבא: תסגור מסך, תן לגוף להירגע, ואל תפתח עוד עסקה היום."
                : mode === "POST_LOSS_INTERRUPT"
                ? moment.nextStepLine
                : interruptionLine,
            ]
          : [
              moment.openingLine,
              moment.mirrorLine,
              triggerLine,
              thoughtLine,
              economicEventLine,
              cooldownLine,
              stopRuleLine,
              behavior === "HARD_STOP_POST_LOSS"
                ? "החוקים כבר לקחו את ההחלטה במקומך. עכשיו רק מכבדים אותה."
                : mode === "POST_LOSS_INTERRUPT"
                ? moment.restoreLine
                : "קודם תחזיר שליטה, אחר כך תחזור לגרף.",
              behavior === "HARD_STOP_POST_LOSS"
                ? "הצעד הבא: סוגרים מסך ולא ממשיכים את היום הזה."
                : mode === "POST_LOSS_INTERRUPT"
                ? moment.nextStepLine
                : interruptionLine,
            ]
  ).filter(Boolean) as string[];

  return shapeLines(lines, context.responseStyle);
}

function buildRuleQuestionReply(context: CoachContext) {
  const economicEventLine = buildEconomicCalendarAwarenessLine(context);
  const lines = [
    buildModeOpening("RULE_ENFORCER", context, normalizeTone(context.coachingTone)),
    economicEventLine,
    shapeRuleAnswer("סיכון לעסקה", context.riskPerTrade, "לא הוגדר"),
    shapeRuleAnswer("מקסימום הפסד יומי", context.maxDailyLoss, "לא הוגדר"),
    shapeRuleAnswer("מקסימום עסקאות", context.maxTradesPerDay, "לא הוגדר"),
    context.stopAfterLosses
      ? `אחרי ${context.stopAfterLosses} הפסדים אתה עוצר.`
      : "עצירה אחרי הפסדים: לא הוגדר",
    "אם הגעת לגבול, ההחלטה כבר התקבלה.",
    ...buildManualActivityStatusLines(context, { include1LossStreak: true }),
  ].filter(Boolean) as string[];

  return formatList(lines);
}

function buildGenericReply(context: CoachContext) {
  const challenge = localizeTerm(context.primaryChallenge)?.toLowerCase();
  const market = humanizeMarket(context.primaryMarket);
  const lines = [
    context.shouldInterruptHard
      ? "כרגע אתה לא במקום נקי. קודם חוזרים לשליטה."
      : null,
    context.calmRecovered
      ? "טוב. חזרת לשליטה. עכשיו שומרים על זה ולא ממהרים להוכיח כלום."
      : null,
    context.tradingStyle
      ? "תסחור כמו הגרסה הממושמעת שלך, לא כמו הגרסה הרגשית שלך."
      : market
        ? `תסחור את ${market} עם תהליך, לא עם לחץ.`
        : "תסחור את התוכנית, לא את הלחץ.",
    challenge
      ? `איפה אתה נוטה ליפול ב-${challenge}? תזהה את זה מוקדם ואל תיתן לזה לנהל אותך.`
      : "שים לב לרגע שבו הרגש מתחיל לנהל אותך. אל תיתן לזה להוביל.",
    context.shouldStopTrading
      ? "יש כרגע רצף הפסדים חי. החוקים כבר החליטו שהצעד הבא הוא עצירה."
      : null,
    context.resetInProgress
      ? "אתה באיפוס. אל תמהר להכריז שחזרת לפני שהגוף והראש באמת נרגעו."
      : null,
    ...buildManualActivityStatusLines(context),
    "תישאר עם התהליך. תן רק לסטאפ ברור להרוויח את תשומת הלב שלך.",
    buildRuleLine(context),
  ].filter(Boolean) as string[];

  return shapeLines(lines, context.responseStyle);
}

function buildResetSupportReply(message: string, context: CoachContext) {
  const moment = getStateAwareMomentLines(message, context);
  const lines = [
    moment.openingLine,
    moment.mirrorLine,
    moment.internalLine,
    "עוד לא ממהרים לחזור.",
    "קודם בודקים אם באמת חזרת לשקט.",
    moment.nextStepLine,
  ];

  return shapeLines(lines, context.responseStyle);
}

function buildReturnToProcessReply(message: string, context: CoachContext) {
  const moment = getStateAwareMomentLines(message, context);
  const lines = [
    moment.openingLine,
    moment.mirrorLine,
    moment.internalLine,
    "מפה חוזרים רק לתהליך, לא להוכיח כלום.",
    "אם חוזרים, אז רק לסטאפ ברור וסיכון מוגדר.",
    moment.nextStepLine,
  ];

  return shapeLines(lines, context.responseStyle);
}

function buildGuardianTriggeredRulesLine(context: CoachContext) {
  const additionalRules = context.triggeredGuardianRules
    .slice(1)
    .map((reason) => localizeGuardianRuleLabel(reason));

  return additionalRules.length
    ? `נפגעו גם הגבולות האלה: ${additionalRules.join(", ")}.`
    : null;
}

function buildGuardianActionLines(context: CoachContext) {
  if (context.guardianActionGuidance.length === 0) {
    return [
      "אין עוד עסקאות להיום.",
      "מכאן רק סוגרים את היום בצורה נקייה.",
    ];
  }

  return [
    "אין עוד עסקאות להיום.",
    context.guardianResetMode === "MANUAL"
      ? "היום הזה נשאר סגור עד לאיפוס ידני מותר."
      : "היום הזה נשאר סגור עד לחלון האיפוס הבא.",
    "מכאן עוברים לסגירה מסודרת, לא לעוד החלטת מסחר.",
  ];
}

function buildGuardianResetWindowLine(context: CoachContext) {
  if (context.guardianResetMode === "MANUAL") {
    return "המסחר יישאר סגור עד שתבצע איפוס ידני מותר.";
  }

  const formattedResetAt = formatGuardianResetAt(
    context.guardianNextAllowedResetAt,
    context.guardianResetTimezone,
  );

  return formattedResetAt
    ? `אפשר לבדוק מחדש רק ב-${formattedResetAt}.`
    : "אפשר לבדוק מחדש רק בחלון האיפוס הבא.";
}

function buildGuardianLockoutReply(message: string, intent: CoachIntent, context: CoachContext) {
  const localizedReason = localizeGuardianReason(context.primaryGuardianReason);
  const additionalRulesLine = buildGuardianTriggeredRulesLine(context);
  const actionLines = buildGuardianActionLines(context);

  if (intent === "day_summary") {
    const orderedEvents = [...context.recentSessionEvents].sort(
      (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
    );
    const recentStates = orderedEvents.map((event) => event.traderState);
    const distressStates = new Set<TraderCurrentState>([
      TraderCurrentState.FOMO,
      TraderCurrentState.REVENGE,
      TraderCurrentState.TILTED,
      TraderCurrentState.JUST_TOOK_LOSS,
      TraderCurrentState.JUST_TOOK_TWO_LOSSES,
    ]);
    const firstDistress = orderedEvents.find((event) =>
      distressStates.has(event.traderState),
    );
    const hasFomo = recentStates.includes(TraderCurrentState.FOMO);
    const hasRevenge = recentStates.includes(TraderCurrentState.REVENGE);
    const hasReset = recentStates.includes(TraderCurrentState.RESETTING);
    const hasCalm = recentStates.includes(TraderCurrentState.CALM);

    const lines = [
      "בוא נסכם את היום בצורה נקייה.",
      firstDistress?.traderState === TraderCurrentState.FOMO
        ? "היום התחלת מלחץ ופומו."
        : firstDistress?.traderState === TraderCurrentState.REVENGE
          ? "היום התחלת כבר מתוך צורך להחזיר הפסד."
          : firstDistress?.traderState === TraderCurrentState.JUST_TOOK_LOSS
            ? "היום התחיל במכה, ומשם היית צריך להחזיר יציבות."
            : firstDistress?.traderState === TraderCurrentState.JUST_TOOK_TWO_LOSSES
              ? "היום הגעת מהר למצב שבו החוקים דרשו עצירה."
              : firstDistress?.traderState === TraderCurrentState.TILTED
                ? "היום היה רגע שבו הרגש התחיל להוביל את ההחלטות."
                : "היום נסגר תחת משמעת והגנה, וזה הנתון החשוב.",
      hasFomo && hasRevenge
        ? "אחר כך זה גלש מפומו לניסיון להחזיר הפסד."
        : hasRevenge
          ? "אחר כך זה הפך לרדיפה אחרי ההפסד."
          : null,
      hasReset && hasCalm
        ? "בהמשך הצלחת להוריד עוצמה, להירגע, ולחזור לעצמך."
        : hasReset
          ? "בהמשך כן התחלת להוריד עוצמה, וזה היה חשוב."
          : null,
      `בסוף Guardian סגר את היום: ${localizedReason}`,
      buildGuardianResetWindowLine(context),
      additionalRulesLine,
      "זה אומר שהיום הזה נסגר, גם אם בהמשך הרגשת יותר בשליטה.",
      "מחר המטרה היא לזהות את רגע ההידרדרות לפני שהמערכת צריכה לעצור אותך.",
    ].filter(Boolean) as string[];

    return shapeLines(lines, context.responseStyle);
  }

  if (intent === "rule_question") {
    const lines = [
      "לא. אין יותר עסקאות היום.",
      `היום נסגר כי ${localizedReason}`,
      buildGuardianResetWindowLine(context),
      additionalRulesLine,
      shapeRuleAnswer("סיכון לעסקה", context.riskPerTrade, "לא הוגדר"),
      shapeRuleAnswer("מקסימום הפסד יומי", context.maxDailyLoss, "לא הוגדר"),
      shapeRuleAnswer("מקסימום עסקאות", context.maxTradesPerDay, "לא הוגדר"),
      context.stopAfterLosses
        ? `אחרי ${context.stopAfterLosses} הפסדים אתה עוצר.`
        : "עצירה אחרי הפסדים: לא הוגדר",
      ...actionLines.slice(0, 2),
    ].filter(Boolean) as string[];

    return formatList(lines);
  }

  if (intent === "emotional_distress") {
    const lines = [
      "עצור כאן.",
      `היום סגור למסחר. ${localizedReason}`,
      buildGuardianResetWindowLine(context),
      additionalRulesLine,
      isRevengeLossMessage(message)
        ? "אתה לא צריך עכשיו עוד החלטת מסחר. מה שצריך עכשיו זה לעצור את הרדיפה."
        : context.currentState === TraderCurrentState.FOMO
          ? "הפומו כבר לא מנהל את ההחלטה עכשיו. אין עוד כניסה לקחת."
          : context.currentState === TraderCurrentState.TILTED ||
              normalizeMessage(message).includes("אני לא בשליטה")
            ? "כרגע לא פותרים את זה דרך עוד עסקה. עוצרים, מתנתקים, ויורדים בעומס."
            : "כרגע לא מחפשים עוד החלטה. מחזיקים את הגבול.",
      "השלב הבא הוא לסגור את הסשן כמו שצריך.",
      ...actionLines,
    ].filter(Boolean) as string[];

    return shapeLines(lines, context.responseStyle);
  }

  if (
    context.currentState === TraderCurrentState.RESETTING ||
    context.currentState === TraderCurrentState.CALM
  ) {
    const lines = [
      context.currentState === TraderCurrentState.CALM
        ? "טוב שחזרת לשליטה."
        : "טוב שהעוצמה ירדה.",
      "זה חשוב, אבל זה לא פותח מחדש את המסחר.",
      `היום עדיין סגור כי ${localizedReason}`,
      buildGuardianResetWindowLine(context),
      additionalRulesLine,
      "התאוששות רגשית לא מבטלת את הגבול שנקבע.",
      ...actionLines,
    ].filter(Boolean) as string[];

    return shapeLines(lines, context.responseStyle);
  }

  const lines = [
    "היום סגור למסחר.",
    localizedReason,
    buildGuardianResetWindowLine(context),
    additionalRulesLine,
    "אין חזרה לעוד עסקה בסשן הזה.",
    ...actionLines,
  ].filter(Boolean) as string[];

  return shapeLines(lines, context.responseStyle);
}

function buildOnboardingRequiredReply(intent: CoachIntent, context: CoachContext) {
  const lines =
    intent === "day_summary"
      ? [
          "הסשן עוד לא התחיל.",
          "מלא את תהליך ההשקה מהדשבורד לפני שיש מה לפתוח או לסכם.",
        ]
      : intent === "rule_question"
        ? [
            "עוד אי אפשר לפתוח את הסשן.",
            "מלא את תהליך ההשקה מהדשבורד, ואז החוקים שלך נכנסים לתוקף.",
          ]
        : [
            "הסשן עוד לא מוכן להתחיל.",
            "מלא את תהליך ההשקה מהדשבורד, ואז פותחים סשן נקי.",
          ];

  return shapeLines(lines, context.responseStyle);
}

function buildGuardianDisabledReply(intent: CoachIntent, context: CoachContext) {
  const lines =
    intent === "day_summary"
      ? [
          "הסשן עדיין לא התחיל.",
          "Guardian כבוי כרגע. הפעל אותו מהדשבורד לפני שממשיכים.",

        ]
      : intent === "rule_question"
        ? [
            "אלה הגבולות שלך, אבל Guardian כבוי כרגע.",
            buildRuleLine(context),
            "לפני שמתחילים, מפעילים אותו מהדשבורד כדי שהסשן יתחיל תחת הגנה.",
          ]
        : [
            "Guardian כבוי כרגע.",
            "עוד לא פתחת את הסשן. הפעל את Guardian מהדשבורד ואז נחזור לזה.",
          ];

  return shapeLines(lines.filter(Boolean) as string[], context.responseStyle);
}

function buildNotStartedSessionReply(intent: CoachIntent, context: CoachContext) {
  if (intent === "day_summary") {
    return shapeLines(
      [
        "הסשן עוד לא התחיל.",
        "אין מה לסכם לפני שמתחילים את הסשן מהדשבורד.",
      ],
      context.responseStyle,
    );
  }

  if (intent === "rule_question") {
    return formatList([
      "הסשן עוד לא התחיל.",
      buildPreNewsSessionAdvice(context),
      shapeRuleAnswer("סיכון לעסקה", context.riskPerTrade, "לא הוגדר"),
      shapeRuleAnswer("מקסימום הפסד יומי", context.maxDailyLoss, "לא הוגדר"),
      shapeRuleAnswer("מקסימום עסקאות", context.maxTradesPerDay, "לא הוגדר"),
      context.stopAfterLosses
        ? `אחרי ${context.stopAfterLosses} הפסדים אתה עוצר.`
        : "עצירה אחרי הפסדים: לא הוגדר",
    ]);
  }

  if (intent === "emotional_distress") {
    return shapeLines(
      [
        "הסשן עוד לא התחיל.",
        "אל תיכנס ישר מתוך הלחץ הזה.",
        "קודם פותחים את הסשן מהדשבורד, ואז ממשיכים כאן.",
      ],
      context.responseStyle,
    );
  }

  if (intent === "check_in") {
    return shapeLines(
      [
        "הסשן עוד לא התחיל.",
        buildPreNewsSessionAdvice(context),
      ],
      context.responseStyle,
    );
  }

  return shapeLines(
    [
      "הסשן עוד לא התחיל.",
      buildPreNewsSessionAdvice(context),
    ],
    context.responseStyle,
  );
}

function buildEndedSessionReply(intent: CoachIntent, context: CoachContext) {
  const endedAt = formatSessionLifecycleAt(
    context.sessionEndedAt,
    context.sessionLifecycleTimezone,
  );

  if (intent === "day_summary") {
    return buildDaySummaryReply(context, {
      openingOverride: endedAt
        ? `הסשן כבר נסגר ב-${endedAt}. בוא נסכם אותו נקי.`
        : "הסשן כבר נסגר. בוא נסכם אותו נקי.",
    });
  }

  if (intent === "rule_question") {
    return formatList([
      endedAt ? `הסשן כבר נסגר ב-${endedAt}.` : "הסשן כבר נסגר.",
      shapeRuleAnswer("סיכון לעסקה", context.riskPerTrade, "לא הוגדר"),
      shapeRuleAnswer("מקסימום הפסד יומי", context.maxDailyLoss, "לא הוגדר"),
      shapeRuleAnswer("מקסימום עסקאות", context.maxTradesPerDay, "לא הוגדר"),
      context.stopAfterLosses
        ? `אחרי ${context.stopAfterLosses} הפסדים אתה עוצר.`
        : "עצירה אחרי הפסדים: לא הוגדר",
      "מכאן נשארים במצב של סיכום ובדיקה, לא בביצוע.",
    ]);
  }

  if (intent === "emotional_distress") {
    return shapeLines(
      [
        endedAt ? `הסשן כבר נסגר ב-${endedAt}.` : "הסשן כבר נסגר.",
        "עכשיו לא מתקנים את היום דרך עוד עסקה.",
        "אם משהו דורש תשומת לב עכשיו, זה מה שקרה היום ולא כניסה חדשה.",
      ],
      context.responseStyle,
    );
  }

  if (intent === "check_in") {
    return shapeLines(
      [
        endedAt ? `הסשן כבר נסגר ב-${endedAt}.` : "הסשן כבר נסגר.",
        "מכאן נשארים בסיכום ובבדיקה, לא בפתיחה מחדש של הסשן.",
      ],
      context.responseStyle,
    );
  }

  return shapeLines(
    [
      endedAt ? `הסשן כבר נסגר ב-${endedAt}.` : "הסשן כבר נסגר.",
      "מכאן נשארים במצב של סיכום ובדיקה, לא בחיפוש עסקה חדשה.",
    ],
    context.responseStyle,
  );
}

function buildSessionLifecycleReply(
  message: string,
  intent: CoachIntent,
  context: CoachContext,
) {
  void message;

  if (context.currentLockoutActive) {
    return null;
  }

  if (context.sessionLifecycleState === "ENDED") {
    return buildEndedSessionReply(intent, context);
  }

  if (context.todaySessionStateKind === "ONBOARDING_REQUIRED") {
    return buildOnboardingRequiredReply(intent, context);
  }

  if (context.todaySessionStateKind === "GUARDIAN_DISABLED") {
    return buildGuardianDisabledReply(intent, context);
  }

  if (context.sessionLifecycleState === "NOT_STARTED") {
    return buildNotStartedSessionReply(intent, context);
  }

  return null;
}

export function generateCoachReply(message: string, context: CoachContext) {
  const intent = detectCoachIntent(message);
  const mode = resolveCoachMode(intent, message, context);
  const behavior = resolveReplyBehavior(intent, context);
  const sessionLifecycleReply =
    behavior === "SESSION_LIFECYCLE"
      ? buildSessionLifecycleReply(message, intent, context)
      : null;

  const reply =
    behavior === "GUARDIAN_LOCKOUT"
      ? buildGuardianLockoutReply(message, intent, context)
      : sessionLifecycleReply
        ? sessionLifecycleReply
      : behavior === "RESET_SUPPORT"
      ? buildResetSupportReply(message, context)
      : behavior === "RETURN_TO_PROCESS"
        ? buildReturnToProcessReply(message, context)
        : intent === "check_in"
      ? buildCheckInReply(context)
      : intent === "day_summary"
        ? buildDaySummaryReply(context)
        : intent === "emotional_distress"
          ? buildEmotionalDistressReply(message, context, mode)
          : intent === "rule_question"
            ? buildRuleQuestionReply(context)
            : buildGenericReply(context);

  return {
    intent,
    mode,
    behavior,
    reply,
  };
}
