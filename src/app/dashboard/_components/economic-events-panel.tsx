import { SectionCard } from "@/components/ui/section-card";
import type { EconomicEvent } from "@/lib/economic-calendar";

type EconomicEventsPanelProps = {
  events: EconomicEvent[];
  providerLabel: string;
  sourceLabel: string;
  scenarioLabel?: string | null;
  timeZone: string;
};

function formatEventTime(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(value);
}

function getImpactStyles(impact: EconomicEvent["impact"]) {
  switch (impact) {
    case "high":
      return "bg-red-100 text-red-800";
    case "medium":
      return "bg-amber-100 text-amber-800";
    case "low":
    default:
      return "bg-stone-100 text-stone-700";
  }
}

function getStateLabel(state: EconomicEvent["state"]) {
  switch (state) {
    case "active":
      return "Live now";
    case "passed":
      return "Passed";
    case "upcoming":
    default:
      return "Upcoming";
  }
}

export function EconomicEventsPanel({
  events,
  providerLabel,
  sourceLabel,
  scenarioLabel,
  timeZone,
}: EconomicEventsPanelProps) {
  const visibleEvents = events
    .filter((event) => event.state !== "passed")
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
    .slice(0, 4);

  return (
    <SectionCard
      title="Economic events"
      description="Upcoming calendar context that may affect session start, risk, or execution pace."
    >
      <div className="mb-4 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
        <p className="font-medium text-stone-950">{providerLabel}</p>
        <p className="mt-1 text-stone-600">
          {scenarioLabel ? `${scenarioLabel}. ` : ""}
          {sourceLabel}
        </p>
      </div>

      {visibleEvents.length ? (
        <div className="grid gap-3">
          {visibleEvents.map((event) => (
            <div
              key={event.id}
              className="rounded-[1.35rem] border border-stone-200 bg-white px-4 py-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-stone-950">{event.title}</p>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-medium ${getImpactStyles(
                    event.impact,
                  )}`}
                >
                  {event.impact} impact
                </span>
                <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-700">
                  {getStateLabel(event.state)}
                </span>
              </div>
              <p className="mt-2 text-sm text-stone-600">
                {formatEventTime(event.startTime, timeZone)} {timeZone}
              </p>
              <p className="mt-2 text-sm text-stone-600">
                {[event.country, event.currency, event.market].filter(Boolean).join(" · ")}
              </p>
              {event.marketRelevance?.length ? (
                <p className="mt-2 text-xs font-medium uppercase tracking-[0.16em] text-stone-500">
                  Relevant to {event.marketRelevance.slice(0, 3).join(", ")}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-[1.35rem] border border-dashed border-stone-300 bg-stone-50 px-4 py-5 text-sm text-stone-600">
          No upcoming high-priority calendar items are visible in the current provider window.
        </div>
      )}
    </SectionCard>
  );
}
