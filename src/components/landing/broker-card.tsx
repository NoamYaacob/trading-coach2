export function BrokerCard({
  name,
  status,
  description,
}: {
  name: string;
  status: "live" | "planned";
  description?: string;
}) {
  const isLive = status === "live";
  return (
    <div
      className={`rounded-[1.75rem] border px-5 py-5 shadow-[0_4px_14px_-4px_rgba(28,25,23,0.06)] ${
        isLive ? "border-stone-200 bg-white/90" : "border-stone-100 bg-stone-50/60"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className={`text-sm font-semibold ${isLive ? "text-stone-950" : "text-stone-500"}`}>
          {name}
        </p>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] ${
            isLive ? "bg-emerald-100 text-emerald-700" : "bg-stone-100 text-stone-500"
          }`}
        >
          {isLive ? "Read-only" : "Planned"}
        </span>
      </div>
      {description && (
        <p className="mt-2 text-xs leading-5 text-stone-500">{description}</p>
      )}
    </div>
  );
}
