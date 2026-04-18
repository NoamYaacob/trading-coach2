import type { BotLocale } from "../types";

export const en: BotLocale = {
  keyboard: {
    checkIn: "Check In",
    fomo: "I have FOMO",
    revenge: "I want revenge",
    justLost: "I just lost",
    lostTwice: "Lost twice",
    angry: "I'm angry",
    outOfControl: "Out of control",
    calmingDown: "Calming down",
    backInControl: "Back in control",
    daySummary: "Day summary",
    ruleLimits: "My limits today",
  },
  system: {
    invalidLink:
      "This link is invalid or expired. Please create a fresh Telegram connection link from your website dashboard.",
    connectSuccess: "Telegram connected successfully. Bot coaching access is active.",
    connectSuccessNoAccess:
      "Telegram connected successfully, but access is inactive. You need an active trial or plan to use the coach.",
    connectSuccessIncomplete:
      "Telegram connected successfully. Complete onboarding on the website before using the coach.",
    notLinked:
      "This Telegram account is not linked yet. Please connect Telegram from your website dashboard first.",
    onboardingIncomplete:
      "Your Telegram account is connected, but onboarding is incomplete. Please complete onboarding on the website first.",
    accessInactive:
      "Your coaching access is inactive. Please start an active trial or plan on the website to continue.",
    inputPlaceholder: "Quick action or message...",
    languageUpdated: "Language updated to English.",
  },
  prompts: {
    sessionNotStarted: "Session hasn't started yet. Ready when you are.",
    checkIn: "How are you feeling before today's session?",
    review: "How was your day? What did you learn?",
  },
  coaching: {
    loss: "A loss happened. Breathe and think before your next move.",
    fomo: "FOMO is the enemy of discipline. The market will always return.",
    anger: "Trading angry costs real money. Step away now.",
    noSetup: "No setup means no trade. That's what discipline looks like.",
    revenge: "Revenge trading destroys accounts. Your next trade must be clean.",
    overtrading: "More trades means less control. Do less, gain more.",
    warning: "Heads up — you're approaching your limit.",
    discipline: "Your rules exist for a reason. Honor them.",
  },
};
