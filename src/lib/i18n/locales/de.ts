import type { BotLocale } from "../types";

export const de: BotLocale = {
  keyboard: {
    checkIn: "Check-in",
    fomo: "Ich habe FOMO",
    angry: "Ich bin wütend",
    outOfControl: "Außer Kontrolle",
    dragged: "Reingezogen",
    revenge: "Verlust zurückholen",
    stopMe: "Stopp mich",
    backInControl: "Wieder unter Kontrolle",
    daySummary: "Tageszusammenfassung",
    ruleLimits: "Meine Limits heute",
    remaining: "Was ist heute noch übrig?",
  },
  system: {
    invalidLink:
      "Dieser Link ist ungültig oder abgelaufen. Erstellen Sie einen neuen Link über Ihr Dashboard.",
    connectSuccess: "Telegram verbunden. Bot-Coaching-Zugang ist aktiv.",
    connectSuccessNoAccess:
      "Telegram verbunden, aber der Zugang ist inaktiv. Sie benötigen einen aktiven Plan oder Test.",
    connectSuccessIncomplete:
      "Telegram verbunden. Schließen Sie das Onboarding auf der Website ab, bevor Sie den Bot nutzen.",
    notLinked:
      "Dieses Telegram-Konto ist nicht verknüpft. Verbinden Sie es über Ihr Dashboard.",
    onboardingIncomplete:
      "Ihr Konto ist verbunden, aber das Onboarding ist unvollständig. Schließen Sie es auf der Website ab.",
    accessInactive:
      "Ihr Zugang ist inaktiv. Aktivieren Sie einen Plan auf der Website, um fortzufahren.",
    inputPlaceholder: "Schnellaktion oder Nachricht...",
    languageUpdated: "Sprache auf Deutsch aktualisiert.",
  },
  prompts: {
    sessionNotStarted: "Die Sitzung hat noch nicht begonnen. Bereit, wenn Sie es sind.",
    checkIn: "Wie fühlen Sie sich vor der heutigen Sitzung?",
    review: "Wie war Ihr Tag? Was haben Sie gelernt?",
  },
  coaching: {
    loss: "Ein Verlust ist passiert. Atmen Sie und denken Sie nach, bevor Sie weitermachen.",
    fomo: "FOMO ist der Feind der Disziplin. Der Markt kommt immer wieder.",
    anger: "Wütend zu traden kostet echtes Geld. Machen Sie jetzt eine Pause.",
    noSetup: "Kein Setup bedeutet kein Trade. Das ist Disziplin.",
    revenge:
      "Rache-Trading zerstört Konten. Ihr nächster Trade muss sauber sein.",
    overtrading: "Mehr Trades bedeutet weniger Kontrolle. Weniger ist mehr.",
    warning: "Achtung, Sie nähern sich Ihrem Limit.",
    discipline: "Ihre Regeln existieren aus einem Grund. Halten Sie sich daran.",
  },
  commands: {
    welcome:
      "Willkommen bei Guardrail Coach. Nutzen Sie das Menü unten oder schreiben Sie eine Nachricht. /checkin für den Tagesbeginn, /review für die Tagesauswertung, /limits für Ihre Regeln, /help für alle Befehle.",
    help:
      "Verfügbare Befehle:\n/checkin — Pre-Session-Check-in\n/review — Tagesauswertung\n/limits — Ihre Risikolimits heute\n/help — Diese Nachricht\n\nOder schreiben Sie einfach, wie Sie sich fühlen, und der Coach antwortet.",
    unknownCommand:
      "Dieser Befehl ist unbekannt. Nutzen Sie /help für eine Übersicht oder schreiben Sie einfach eine Nachricht.",
  },
  factual: {
    markets: { FUTURES: "Futures", US_EQUITIES: "Aktien", FOREX: "Forex", CRYPTO: "Krypto" },
    sessions: {
      Globex: "Globex", "Pre-Market": "Vorbörslich", "NYSE / NASDAQ": "NYSE / NASDAQ",
      "After-Hours": "Nachbörslich", Asia: "Asien", London: "London", NY: "NY",
      Forex: "Forex", "24/7": "24/7",
    },
    marketOpen: "{name} ist geöffnet. Schließt {time}.",
    marketOpenSession: "{name} ist geöffnet. {session}. Schließt {time}.",
    marketOpenNoClose: "{name} ist geöffnet.",
    marketClosed: "{name} ist geschlossen.",
    marketClosedNextOpen: "{name} ist geschlossen. Öffnet {time}.",
    noMarketData: "Keine Marktzeiten-Daten verfügbar.",
    noLimitsConfigured: "Keine Limits konfiguriert.",
    dailyLossLimitLine: "Tägliches Verlustlimit: {amount}.",
    maxTradesLine: "Max. Trades: {limit}.",
    stopAfterLossesLine: "Stopp nach {limit} aufeinanderfolgenden Verlusten.",
    lossRemainingUsed: "{amount} verbleibend im Tagesverlustlimit.",
    lossRemainingFull: "{amount} verfügbar — noch keine Verluste.",
    tradesCountLine: "Trades: {count} von {limit}.",
    consecutiveLossesLine: "Aufeinanderfolgende Verluste: {count} von {limit}.",
    dailyLossLimitHit: "Tägliches Verlustlimit erreicht. Trading für heute gestoppt.",
    maxTradesHit: "{limit} Trades heute erreicht. Keine weiteren Einstiege.",
    maxTradesHitGeneric: "Tägliches Trade-Limit erreicht. Keine weiteren Einstiege.",
    consecutiveLossesHit: "{limit} aufeinanderfolgende Verluste — Limit erreicht. Jetzt stoppen.",
    consecutiveLossesHitGeneric: "Limit für aufeinanderfolgende Verluste erreicht. Jetzt stoppen.",
    sessionEnded: "Die heutige Sitzung ist beendet. Warte auf morgen.",
    guardianLocked: "Konto gesperrt. Trading ausgesetzt.",
    preNewsBlock: "Trading gesperrt — wichtiges Wirtschaftsereignis.",
    tradingBlocked: "Trading ist gerade gestoppt.",
    noTradingData: "Keine Trading-Status-Daten verfügbar.",
    tradingAllowed: "Sie können traden.",
    tradesRemaining: "{count} Trades verbleibend.",
    lossBudgetRemaining: "{amount} Verlustbudget verbleibend.",
  },
};
