import { SectionCard } from "@/components/ui/section-card";
import type { PostSessionReview } from "@/lib/post-session-review";

type PostSessionReviewPanelProps = {
  review: PostSessionReview;
  timeZone: string;
};

function formatReviewTime(value: Date, timeZone: string) {
  return `${new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(value)} ${timeZone}`;
}

export function PostSessionReviewPanel({
  review,
  timeZone,
}: PostSessionReviewPanelProps) {
  return (
    <SectionCard
      title="Post-session review"
      description="Close the day with the key read and the one thing to carry forward."
    >
      <div className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
              Started
            </p>
            <p className="mt-2 text-sm font-medium text-stone-950">
              {formatReviewTime(review.startedAt, timeZone)}
            </p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
              Ended
            </p>
            <p className="mt-2 text-sm font-medium text-stone-950">
              {formatReviewTime(review.endedAt, timeZone)}
            </p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
              Meaningful events
            </p>
            <p className="mt-2 text-lg font-semibold text-stone-950">
              {review.meaningfulEventCount}
            </p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
              Guardian
            </p>
            <p className="mt-2 text-lg font-semibold text-stone-950">
              {review.guardianIntervened ? "Intervened" : "Did not intervene"}
            </p>
          </div>
        </div>

        <div className="rounded-[1.4rem] border border-stone-200 bg-stone-50 px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">
            Session read
          </p>
          <ul className="mt-3 grid gap-2 text-sm text-stone-700">
            {review.bullets.map((bullet) => (
              <li key={bullet}>• {bullet}</li>
            ))}
          </ul>
        </div>

        <div className="rounded-[1.4rem] border border-stone-900 bg-stone-950 px-4 py-4 text-stone-50">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-300">
            Main takeaway
          </p>
          <p className="mt-2 text-base font-medium">{review.takeaway}</p>
        </div>
      </div>
    </SectionCard>
  );
}
