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
      className="rounded-[14px] border px-5 py-5 shadow-sm"
      style={{
        borderColor: 'var(--gr-border)',
        background: isLive ? 'var(--gr-surface)' : 'var(--gr-bg-elev)',
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold" style={{ color: isLive ? 'var(--gr-ink)' : 'var(--gr-text-mute)' }}>
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
        <p className="mt-2 text-xs leading-5" style={{ color: 'var(--gr-text-mute)' }}>{description}</p>
      )}
    </div>
  );
}
