import { SectionCard } from "@/components/ui/section-card";
import type { TodayActivityItem } from "@/lib/today-activity";

type RecentSessionEventsProps = {
  items: TodayActivityItem[];
  timeZone: string;
};

function formatTimelineTime(value: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(value);
}

function getBadgeStyles(tone: TodayActivityItem["tone"]) {
  switch (tone) {
    case "success":
      return "bg-emerald-100 text-emerald-800";
    case "warning":
      return "bg-amber-100 text-amber-800";
    case "danger":
      return "bg-red-100 text-red-800";
    case "info":
      return "bg-blue-100 text-blue-800";
    default:
      return "bg-stone-100 text-stone-700";
  }
}

export function RecentSessionEvents({ items, timeZone }: RecentSessionEventsProps) {
  return (
    <SectionCard
      title="Recent session events"
      description="Recent context from today’s session."
    >
      {items.length ? (
        <div className="grid gap-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-2 rounded-[1.35rem] border border-stone-200 bg-stone-50 px-4 py-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-stone-950">{item.title}</p>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${getBadgeStyles(item.tone)}`}
                  >
                    {item.badge}
                  </span>
                </div>
                <p className="mt-1 text-sm text-stone-600">{item.detail}</p>
              </div>
              <p className="shrink-0 text-xs font-medium uppercase tracking-[0.18em] text-stone-500">
                {formatTimelineTime(item.occurredAt, timeZone)}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-[1.35rem] border border-dashed border-stone-300 bg-stone-50 px-5 py-4 text-sm text-stone-500">
          No recent events — activity appears here once the session starts.
        </p>
      )}
    </SectionCard>
  );
}
