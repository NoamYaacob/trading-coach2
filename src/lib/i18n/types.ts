export const SUPPORTED_LANGUAGES = ["he", "en", "es", "fr", "de", "ru", "ar"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export type BotLocale = {
  keyboard: {
    checkIn: string;
    fomo: string;
    revenge: string;
    justLost: string;
    lostTwice: string;
    angry: string;
    outOfControl: string;
    calmingDown: string;
    backInControl: string;
    daySummary: string;
    ruleLimits: string;
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
};
