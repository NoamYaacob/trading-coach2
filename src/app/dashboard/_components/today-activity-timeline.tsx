import { SectionCard } from "@/components/ui/section-card";
import type { TodayActivityItem } from "@/lib/today-activity";

type TodayActivityTimelineProps = {
  items: TodayActivityItem[];
  title?: string;
  description?: string;
  timeZone: string;
};

function formatTimelineTime(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(value);
}

function getToneStyles(tone: TodayActivityItem["tone"]) {
  switch (tone) {
    case "success":
      return {
        dot: "bg-emerald-500",
        badge: "bg-emerald-100 text-emerald-800",
      };
    case "warning":
      return {
        dot: "bg-amber-500",
        badge: "bg-amber-100 text-amber-800",
      };
    case "danger":
      return {
        dot: "bg-red-500",
        badge: "bg-red-100 text-red-800",
      };
    case "info":
      return {
        dot: "bg-blue-500",
        badge: "bg-blue-100 text-blue-800",
      };
    default:
      return {
        dot: "bg-stone-400",
        badge: "bg-stone-100 text-stone-700",
      };
  }
}

export function TodayActivityTimeline({
  items,
  title = "Today activity",
  description = "A compact timeline of what happened across the session.",
  timeZone,
}: TodayActivityTimelineProps) {
  return (
    <SectionCard title={title} description={description}>
      {items.length ? (
        <div className="grid gap-3">
          {items.map((item, index) => {
            const toneStyles = getToneStyles(item.tone);
            const isLast = index === items.length - 1;

            return (
              <div
                key={item.id}
                className="grid gap-3 rounded-[1.4rem] border border-stone-200 bg-stone-50 px-4 py-4 md:grid-cols-[88px_12px_1fr] md:items-start"
              >
                <div className="text-sm font-medium text-stone-700">
                  {formatTimelineTime(item.occurredAt, timeZone)}
                </div>
                <div className="relative hidden h-full md:block">
                  <span
                    className={`absolute left-1 top-1 h-2.5 w-2.5 rounded-full ${toneStyles.dot}`}
                  />
                  {!isLast ? (
                    <span className="absolute left-[8.5px] top-4 h-[calc(100%-0.5rem)] w-px bg-stone-200" />
                  ) : null}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-base font-semibold text-stone-950">{item.title}</p>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${toneStyles.badge}`}
                    >
                      {item.badge}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-stone-600">{item.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-[1.4rem] border border-dashed border-stone-300 bg-stone-50 px-5 py-6 text-sm">
          <p className="font-medium text-stone-800">No activity yet.</p>
          <p className="mt-1 text-stone-500">
            Events appear here as the session progresses — session start, Guardian triggers, and logged trades.
          </p>
        </div>
      )}
    </SectionCard>
  );
}
