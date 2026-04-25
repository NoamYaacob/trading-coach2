export const SUPPORTED_LANGUAGES = ["he", "en", "es", "fr", "de", "ru", "ar"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export type BotLocale = {
  keyboard: {
    checkIn: string;
    fomo: string;
    angry: string;
    outOfControl: string;
    dragged: string;
    revenge: string;
    stopMe: string;
    backInControl: string;
    daySummary: string;
    ruleLimits: string;
    remaining: string;
  };
  system: {
    invalidLink: string;
    connectSuccess: string;
    connectSuccessNoAccess: string;
    connectSuccessIncomplete: string;
    notLinked: string;
    onboardingIncomplete: string;
    accessInactive: string;
    inputPlaceholder: string;
    languageUpdated: string;
  };
  prompts: {
    sessionNotStarted: string;
    checkIn: string;
    review: string;
  };
  coaching: {
    loss: string;
    fomo: string;
    anger: string;
    noSetup: string;
    revenge: string;
    overtrading: string;
    warning: string;
    discipline: string;
  };
  commands: {
    welcome: string;
    help: string;
    unknownCommand: string;
  };
  factual: {
    markets: { FUTURES: string; US_EQUITIES: string; FOREX: string; CRYPTO: string };
    sessions: Record<string, string>;
    marketOpen: string;
    marketOpenSession: string;
    marketOpenNoClose: string;
    marketClosed: string;
    marketClosedNextOpen: string;
    noMarketData: string;
    noLimitsConfigured: string;
    dailyLossLimitLine: string;
    maxTradesLine: string;
    stopAfterLossesLine: string;
    lossRemainingUsed: string;
    lossRemainingFull: string;
    tradesCountLine: string;
    consecutiveLossesLine: string;
    dailyLossLimitHit: string;
    maxTradesHit: string;
    maxTradesHitGeneric: string;
    consecutiveLossesHit: string;
    consecutiveLossesHitGeneric: string;
    sessionEnded: string;
    guardianLocked: string;
    preNewsBlock: string;
    tradingBlocked: string;
    noTradingData: string;
    tradingAllowed: string;
    tradesRemaining: string;
    lossBudgetRemaining: string;
  };
};
