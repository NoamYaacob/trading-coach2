export type EconomicCalendarProviderKey = "mock" | "tradingeconomics_stub";
export type EconomicCalendarProviderType = "mock" | "tradingeconomics_stub";

export interface EconomicCalendarProviderIdentity {
  key: EconomicCalendarProviderKey;
  id: string;
  name: string;
  type: EconomicCalendarProviderType;
  source?: string;
}

export type EconomicImpactLevel = "low" | "medium" | "high";
export type EconomicEventState = "upcoming" | "active" | "passed";
export type EconomicCalendarStubScenario =
  | "mixed_day"
  | "quiet"
  | "upcoming_high_impact"
  | "caution_window"
  | "blocked_major_event"
  | "passed_event";

export interface EconomicCalendarProviderContext {
  windowStart?: Date;
  windowEnd?: Date;
  scenario?: EconomicCalendarStubScenario;
}

export interface EconomicCalendarProvider {
  identity: EconomicCalendarProviderIdentity;
  fetchSnapshot(
    context?: EconomicCalendarProviderContext,
  ): Promise<EconomicCalendarSnapshot>;
}

export type EconomicCalendarEvent = {
  id: string;
  provider: EconomicCalendarProviderIdentity;
  providerEventId?: string;
  title: string;
  description: string;
  country?: string;
  countryCode?: string;
  market: string;
  marketRelevance?: string[];
  currency?: string;
  category?: string;
  impact: EconomicImpactLevel;
  importanceScore?: number;
  state: EconomicEventState;
  startTime: Date;
  endTime: Date | null;
  source: string;
  sourceProvider?: string;
  url?: string;
};

export type EconomicCalendarSnapshot = {
  provider: EconomicCalendarProviderIdentity;
  fetchedAt: Date;
  windowStart: Date;
  windowEnd: Date;
  events: EconomicCalendarEvent[];
};

const providers = new Map<EconomicCalendarProviderKey, EconomicCalendarProvider>();

export function registerEconomicCalendarProvider(provider: EconomicCalendarProvider) {
  providers.set(provider.identity.key, provider);
}

export function resolveEconomicCalendarProvider(
  key: EconomicCalendarProviderKey = "mock",
): EconomicCalendarProvider {
  const provider = providers.get(key);

  if (!provider) {
    throw new Error(`Economic calendar provider not found: ${key}`);
  }

  return provider;
}

function getSafeEconomicCalendarProviderKey(
  key: EconomicCalendarProviderKey | string | null | undefined,
): EconomicCalendarProviderKey {
  if (typeof key === "string" && providers.has(key as EconomicCalendarProviderKey)) {
    return key as EconomicCalendarProviderKey;
  }

  return "mock";
}

const economicCalendarStubScenarios: EconomicCalendarStubScenario[] = [
  "mixed_day",
  "quiet",
  "upcoming_high_impact",
  "caution_window",
  "blocked_major_event",
  "passed_event",
];

export function getSafeEconomicCalendarStubScenario(
  scenario?: EconomicCalendarStubScenario | string | null,
): EconomicCalendarStubScenario {
  return economicCalendarStubScenarios.includes(
    scenario as EconomicCalendarStubScenario,
  )
    ? (scenario as EconomicCalendarStubScenario)
    : "mixed_day";
}

export async function fetchEconomicCalendarSnapshot(
  key: EconomicCalendarProviderKey | string | null | undefined = "mock",
  context: EconomicCalendarProviderContext = {},
): Promise<EconomicCalendarSnapshot> {
  return resolveEconomicCalendarProvider(getSafeEconomicCalendarProviderKey(key)).fetchSnapshot(context);
}

const mockEconomicCalendarProvider: EconomicCalendarProviderIdentity = {
  key: "mock",
  id: "mock-economic-calendar",
  name: "Mock economic calendar",
  type: "mock",
  source: "Internal mock provider",
};

const tradingEconomicsStubProvider: EconomicCalendarProviderIdentity = {
  key: "tradingeconomics_stub",
  id: "tradingeconomics-stub-economic-calendar",
  name: "TradingEconomics stub",
  type: "tradingeconomics_stub",
  source: "TradingEconomics stub provider",
};

