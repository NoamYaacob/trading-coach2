import type {
  EconomicCalendarEvent as EconomicEvent,
  EconomicCalendarSnapshot,
  EconomicCalendarProviderIdentity,
  EconomicCalendarStubScenario,
} from "./economic-calendar-provider";
import {
  fetchEconomicCalendarSnapshot,
  getSafeEconomicCalendarStubScenario,
} from "./economic-calendar-provider";

export type { EconomicEvent, EconomicCalendarSnapshot };
export type {
  EconomicCalendarProvider,
  EconomicCalendarProviderContext,
  EconomicCalendarProviderIdentity,
  EconomicCalendarProviderKey,
  EconomicCalendarProviderType,
  EconomicCalendarStubScenario,
} from "./economic-calendar-provider";

export type EconomicCalendarSelectionSource = {
  economicCalendarProviderKey?: string | null;
  economicCalendarStubScenario?: string | null;
} | null | undefined;

export type EconomicCalendarSelection = {
  providerKey: string | null | undefined;
  stubScenario: EconomicCalendarStubScenario;
};

export type EconomicImpactLevel = "low" | "medium" | "high";

export type EconomicEventState = "upcoming" | "active" | "passed";

export type PreNewsPolicyMode = "WARNING_ONLY" | "SOFT_CAUTION" | "HARD_BLOCK_MAJOR";
export type PreNewsPolicyGuidanceMode = "INFORM" | "CAUTION" | "BLOCK";

export type EconomicPreNewsPolicy = {
  mode: PreNewsPolicyMode;
  guidanceMode: PreNewsPolicyGuidanceMode;
  preNewsMinutes: number;
  postNewsMinutes: number;
  impactThreshold: EconomicImpactLevel;
};

export type EconomicPreNewsPolicyStatus = {
  policy: EconomicPreNewsPolicy;
  activeEvent: EconomicEvent | null;
  isActive: boolean;
  minutesUntilEvent: number | null;
  minutesAfterEvent: number | null;
  message: string | null;
};

export type EconomicCalendarVisibility = {
  providerLabel: string;
  sourceLabel: string;
  scenarioLabel: string | null;
  scenarioDescription: string | null;
  stateLabel: string;
  headline: string;
  detail: string;
  nextStep: string;
  tone: "clear" | "watch" | "caution" | "blocked";
};

const defaultImpactRank: Record<EconomicImpactLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export function getDefaultEconomicPreNewsPolicy(): EconomicPreNewsPolicy {
  return {
    mode: "WARNING_ONLY",
    guidanceMode: "CAUTION",
    preNewsMinutes: 60,
    postNewsMinutes: 30,
    impactThreshold: "high",
  };
}

function buildPreNewsPolicyMessage(
  event: EconomicEvent,
  policy: EconomicPreNewsPolicy,
  now: Date,
  minutesUntilEvent: number | null,
  minutesAfterEvent: number | null,
) {
  if (!event) {
    return null;
  }

  if (now < event.startTime) {
    switch (policy.mode) {
      case "HARD_BLOCK_MAJOR":
        return `${event.title} in ${minutesUntilEvent ?? 0} minutes. Do not start until the blocked news window clears.`;
      case "SOFT_CAUTION":
        return `${event.title} in ${minutesUntilEvent ?? 0} minutes. Start only with reduced risk and a clear plan.`;
      case "WARNING_ONLY":
      default:
        return `${event.title} in ${minutesUntilEvent ?? 0} minutes. Keep the plan over the noise.`;
    }
  }

  if (event.endTime && now <= event.endTime) {
    if (policy.mode === "HARD_BLOCK_MAJOR") {
      return `${event.title} is live now. Do not start until the blocked news window clears.`;
    }

    return `${event.title} is live now. Trade only if the plan is very clear.`;
  }

  if (minutesAfterEvent !== null) {
    return `${event.title} just passed. Stay disciplined for the next ${policy.postNewsMinutes} minutes.`;
  }

  return `${event.title} is nearby. Stay aware and follow your rules.`;
}

