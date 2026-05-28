import Link from "next/link";

type Props = {
  currentFilter: "all" | "winning" | "losing";
  currentRange: number;
  buildHref: {
    all: string;
    winning: string;
    losing: string;
    r7: string;
    r14: string;
    r30: string;
  };
};

function chip(key: string, label: string, href: string, active: boolean) {
  return (
    <Link
      key={key}
      href={href}
      style={{
        padding: "6px 12px",
        borderRadius: 9,
        fontSize: 12,
        background: active ? "var(--gr-copper-bg)" : "var(--gr-surface)",
        border: active ? "1px solid var(--gr-copper-bd)" : "1px solid var(--gr-border)",
        color: active ? "var(--gr-copper)" : "var(--gr-text-mid)",
        fontWeight: active ? 600 : 500,
        textDecoration: "none",
      }}
    >
      {label}
    </Link>
  );
}

export function TradeFilters({ currentFilter, currentRange, buildHref }: Props) {
  return (
    <section style={{ padding: "0 36px 16px" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--gr-text-mute)", marginRight: 4 }}>
          Filter
        </span>
        {chip("f-all", "All", buildHref.all, currentFilter === "all")}
        {chip("f-winning", "Winning", buildHref.winning, currentFilter === "winning")}
        {chip("f-losing", "Losing", buildHref.losing, currentFilter === "losing")}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10.5, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--gr-text-mute)", marginRight: 4 }}>
          Range
        </span>
        {chip("r-7", "7d", buildHref.r7, currentRange === 7)}
        {chip("r-14", "14d", buildHref.r14, currentRange === 14)}
        {chip("r-30", "30d", buildHref.r30, currentRange === 30)}
      </div>
    </section>
  );
}