const defaultMockWindowLengthMs = 24 * 60 * 60 * 1000;
const calendarScheduleSlots = [
  { hour: 8, minute: 30 },
  { hour: 10, minute: 0 },
  { hour: 12, minute: 0 },
  { hour: 14, minute: 0 },
  { hour: 18, minute: 0 },
];

function getEconomicEventState(
  event: Pick<EconomicCalendarEvent, "startTime" | "endTime">,
  reference = new Date(),
): EconomicEventState {
  if (reference < event.startTime) {
    return "upcoming";
  }

  if (event.endTime && reference > event.endTime) {
    return "passed";
  }

  return "active";
}

function buildProviderEvents(
  provider: EconomicCalendarProviderIdentity,
  windowStart: Date,
  windowEnd: Date,
): EconomicCalendarEvent[] {
  const now = new Date();
  const schedule = getCalendarSchedule(now);

  const events: Omit<EconomicCalendarEvent, "state">[] = [
    {
      id: "mock-us-jobs-report",
      provider,
      title: "US jobs report",
      description: "A high-impact US labor market release that can move equities and FX.",
      market: "Equities / FX",
      currency: "USD",
      impact: "high",
      startTime: schedule.upcomingSoon,
      endTime: addMinutes(schedule.upcomingSoon, 60),
      source: provider.source ?? "Mock calendar",
      url: "https://example.com/mock-us-jobs-report",
    },
    {
      id: "mock-eurozone-cpi",
      provider,
      title: "Eurozone CPI",
      description: "A medium-impact inflation release for the euro area.",
      market: "FX",
      currency: "EUR",
      impact: "medium",
      startTime: schedule.upcomingLater,
      endTime: addMinutes(schedule.upcomingLater, 30),
      source: provider.source ?? "Mock calendar",
      url: "https://example.com/mock-eurozone-cpi",
    },
    {
      id: "mock-fed-speech",
      provider,
      title: "Central bank speech",
      description: "A central bank leader speaks on policy and market outlook.",
      market: "Fixed income / FX",
      currency: "USD",
      impact: "low",
      startTime: schedule.upcomingFar,
      endTime: addMinutes(schedule.upcomingFar, 60),
      source: provider.source ?? "Mock calendar",
      url: "https://example.com/mock-fed-speech",
    },
  ];

  return events
    .filter((event) => event.startTime >= windowStart && event.startTime <= windowEnd)
    .map((event) => ({
      ...event,
      state: getEconomicEventState(event, now),
    }));
}

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60 * 1000);
}

function scheduledUtcTime(reference: Date, hour: number, minute = 0, dayOffset = 0) {
  const scheduled = new Date(reference);
  scheduled.setUTCDate(scheduled.getUTCDate() + dayOffset);
  scheduled.setUTCHours(hour, minute, 0, 0);

  return scheduled;
}

function nextScheduledUtcTime(reference: Date, hour: number, minute = 0) {
  const today = scheduledUtcTime(reference, hour, minute);

  if (today > reference) {
    return today;
  }

  return scheduledUtcTime(reference, hour, minute, 1);
}

function previousScheduledUtcTime(reference: Date, hour: number, minute = 0) {
  const today = scheduledUtcTime(reference, hour, minute);

  if (today < reference) {
    return today;
  }

  return scheduledUtcTime(reference, hour, minute, -1);
}

function getUpcomingScheduleSlot(reference: Date, index: number) {
  const upcomingSlots = calendarScheduleSlots
    .map((slot) => nextScheduledUtcTime(reference, slot.hour, slot.minute))
    .sort((a, b) => a.getTime() - b.getTime());

  return upcomingSlots[Math.min(index, upcomingSlots.length - 1)] ?? upcomingSlots[0];
}

function getCalendarSchedule(reference: Date) {
  const activeStart = previousScheduledUtcTime(reference, 14, 0);

  return {
    passedRecent: previousScheduledUtcTime(reference, 8, 30),
    activeStart,
    caution: getUpcomingScheduleSlot(reference, 0),
    upcomingSoon: getUpcomingScheduleSlot(reference, 1),
    upcomingLater: getUpcomingScheduleSlot(reference, 2),
    upcomingFar: getUpcomingScheduleSlot(reference, 4),
  };
}