export function getCurrentPreNewsPolicy(
  snapshot: EconomicCalendarSnapshot,
  policy: EconomicPreNewsPolicy = getDefaultEconomicPreNewsPolicy(),
): EconomicPreNewsPolicyStatus {
  const now = new Date();
  const thresholdRank = defaultImpactRank[policy.impactThreshold];
  const windowStart = new Date(now.getTime() - policy.postNewsMinutes * 60 * 1000);
  const windowEnd = new Date(now.getTime() + policy.preNewsMinutes * 60 * 1000);

  const candidates = snapshot.events
    .filter(
      (event) =>
        defaultImpactRank[event.impact] >= thresholdRank &&
        event.startTime <= windowEnd &&
        (event.endTime ?? event.startTime) >= windowStart,
    )
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  const activeEvent = candidates.find(
    (event) =>
      event.startTime <= now &&
      (event.endTime ? now <= event.endTime : true),
  ) ?? candidates[0] ?? null;

  const isActive = Boolean(activeEvent);
  const minutesUntilEvent = activeEvent
    ? activeEvent.startTime > now
      ? Math.ceil((activeEvent.startTime.getTime() - now.getTime()) / 60000)
      : 0
    : null;
  const minutesAfterEvent = activeEvent && activeEvent.endTime && now > activeEvent.endTime
    ? Math.ceil((now.getTime() - activeEvent.endTime.getTime()) / 60000)
    : null;

  return {
    policy,
    activeEvent,
    isActive,
    minutesUntilEvent: isActive ? minutesUntilEvent : null,
    minutesAfterEvent: isActive ? minutesAfterEvent : null,
    message: activeEvent
      ? buildPreNewsPolicyMessage(activeEvent, policy, now, minutesUntilEvent, minutesAfterEvent)
      : null,
  };
}

export function getEconomicEventState(
  event: Pick<EconomicEvent, "startTime" | "endTime">,
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

export function getNextHighImpactEconomicEvent(
  snapshot: EconomicCalendarSnapshot,
): EconomicEvent | null {
  const now = new Date();

  return (
    snapshot.events
      .filter(
        (event) =>
          event.impact === "high" &&
          event.state === "upcoming" &&
          event.startTime.getTime() >= now.getTime(),
      )
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())[0] ?? null
  );
}

export function hasUpcomingHighImpactEconomicEvent(
  snapshot: EconomicCalendarSnapshot,
  lookaheadMs = 24 * 60 * 60 * 1000,
): boolean {
  const now = new Date();

  return snapshot.events.some(
    (event) =>
      event.impact === "high" &&
      event.state === "upcoming" &&
      event.startTime.getTime() <= now.getTime() + lookaheadMs,
  );
}

export function isInsidePreNewsWarningWindow(
  snapshot: EconomicCalendarSnapshot,
  warningMs = 60 * 60 * 1000,
): boolean {
  const now = new Date();
  const nextHighImpact = getNextHighImpactEconomicEvent(snapshot);

  return (
    Boolean(nextHighImpact) &&
    (nextHighImpact?.startTime.getTime() ?? Infinity) - now.getTime() <= warningMs
  );
}

export async function getMockEconomicCalendarSnapshot(
  windowStart = new Date(),
  windowEnd = new Date(Date.now() + 24 * 60 * 60 * 1000),
): Promise<EconomicCalendarSnapshot> {
  return fetchEconomicCalendarSnapshot("mock", { windowStart, windowEnd });
}

export function getEconomicCalendarSelection(
  source: EconomicCalendarSelectionSource,
): EconomicCalendarSelection {
  return {
    providerKey: source?.economicCalendarProviderKey ?? "mock",
    stubScenario: getSafeEconomicCalendarStubScenario(
      source?.economicCalendarStubScenario,
    ),
  };
}

export async function getSelectedEconomicCalendarSnapshot(
  source?: EconomicCalendarSelectionSource | string | null,
  windowStart = new Date(),
  windowEnd = new Date(Date.now() + 24 * 60 * 60 * 1000),
): Promise<EconomicCalendarSnapshot> {
  const selection =
    typeof source === "string" || source === null || source === undefined
      ? getEconomicCalendarSelection({ economicCalendarProviderKey: source })
      : getEconomicCalendarSelection(source);

  return fetchEconomicCalendarSnapshot(selection.providerKey, {
    windowStart,
    windowEnd,
    scenario: selection.stubScenario,
  });
}

export function getEconomicCalendarStubScenarioDisplay(
  scenario?: string | null,
) {
  switch (getSafeEconomicCalendarStubScenario(scenario)) {
    case "quiet":
      return {
        scenarioLabel: "Quiet calendar",
        scenarioDescription: "No major event is near the current session window.",
      };
    case "upcoming_high_impact":
      return {
        scenarioLabel: "Upcoming high-impact event",
        scenarioDescription: "A major event is scheduled later, outside the immediate caution window.",
      };
    case "caution_window":
      return {
        scenarioLabel: "Caution window",
        scenarioDescription: "A high-impact event is close enough to require tighter execution.",
      };
    case "blocked_major_event":
      return {
        scenarioLabel: "Blocked major-event window",
        scenarioDescription: "A major event is live or close enough to pause session start.",
      };
    case "passed_event":
      return {
        scenarioLabel: "Recently passed event",
        scenarioDescription: "The calendar includes a recent major release for post-news testing.",
      };
    case "mixed_day":
    default:
      return {
        scenarioLabel: "Mixed calendar day",
        scenarioDescription: "The stub includes passed, upcoming, and lower-impact events.",
      };
  }
}

