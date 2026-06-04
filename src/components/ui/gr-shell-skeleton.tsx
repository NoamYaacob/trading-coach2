/**
 * GrShellSkeleton — instant loading state that matches GrShell's layout.
 * Rendered by route-level loading.tsx files so navigation feels immediate.
 * No data fetching, no broker calls — pure CSS skeleton.
 */

const pulse: React.CSSProperties = {
  background: "var(--gr-border)",
  borderRadius: 6,
  animation: "gr-pulse 1.4s ease-in-out infinite",
};

function Bone({ w, h, style }: { w: number | string; h: number; style?: React.CSSProperties }) {
  return <div style={{ width: w, height: h, ...pulse, ...style }} />;
}

type Props = {
  activeNav?: "home" | "rules" | "trades" | "alerts" | "settings";
};

const NAV_ITEMS = [
  { id: "home",     label: "Dashboard",    icon: "⬜" },
  { id: "rules",    label: "Trading Plan", icon: "⬜" },
  { id: "trades",   label: "Trades",       icon: "⬜" },
  { id: "alerts",   label: "Alerts",       icon: "⬜" },
  { id: "settings", label: "Settings",     icon: "⬜" },
] as const;

export function GrShellSkeleton({ activeNav }: Props) {
  return (
    <>
      <style>{`
        @keyframes gr-pulse {
          0%, 100% { opacity: 0.45; }
          50%       { opacity: 0.85; }
        }
      `}</style>
      <div
        style={{
          display: "flex",
          height: "100dvh",
          alignItems: "stretch",
          background: "var(--gr-bg)",
          color: "var(--gr-text)",
          fontFamily: "var(--font-manrope), sans-serif",
        }}
      >
        {/* Sidebar */}
        <aside
          style={{
            width: 240,
            flexShrink: 0,
            borderRight: "1px solid var(--gr-border)",
            background: "var(--gr-bg-elev)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Logo row */}
          <div
            style={{
              padding: "20px 18px",
              borderBottom: "1px solid var(--gr-border)",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: "var(--gr-accent, #e8a045)",
                flexShrink: 0,
              }}
            />
            <Bone w={80} h={14} />
          </div>

          {/* Sidebar account slot */}
          <div style={{ padding: 14, borderBottom: "1px solid var(--gr-border)" }}>
            <Bone w={60} h={10} style={{ marginBottom: 8 }} />
            <Bone w="100%" h={36} style={{ borderRadius: 8 }} />
          </div>

          {/* Nav items */}
          <nav style={{ flex: 1, padding: "12px 10px", display: "flex", flexDirection: "column", gap: 2 }}>
            {NAV_ITEMS.map(({ id, label }) => {
              const isActive = id === activeNav;
              return (
                <div
                  key={id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    borderRadius: 7,
                    background: isActive ? "var(--gr-accent-ghost, rgba(232,160,69,0.12))" : "transparent",
                  }}
                >
                  <Bone w={16} h={16} style={{ borderRadius: 4, flexShrink: 0 }} />
                  <div
                    style={{
                      fontSize: 13.5,
                      fontWeight: isActive ? 600 : 400,
                      color: isActive ? "var(--gr-ink)" : "var(--gr-text-mute)",
                      opacity: 0.6,
                    }}
                  >
                    {label}
                  </div>
                </div>
              );
            })}
          </nav>

          {/* Bottom user row */}
          <div
            style={{
              padding: "14px 18px",
              borderTop: "1px solid var(--gr-border)",
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                ...pulse,
                flexShrink: 0,
              }}
            />
            <Bone w={90} h={12} />
          </div>
        </aside>

        {/* Main content area */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Topbar */}
          <div
            style={{
              height: 56,
              borderBottom: "1px solid var(--gr-border)",
              padding: "0 24px",
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexShrink: 0,
            }}
          >
            <Bone w={120} h={14} />
          </div>

          {/* Content skeleton */}
          <div style={{ flex: 1, padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
            <Bone w={200} h={22} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
              {Array.from({ length: 4 }, (_, i) => (
                <Bone key={i} w="100%" h={88} style={{ borderRadius: 10 }} />
              ))}
            </div>
            <Bone w="100%" h={240} style={{ borderRadius: 10 }} />
            <Bone w="100%" h={180} style={{ borderRadius: 10 }} />
          </div>
        </div>
      </div>
    </>
  );
}
