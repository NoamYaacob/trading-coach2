import type { BotLocale } from "../types";

export const he: BotLocale = {
  keyboard: {
    checkIn: "צ'ק אין",
    fomo: "יש לי FOMO",
    angry: "אני בעצבים",
    outOfControl: "אני לא בשליטה",
    dragged: "נגררתי",
    revenge: "אני רוצה להחזיר הפסד",
    stopMe: "עצור אותי",
    backInControl: "חזרתי לשליטה",
    daySummary: "סכם לי את היום",
    ruleLimits: "מה המקסימום שלי היום?",
    remaining: "כמה נשאר לי היום?",
  },
  system: {
    invalidLink:
      "הקישור לא תקין או פג תוקפו. צור קישור חדש לטלגרם מדף ההגדרות באתר.",
    connectSuccess: "הטלגרם חובר בהצלחה. הגישה לבוט הקואצ'ינג פעילה.",
    connectSuccessNoAccess:
      "הטלגרם חובר בהצלחה, אבל הגישה אינה פעילה. יש להפעיל תוכנית או ניסיון פעיל.",
    connectSuccessIncomplete:
      "הטלגרם חובר בהצלחה. השלם את ה-Onboarding באתר לפני השימוש בבוט.",
    notLinked:
      "חשבון הטלגרם הזה לא מחובר עדיין. חבר אותו מדף ההגדרות באתר.",
    onboardingIncomplete:
      "חשבון הטלגרם מחובר, אבל ה-Onboarding לא הושלם. השלם אותו באתר.",
    accessInactive:
      "הגישה לקואצ'ינג אינה פעילה. הפעל תוכנית באתר כדי להמשיך.",
    inputPlaceholder: "בחר פעולה מהירה או כתוב הודעה...",
    languageUpdated: "שפת הממשק עודכנה לעברית.",
  },
  prompts: {
    sessionNotStarted: "הסשן עדיין לא התחיל. מוכן כשאתה מוכן.",
    checkIn: "מה אתה מביא היום לשוק?",
    review: "איך היה היום? מה לקחת ממנו?",
  },
  coaching: {
    loss: "קרה. זה לא חייב להפוך ליום שבור.",
    fomo: "לא כל תנועה היא שלך. לפספס זה לא נעים, אבל לרדוף אחריו — זה מה שהורס יום.",
    anger: "אתה חם עכשיו. במצב הזה לא חייבים לקבל עוד החלטה. קודם מורידים רעש, אחר כך חושבים.",
    noSetup: "אין סטאפ — אין כניסה. זו הדיסציפלינה.",
    revenge: "הדחף להחזיר חזק — זה מובן. אבל לא מחזירים ממצב הזה, רק מעמיקים. עוצרים כאן.",
    overtrading: "יותר עסקאות = פחות שליטה. פחות זה יותר.",
    warning: "אתה מתקרב לגבול שלך. שים לב.",
    discipline: "בסדר. עוצרים רגע. מה הצעד הבטוח הבא?",
  },
  commands: {
    welcome:
      "ברוך הבא לGuardrail Coach. השתמש בתפריט למטה או כתוב הודעה. /checkin לתחילת יום, /review לסיכום יומי, /limits לגבולות שלך, /help לכל הפקודות.",
    help:
      "פקודות זמינות:\n/checkin — צ'ק אין לפני הסשן\n/review — סיכום סוף יום\n/limits — גבולות הסיכון שלך היום\n/help — הודעה זו\n\nאו פשוט כתוב איך אתה מרגיש והקואצ' יגיב.",
    unknownCommand:
      "לא זיהיתי את הפקודה הזו. השתמש ב-/help לרשימת הפקודות, או פשוט כתוב הודעה.",
  },
  factual: {
    markets: { FUTURES: "פיוצ'רס", US_EQUITIES: "מניות", FOREX: "פורקס", CRYPTO: "קריפטו" },
    sessions: {
      Globex: "גלובקס", "Pre-Market": "פרי-מרקט", "NYSE / NASDAQ": "NYSE / NASDAQ",
      "After-Hours": "אפטר-האוורס", Asia: "אסיה", London: "לונדון", NY: "NY",
      Forex: "פורקס", "24/7": "24/7",
    },
    marketOpen: "{name} פתוח. סגירה אצלך: {time}.",
    marketOpenSession: "{name} פתוח. {session}. סגירה אצלך: {time}.",
    marketOpenNoClose: "{name} פתוח.",
    marketClosed: "{name} סגור.",
    marketClosedNextOpen: "{name} סגור. הפתיחה הבאה אצלך: {time}.",
    noMarketData: "אין מידע על שעות מסחר.",
    noLimitsConfigured: "לא הוגדרו גבולות.",
    dailyLossLimitLine: "גבול הפסד יומי: {amount}.",
    maxTradesLine: "מקסימום עסקאות: {limit}.",
    stopAfterLossesLine: "עצירה אחרי {limit} הפסדות ברצף.",
    lossRemainingUsed: "נשאר לך {amount} להפסד יומי.",
    lossRemainingFull: "לא הפסדת עדיין. יש לך {amount} מלאים.",
    tradesCountLine: "עסקאות: {count} מתוך {limit}.",
    consecutiveLossesLine: "הפסדות ברצף: {count} מתוך {limit}.",
    dailyLossLimitHit: "הגעת לסטופ היומי. המסחר להיום נעצר.",
    maxTradesHit: "הגעת ל-{limit} עסקאות היום. לא פותחים עוד עסקה.",
    maxTradesHitGeneric: "הגעת למגבלת העסקאות היומית. לא פותחים עוד עסקה.",
    consecutiveLossesHit: "{limit} הפסדות ברצף — הגעת לגבול. עוצרים להיום.",
    consecutiveLossesHitGeneric: "הגעת למגבלת ההפסדות ברצף. עוצרים להיום.",
    sessionEnded: "הסשן היומי נסגר. מחכים למחר.",
    guardianLocked: "חשבון ננעל. המסחר מושעה.",
    preNewsBlock: "מסחר חסום לפני אירוע מאקרו.",
    tradingBlocked: "מסחר מעוצר כרגע.",
    noTradingData: "אין מידע על מצב המסחר.",
    tradingAllowed: "אפשר לסחור.",
    tradesRemaining: "נשאר {count} עסקאות.",
    lossBudgetRemaining: "{amount} להפסד יומי.",
  },
};