function createTradingEconomicsStubEvent(
  provider: EconomicCalendarProviderIdentity,
  event: Omit<EconomicCalendarEvent, "provider" | "state" | "source" | "sourceProvider">,
): Omit<EconomicCalendarEvent, "state"> {
  return {
    ...event,
    provider,
    source: provider.source ?? "TradingEconomics stub provider",
    sourceProvider: "TradingEconomics",
  };
}

function getTradingEconomicsStubScenarioEvents(
  provider: EconomicCalendarProviderIdentity,
  scenario: EconomicCalendarStubScenario,
  now: Date,
): Omit<EconomicCalendarEvent, "state">[] {
  const schedule = getCalendarSchedule(now);
  const eventCatalog = {
    passedCpi: createTradingEconomicsStubEvent(provider, {
      id: "te-stub-us-cpi-passed",
      providerEventId: "TE-STUB-US-CPI-PAST",
      title: "US CPI inflation rate",
      description:
        "High-impact inflation release with broad relevance for indices, FX, futures, and rates.",
      country: "United States",
      countryCode: "US",
      market: "US macro",
      marketRelevance: ["US equities", "Futures", "Forex", "Rates"],
      currency: "USD",
      category: "Inflation",
      impact: "high" as const,
      importanceScore: 5,
      startTime: schedule.passedRecent,
      endTime: addMinutes(schedule.passedRecent, 15),
      url: "https://example.com/tradingeconomics-stub/us-cpi",
    }),
    activeFedDecision: createTradingEconomicsStubEvent(provider, {
      id: "te-stub-fed-rate-decision-active",
      providerEventId: "TE-STUB-FED-RATE-ACTIVE",
      title: "Federal Reserve rate decision",
      description:
        "Major central-bank decision that can create immediate volatility across risk assets.",
      country: "United States",
      countryCode: "US",
      market: "Central bank policy",
      marketRelevance: ["US equities", "Futures", "Forex", "Crypto"],
      currency: "USD",
      category: "Interest rates",
      impact: "high" as const,
      importanceScore: 5,
      startTime: schedule.activeStart,
      endTime: addMinutes(schedule.activeStart, 12 * 60),
      url: "https://example.com/tradingeconomics-stub/fed-rate-decision",
    }),
    cautionNfp: createTradingEconomicsStubEvent(provider, {
      id: "te-stub-us-nonfarm-payrolls-caution",
      providerEventId: "TE-STUB-US-NFP-CAUTION",
      title: "US nonfarm payrolls",
      description:
        "High-impact labor report that often drives sharp moves in USD, indices, and futures.",
      country: "United States",
      countryCode: "US",
      market: "Labor market",
      marketRelevance: ["US equities", "Futures", "Forex"],
      currency: "USD",
      category: "Employment",
      impact: "high" as const,
      importanceScore: 5,
      startTime: schedule.caution,
      endTime: addMinutes(schedule.caution, 15),
      url: "https://example.com/tradingeconomics-stub/us-nonfarm-payrolls",
    }),
    upcomingPmi: createTradingEconomicsStubEvent(provider, {
      id: "te-stub-us-ism-pmi-upcoming",
      providerEventId: "TE-STUB-US-ISM-PMI",
      title: "US ISM manufacturing PMI",
      description:
        "High-impact growth indicator used to gauge economic momentum and risk sentiment.",
      country: "United States",
      countryCode: "US",
      market: "Growth data",
      marketRelevance: ["US equities", "Futures", "Forex"],
      currency: "USD",
      category: "Business confidence",
      impact: "high" as const,
      importanceScore: 4,
      startTime: schedule.upcomingSoon,
      endTime: addMinutes(schedule.upcomingSoon, 15),
      url: "https://example.com/tradingeconomics-stub/us-ism-pmi",
    }),
    mediumEuroCpi: createTradingEconomicsStubEvent(provider, {
      id: "te-stub-eurozone-flash-cpi",
      providerEventId: "TE-STUB-EZ-FLASH-CPI",
      title: "Eurozone flash CPI",
      description:
        "Inflation release with primary relevance for EUR pairs and European index sentiment.",
      country: "Euro Area",
      countryCode: "EA",
      market: "European macro",
      marketRelevance: ["Forex", "European equities"],
      currency: "EUR",
      category: "Inflation",
      impact: "medium" as const,
      importanceScore: 3,
      startTime: schedule.upcomingLater,
      endTime: addMinutes(schedule.upcomingLater, 15),
      url: "https://example.com/tradingeconomics-stub/eurozone-cpi",
    }),
    lowJapanAuction: createTradingEconomicsStubEvent(provider, {
      id: "te-stub-japan-bond-auction",
      providerEventId: "TE-STUB-JP-BOND-AUCTION",
      title: "Japan 10-year bond auction",
      description:
        "Lower-impact fixed-income event with localized relevance for JPY and rates.",
      country: "Japan",
      countryCode: "JP",
      market: "Fixed income",
      marketRelevance: ["Forex", "Rates"],
      currency: "JPY",
      category: "Government debt",
      impact: "low" as const,
      importanceScore: 1,
      startTime: schedule.upcomingFar,
      endTime: addMinutes(schedule.upcomingFar, 15),
      url: "https://example.com/tradingeconomics-stub/japan-bond-auction",
    }),
  };

  switch (scenario) {
    case "quiet":
      return [eventCatalog.mediumEuroCpi, eventCatalog.lowJapanAuction];
    case "upcoming_high_impact":
      return [eventCatalog.upcomingPmi, eventCatalog.mediumEuroCpi];
    case "caution_window":
      return [eventCatalog.cautionNfp, eventCatalog.mediumEuroCpi];
    case "blocked_major_event":
      return [eventCatalog.activeFedDecision, eventCatalog.upcomingPmi];
    case "passed_event":
      return [eventCatalog.passedCpi, eventCatalog.upcomingPmi];
    case "mixed_day":
    default:
      return [
        eventCatalog.passedCpi,
        eventCatalog.cautionNfp,
        eventCatalog.upcomingPmi,
        eventCatalog.mediumEuroCpi,
        eventCatalog.lowJapanAuction,
      ];
  }
}

