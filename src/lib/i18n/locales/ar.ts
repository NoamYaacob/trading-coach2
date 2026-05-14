import type { BotLocale } from "../types";

export const ar: BotLocale = {
  keyboard: {
    checkIn: "تسجيل الوصول",
    fomo: "لديّ FOMO",
    angry: "أنا غاضب",
    outOfControl: "فقدت السيطرة",
    dragged: "انجررت للتداول",
    revenge: "أريد استرداد خسارتي",
    stopMe: "أوقفني",
    backInControl: "استعدت السيطرة",
    daySummary: "ملخص اليوم",
    ruleLimits: "حدودي اليوم",
    remaining: "كم تبقى لي اليوم؟",
  },
  system: {
    invalidLink:
      "هذا الرابط غير صالح أو منتهي الصلاحية. يرجى إنشاء رابط جديد من لوحة التحكم.",
    connectSuccess: "تم ربط تيليغرام بنجاح. وصول التدريب نشط.",
    connectSuccessNoAccess:
      "تم ربط تيليغرام، لكن الوصول غير نشط. تحتاج إلى خطة أو فترة تجريبية نشطة.",
    connectSuccessIncomplete:
      "تم ربط تيليغرام. أكمل الإعداد على الموقع قبل استخدام البوت.",
    notLinked:
      "حساب تيليغرام هذا غير مرتبط. اربطه من لوحة التحكم على الموقع.",
    onboardingIncomplete:
      "حسابك مرتبط لكن الإعداد غير مكتمل. أكمله على الموقع.",
    accessInactive: "وصولك غير نشط. فعّل خطة على الموقع للمتابعة.",
    inputPlaceholder: "إجراء سريع أو رسالة...",
    languageUpdated: "تم تحديث اللغة إلى العربية.",
  },
  prompts: {
    sessionNotStarted: "لم تبدأ الجلسة بعد. جاهز متى كنت مستعداً.",
    checkIn: "كيف تشعر قبل جلسة اليوم؟",
    review: "كيف كان يومك؟ ماذا تعلمت؟",
  },
  coaching: {
    loss: "حدثت خسارة. خذ نفساً وفكر قبل خطوتك التالية.",
    fomo: "الـ FOMO عدو الانضباط. السوق يعود دائماً.",
    anger: "التداول غاضباً يكلف أموالاً حقيقية. ابتعد الآن.",
    noSetup: "لا إعداد، لا دخول. هذا هو الانضباط.",
    revenge: "تداول الانتقام يدمر الحسابات. صفقتك التالية يجب أن تكون نظيفة.",
    overtrading: "المزيد من الصفقات يعني أقل سيطرة. الأقل أفضل.",
    warning: "انتبه، أنت تقترب من حدك.",
    discipline: "قواعدك موجودة لسبب. التزم بها.",
  },
  commands: {
    welcome:
      "مرحباً بك في Guardrail Coach. استخدم القائمة أدناه أو اكتب رسالة. /checkin لبدء يومك، /review لمراجعة نهاية اليوم، /limits لحدودك، /help لجميع الأوامر.",
    help:
      "الأوامر المتاحة:\n/checkin — تسجيل دخول ما قبل الجلسة\n/review — مراجعة نهاية اليوم\n/limits — حدود المخاطر اليوم\n/help — هذه الرسالة\n\nأو فقط اكتب كيف تشعر وسيرد المدرب.",
    unknownCommand:
      "لم أتعرف على هذا الأمر. استخدم /help لرؤية ما هو متاح، أو فقط اكتب رسالة.",
  },
  factual: {
    markets: { FUTURES: "العقود الآجلة", US_EQUITIES: "الأسهم الأمريكية", FOREX: "فوركس", CRYPTO: "كريبتو" },
    sessions: {
      Globex: "جلوبكس", "Pre-Market": "ما قبل السوق", "NYSE / NASDAQ": "NYSE / NASDAQ",
      "After-Hours": "ما بعد السوق", Asia: "آسيا", London: "لندن", NY: "NY",
      Forex: "فوركس", "24/7": "24/7",
    },
    marketOpen: "{name} مفتوح. يغلق {time}.",
    marketOpenSession: "{name} مفتوح. {session}. يغلق {time}.",
    marketOpenNoClose: "{name} مفتوح.",
    marketClosed: "{name} مغلق.",
    marketClosedNextOpen: "{name} مغلق. يفتح {time}.",
    noMarketData: "لا تتوفر بيانات عن ساعات السوق.",
    noLimitsConfigured: "لم يتم تعيين أي حدود.",
    dailyLossLimitLine: "حد الخسارة اليومية: {amount}.",
    maxTradesLine: "الحد الأقصى للصفقات: {limit}.",
    stopAfterLossesLine: "توقف بعد {limit} خسائر متتالية.",
    lossRemainingUsed: "{amount} المتبقي من حد الخسارة اليومية.",
    lossRemainingFull: "{amount} متاح — لا توجد خسائر حتى الآن.",
    tradesCountLine: "الصفقات: {count} من {limit}.",
    consecutiveLossesLine: "الخسائر المتتالية: {count} من {limit}.",
    dailyLossLimitHit: "تم الوصول لحد الخسارة اليومية. تم إيقاف التداول لهذا اليوم.",
    maxTradesHit: "تم الوصول لـ {limit} صفقات اليوم. لا مزيد من الدخولات.",
    maxTradesHitGeneric: "تم الوصول للحد اليومي للصفقات. لا مزيد من الدخولات.",
    consecutiveLossesHit: "{limit} خسائر متتالية — تم الوصول للحد. توقف الآن.",
    consecutiveLossesHitGeneric: "تم الوصول لحد الخسائر المتتالية. توقف الآن.",
    sessionEnded: "انتهت جلسة اليوم. انتظر حتى الغد.",
    guardianLocked: "الحساب مقفل. التداول موقوف.",
    preNewsBlock: "التداول محظور — حدث اقتصادي كبير.",
    tradingBlocked: "التداول متوقف الآن.",
    noTradingData: "لا تتوفر بيانات عن حالة التداول.",
    tradingAllowed: "يمكنك التداول.",
    tradesRemaining: "{count} صفقة متبقية.",
    lossBudgetRemaining: "{amount} ميزانية خسارة متبقية.",
  },
};
