/**
 * GrIcon — compact 16×16 SVG icon set for the Guardrail 2 design system.
 *
 * Source: /tmp/guardrail-2/project/gr-tokens.jsx  GIcon component.
 * Only the paths are ported — React-specific syntax replaces the JSX return.
 *
 * Usage:
 *   <GrIcon name="shield" />          // 14px (default)
 *   <GrIcon name="lock" size="sm" />  // 12px
 *   <GrIcon name="bell" size="lg" />  // 16px
 *   <GrIcon name="bolt" size="xl" />  // 20px
 */

export type GrIconName =
  | "plus" | "chevR" | "chevD" | "chevL" | "check" | "x"
  | "search" | "settings" | "refresh" | "bell" | "shield" | "clock"
  | "user" | "chart" | "target" | "cal" | "download" | "copy"
  | "lock" | "bolt" | "info" | "edit" | "more" | "home"
  | "arrowR" | "sparkle" | "list" | "grid" | "pause" | "bookmark"
  | "menu" | "plug" | "warn";

type GrIconSize = "sm" | "md" | "lg" | "xl";

type Props = {
  name: GrIconName;
  size?: GrIconSize;
  className?: string;
  style?: React.CSSProperties;
  "aria-hidden"?: boolean | "true" | "false";
};

const SIZE_PX: Record<GrIconSize, number> = { sm: 12, md: 14, lg: 16, xl: 20 };

export function GrIcon({ name, size = "md", className, style, ...rest }: Props) {
  const px = SIZE_PX[size];
  return (
    <svg
      viewBox="0 0 16 16"
      width={px}
      height={px}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flex: "0 0 auto", ...style }}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

const PATHS: Record<GrIconName, React.ReactNode> = {
  plus: (
    <>
      <path d="M8 3v10" />
      <path d="M3 8h10" />
    </>
  ),
  chevR: <path d="M6 4l4 4-4 4" />,
  chevD: <path d="M4 6l4 4 4-4" />,
  chevL: <path d="M10 4l-4 4 4 4" />,
  check: <path d="M3 8.5l3 3 7-7" />,
  x: (
    <>
      <path d="M4 4l8 8" />
      <path d="M12 4l-8 8" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L13.5 13.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M3 13l1.5-1.5M11.5 4.5L13 3" />
    </>
  ),
  refresh: (
    <>
      <path d="M3 8a5 5 0 019-3l1.5 1.5" />
      <path d="M13.5 3v3h-3" />
      <path d="M13 8a5 5 0 01-9 3l-1.5-1.5" />
      <path d="M2.5 13v-3h3" />
    </>
  ),
  bell: (
    <>
      <path d="M4 11V7a4 4 0 018 0v4l1 1.5H3z" />
      <path d="M6.5 13.5a1.5 1.5 0 003 0" />
    </>
  ),
  shield: <path d="M8 14s5-2 5-7V3l-5-1.5L3 3v4c0 5 5 7 5 7z" />,
  clock: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2 2" />
    </>
  ),
  user: (
    <>
      <circle cx="8" cy="6" r="2.5" />
      <path d="M3 13c.5-2.5 2.5-4 5-4s4.5 1.5 5 4" />
    </>
  ),
  chart: (
    <>
      <path d="M2 13h12" />
      <path d="M4 11V8M7 11V5M10 11V7M13 11V3" />
    </>
  ),
  target: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="2.5" />
    </>
  ),
  cal: (
    <>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
    </>
  ),
  download: (
    <>
      <path d="M8 2v8" />
      <path d="M5 7l3 3 3-3" />
      <path d="M3 13h10" />
    </>
  ),
  copy: (
    <>
      <rect x="5" y="5" width="8" height="8" rx="1.5" />
      <path d="M3 11V4a1 1 0 011-1h7" />
    </>
  ),
  lock: (
    <>
      <rect x="3.5" y="7.5" width="9" height="6" rx="1" />
      <path d="M5.5 7.5V5a2.5 2.5 0 015 0v2.5" />
    </>
  ),
  bolt: <path d="M9 1L3 9h4l-1 6 6-8H8z" />,
  info: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.5v3.5M8 5.2v0.1" />
    </>
  ),
  edit: <path d="M11.5 2.5l2 2L5 13H3v-2z" />,
  more: (
    <>
      <circle cx="3" cy="8" r="1" fill="currentColor" />
      <circle cx="8" cy="8" r="1" fill="currentColor" />
      <circle cx="13" cy="8" r="1" fill="currentColor" />
    </>
  ),
  home: (
    <path d="M3 7l5-4 5 4v6.5a.5.5 0 01-.5.5H10v-4H6v4H3.5a.5.5 0 01-.5-.5z" />
  ),
  arrowR: (
    <>
      <path d="M3 8h10" />
      <path d="M9 4l4 4-4 4" />
    </>
  ),
  sparkle: (
    <path d="M8 2v3M8 11v3M2 8h3M11 8h3M3.5 3.5l2 2M10.5 10.5l2 2M12.5 3.5l-2 2M5.5 10.5l-2 2" />
  ),
  list: <path d="M2 4h12M2 8h12M2 12h12" />,
  grid: (
    <>
      <rect x="2.5" y="2.5" width="4" height="4" />
      <rect x="9.5" y="2.5" width="4" height="4" />
      <rect x="2.5" y="9.5" width="4" height="4" />
      <rect x="9.5" y="9.5" width="4" height="4" />
    </>
  ),
  pause: (
    <>
      <rect x="4" y="3" width="2.5" height="10" rx="0.5" />
      <rect x="9.5" y="3" width="2.5" height="10" rx="0.5" />
    </>
  ),
  bookmark: <path d="M4 2.5h8v11l-4-2.5-4 2.5z" />,
  menu: <path d="M2 4h12M2 8h12M2 12h12" />,
  plug: (
    <>
      <path d="M5 3v3M11 3v3" />
      <rect x="3.5" y="6" width="9" height="3" rx="0.5" />
      <path d="M8 9v3M6 12h4" />
    </>
  ),
  warn: (
    <>
      <path d="M8 2L1.5 13h13z" />
      <path d="M8 6v3.5M8 11v0.1" />
    </>
  ),
};
