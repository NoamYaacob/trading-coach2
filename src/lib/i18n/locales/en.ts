import type { BotLocale } from "../types";

export const en: BotLocale = {
  keyboard: {
    checkIn: "Check In",
    fomo: "I have FOMO",
    angry: "I'm angry",
    outOfControl: "Out of control",
    dragged: "I got dragged in",
    revenge: "Revenge impulse",
    stopMe: "Stop me",
    backInControl: "Back in control",
    daySummary: "Day summary",
    ruleLimits: "My limits today",
    remaining: "What's left today?",
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
  commands: {
    welcome:
      "Welcome to Guardrail Coach. Use the menu below or type a message. /checkin to start your day, /review for end-of-day, /limits for your rules, /help for all commands.",
    help:
      "Available commands:\n/checkin — pre-session check-in\n/review — end-of-day review\n/limits — your risk limits for today\n/help — this message\n\nOr just type how you're feeling and the coach will respond.",
    unknownCommand:
      "I didn't recognise that command. Use /help to see what's available, or just type a message.",
  },
  factual: {
    markets: { FUTURES: "Futures", US_EQUITIES: "Equities", FOREX: "Forex", CRYPTO: "Crypto" },
    sessions: {
      Globex: "Globex", "Pre-Market": "Pre-Market", "NYSE / NASDAQ": "NYSE / NASDAQ",
      "After-Hours": "After-Hours", Asia: "Asia", London: "London", NY: "NY",
      Forex: "Forex", "24/7": "24/7",
    },
    marketOpen: "{name} is open. Closes {time}.",
    marketOpenSession: "{name} is open. {session}. Closes {time}.",
    marketOpenNoClose: "{name} is open.",
    marketClosed: "{name} is closed.",
    marketClosedNextOpen: "{name} is closed. Opens {time}.",
    noMarketData: "No market hours data available.",
    noLimitsConfigured: "No limits configured.",
    dailyLossLimitLine: "Daily loss limit: {amount}.",
    maxTradesLine: "Max trades: {limit}.",
    stopAfterLossesLine: "Stop after {limit} consecutive losses.",
    lossRemainingUsed: "{amount} remaining on daily loss limit.",
    lossRemainingFull: "Full {amount} available — no losses yet.",
    tradesCountLine: "Trades: {count} of {limit}.",
    consecutiveLossesLine: "Consecutive losses: {count} of {limit}.",
    dailyLossLimitHit: "Daily loss limit reached. Trading stopped for today.",
    maxTradesHit: "{limit} trades reached for today. No more entries.",
    maxTradesHitGeneric: "Daily trade limit reached. No more entries.",
    consecutiveLossesHit: "{limit} consecutive losses — limit reached. Stop now.",
    consecutiveLossesHitGeneric: "Consecutive loss limit reached. Stop now.",
    sessionEnded: "Today's session has ended. Wait for tomorrow.",
    guardianLocked: "Account locked. Trading is suspended.",
    preNewsBlock: "Trading blocked — major economic event.",
    tradingBlocked: "Trading is stopped right now.",
    noTradingData: "No trading status data available.",
    tradingAllowed: "You can trade.",
    tradesRemaining: "{count} trades remaining.",
    lossBudgetRemaining: "{amount} loss budget left.",
  },
};