function formatEconomicEventTime(value: Date, timeZone: string) {
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(value)} ${timeZone}`;
}

export function getEconomicCalendarProviderDisplay(
  provider: EconomicCalendarProviderIdentity,
) {
  switch (provider.key) {
    case "tradingeconomics_stub":
      return {
        providerLabel: "TradingEconomics calendar stub",
        sourceLabel: "External calendar stub. Live data is not connected yet.",
      };
    case "mock":
    default:
      return {
        providerLabel: "Mock calendar feed",
        sourceLabel: "Internal demo calendar for pre-news policy testing.",
      };
  }
}

export function buildEconomicCalendarVisibility(input: {
  snapshot: EconomicCalendarSnapshot;
  policyStatus: EconomicPreNewsPolicyStatus;
  nextHighImpactEvent?: EconomicEvent | null;
  timeZone: string;
  scenario?: string | null;
}): EconomicCalendarVisibility {
  const { providerLabel, sourceLabel } = getEconomicCalendarProviderDisplay(
    input.snapshot.provider,
  );
  const scenarioDisplay =
    input.snapshot.provider.key === "tradingeconomics_stub"
      ? getEconomicCalendarStubScenarioDisplay(input.scenario)
      : { scenarioLabel: null, scenarioDescription: null };
  const policy = input.policyStatus;
  const activeEvent = policy.activeEvent;
  const nextHighImpactEvent = input.nextHighImpactEvent ?? null;
  const eventTitle = activeEvent?.title ?? nextHighImpactEvent?.title ?? null;

  if (policy.isActive && activeEvent) {
    if (policy.policy.mode === "HARD_BLOCK_MAJOR") {
      return {
        providerLabel,
        sourceLabel,
        ...scenarioDisplay,
        stateLabel: "Blocked start window",
        headline: "High-impact event window",
        detail:
          policy.minutesUntilEvent && policy.minutesUntilEvent > 0
            ? `${eventTitle} in ${policy.minutesUntilEvent} minutes. Do not start until the blocked window clears.`
            : `${eventTitle} is live or just passed. Wait for the blocked window to clear before starting.`,
        nextStep: "Wait for the event window to pass before starting the session.",
        tone: "blocked",
      };
    }

    if (policy.policy.mode === "SOFT_CAUTION") {
      return {
        providerLabel,
        sourceLabel,
        ...scenarioDisplay,
        stateLabel: "Caution window",
        headline: "High-impact event nearby",
        detail:
          policy.minutesUntilEvent && policy.minutesUntilEvent > 0
            ? `${eventTitle} in ${policy.minutesUntilEvent} minutes. Start only with reduced risk and a clear plan.`
            : `${eventTitle} is in the active news window. Keep risk smaller and execution strict.`,
        nextStep: "Start only if the plan is clear and risk stays reduced.",
        tone: "caution",
      };
    }

    return {
      providerLabel,
      sourceLabel,
      ...scenarioDisplay,
      stateLabel: "News watch",
      headline: "High-impact event nearby",
      detail:
        policy.minutesUntilEvent && policy.minutesUntilEvent > 0
          ? `${eventTitle} in ${policy.minutesUntilEvent} minutes. Keep the plan over the noise.`
          : `${eventTitle} is in the active news window. Stay aware and follow your rules.`,
      nextStep: "Stay aware, but let the session plan lead.",
      tone: "watch",
    };
  }

  if (nextHighImpactEvent) {
    return {
      providerLabel,
      sourceLabel,
      ...scenarioDisplay,
      stateLabel: "Upcoming high-impact event",
      headline: "Next high-impact event",
      detail: `${nextHighImpactEvent.title} at ${formatEconomicEventTime(
        nextHighImpactEvent.startTime,
        input.timeZone,
      )}.`,
      nextStep: "Keep it on the radar before starting or adding risk.",
      tone: "watch",
    };
  }

  return {
    providerLabel,
    sourceLabel,
    ...scenarioDisplay,
    stateLabel: "Calendar clear",
    headline: "No high-impact event nearby",
    detail: "No high-impact event is inside the current pre-news window.",
    nextStep: "Continue with the normal Guardian session plan.",
    tone: "clear",
  };
}