function buildTradingEconomicsStubEvents(
  provider: EconomicCalendarProviderIdentity,
  windowStart: Date,
  windowEnd: Date,
  scenario: EconomicCalendarStubScenario = "mixed_day",
): EconomicCalendarEvent[] {
  const now = new Date();

  return getTradingEconomicsStubScenarioEvents(provider, scenario, now)
    .filter((event) => {
      const eventEnd = event.endTime ?? event.startTime;
      const recentPastWindowStart = new Date(windowStart.getTime() - 2 * 60 * 60 * 1000);

      return event.startTime <= windowEnd && eventEnd >= recentPastWindowStart;
    })
    .map((event) => ({
      ...event,
      state: getEconomicEventState(event, now),
    }));
}

const mockProvider: EconomicCalendarProvider = {
  identity: mockEconomicCalendarProvider,
  async fetchSnapshot(context = {}) {
    const windowStart = context.windowStart ?? new Date();
    const windowEnd = context.windowEnd ?? new Date(Date.now() + defaultMockWindowLengthMs);

    return {
      provider: mockEconomicCalendarProvider,
      fetchedAt: new Date(),
      windowStart,
      windowEnd,
      events: buildProviderEvents(mockEconomicCalendarProvider, windowStart, windowEnd),
    };
  },
};

const tradingEconomicsStubProviderInstance: EconomicCalendarProvider = {
  identity: tradingEconomicsStubProvider,
  async fetchSnapshot(context = {}) {
    const windowStart = context.windowStart ?? new Date();
    const windowEnd = context.windowEnd ?? new Date(Date.now() + defaultMockWindowLengthMs);

    return {
      provider: tradingEconomicsStubProvider,
      fetchedAt: new Date(),
      windowStart,
      windowEnd,
      events: buildTradingEconomicsStubEvents(
        tradingEconomicsStubProvider,
        windowStart,
        windowEnd,
        getSafeEconomicCalendarStubScenario(context.scenario),
      ),
    };
  },
};

registerEconomicCalendarProvider(mockProvider);
registerEconomicCalendarProvider(tradingEconomicsStubProviderInstance);

export const mockEconomicCalendarProviderIdentity = mockEconomicCalendarProvider;
