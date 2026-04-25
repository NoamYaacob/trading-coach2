import type { BotLocale } from "../types";

export const ru: BotLocale = {
  keyboard: {
    checkIn: "Чекин",
    fomo: "Есть FOMO",
    angry: "Я злюсь",
    outOfControl: "Вне контроля",
    dragged: "Меня затянуло",
    revenge: "Хочу отыграться",
    stopMe: "Останови меня",
    backInControl: "Снова контролирую",
    daySummary: "Итоги дня",
    ruleLimits: "Мои лимиты сегодня",
    remaining: "Сколько осталось сегодня?",
  },
  system: {
    invalidLink:
      "Ссылка недействительна или просрочена. Создайте новую ссылку в панели управления на сайте.",
    connectSuccess: "Telegram подключён. Доступ к боту-коучу активен.",
    connectSuccessNoAccess:
      "Telegram подключён, но доступ неактивен. Вам нужен активный тариф или пробный период.",
    connectSuccessIncomplete:
      "Telegram подключён. Завершите настройку на сайте перед использованием бота.",
    notLinked:
      "Этот аккаунт Telegram не привязан. Подключите его через панель управления на сайте.",
    onboardingIncomplete:
      "Аккаунт подключён, но настройка не завершена. Завершите её на сайте.",
    accessInactive:
      "Доступ неактивен. Активируйте тариф на сайте, чтобы продолжить.",
    inputPlaceholder: "Быстрое действие или сообщение...",
    languageUpdated: "Язык обновлён на русский.",
  },
  prompts: {
    sessionNotStarted: "Сессия ещё не началась. Готов, когда вы готовы.",
    checkIn: "Как вы себя чувствуете перед сегодняшней сессией?",
    review: "Как прошёл день? Что вы узнали?",
  },
  coaching: {
    loss: "Произошёл убыток. Сделайте вдох и подумайте перед следующим шагом.",
    fomo: "FOMO — враг дисциплины. Рынок всегда возвращается.",
    anger: "Торговать в злобе дорого обходится. Отойдите сейчас.",
    noSetup: "Нет сетапа — нет сделки. Это и есть дисциплина.",
    revenge:
      "Торговля из мести разрушает счета. Следующая сделка должна быть чистой.",
    overtrading: "Больше сделок — меньше контроля. Меньше значит лучше.",
    warning: "Внимание, вы приближаетесь к своему лимиту.",
    discipline: "Ваши правила существуют не зря. Соблюдайте их.",
  },
  commands: {
    welcome:
      "Добро пожаловать в Guardrail Coach. Используйте меню ниже или напишите сообщение. /checkin — начало дня, /review — итоги дня, /limits — ваши лимиты, /help — все команды.",
    help:
      "Доступные команды:\n/checkin — чекин перед сессией\n/review — итоги дня\n/limits — ваши лимиты риска сегодня\n/help — это сообщение\n\nИли просто напишите, как вы себя чувствуете, и коуч ответит.",
    unknownCommand:
      "Я не распознал эту команду. Используйте /help для списка команд или просто напишите сообщение.",
  },
  factual: {
    markets: { FUTURES: "Фьючерсы", US_EQUITIES: "Акции", FOREX: "Форекс", CRYPTO: "Крипто" },
    sessions: {
      Globex: "Globex", "Pre-Market": "Пре-маркет", "NYSE / NASDAQ": "NYSE / NASDAQ",
      "After-Hours": "Пост-маркет", Asia: "Азия", London: "Лондон", NY: "NY",
      Forex: "Форекс", "24/7": "24/7",
    },
    marketOpen: "{name} открыт. Закрывается {time}.",
    marketOpenSession: "{name} открыт. {session}. Закрывается {time}.",
    marketOpenNoClose: "{name} открыт.",
    marketClosed: "{name} закрыт.",
    marketClosedNextOpen: "{name} закрыт. Открывается {time}.",
    noMarketData: "Нет данных о времени работы рынка.",
    noLimitsConfigured: "Лимиты не настроены.",
    dailyLossLimitLine: "Дневной лимит потерь: {amount}.",
    maxTradesLine: "Макс. сделок: {limit}.",
    stopAfterLossesLine: "Стоп после {limit} убытков подряд.",
    lossRemainingUsed: "{amount} остаток дневного лимита.",
    lossRemainingFull: "{amount} доступно — убытков пока нет.",
    tradesCountLine: "Сделок: {count} из {limit}.",
    consecutiveLossesLine: "Убытков подряд: {count} из {limit}.",
    dailyLossLimitHit: "Дневной лимит потерь достигнут. Торговля остановлена на сегодня.",
    maxTradesHit: "Достигнуто {limit} сделок сегодня. Больше входов нет.",
    maxTradesHitGeneric: "Дневной лимит сделок достигнут. Больше входов нет.",
    consecutiveLossesHit: "{limit} убытков подряд — лимит достигнут. Стоп.",
    consecutiveLossesHitGeneric: "Лимит убытков подряд достигнут. Стоп.",
    sessionEnded: "Сегодняшняя сессия завершена. Ждите завтра.",
    guardianLocked: "Счёт заблокирован. Торговля приостановлена.",
    preNewsBlock: "Торговля заблокирована — крупное экономическое событие.",
    tradingBlocked: "Торговля остановлена в данный момент.",
    noTradingData: "Нет данных о статусе торговли.",
    tradingAllowed: "Вы можете торговать.",
    tradesRemaining: "{count} сделок осталось.",
    lossBudgetRemaining: "{amount} бюджета потерь осталось.",
  },
};
